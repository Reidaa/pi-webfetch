/**
 * Fetching and content conversion for the webfetch tool.
 *
 * Kept free of pi imports so it can be tested with plain `node --test`.
 * Modelled on opencode's webfetch tool.
 */

import { Parser } from "htmlparser2";
import TurndownService from "turndown";

export type Format = "markdown" | "text" | "html";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;

/** Browsers get served real content; some sites block unknown agents. */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const ACCEPT: Record<Format, string> = {
  markdown:
    "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
  text: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
  html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1",
};

export interface FetchOptions {
  format?: Format;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface FetchResult {
  url: string;
  contentType: string;
  format: Format;
  content: string;
}

export async function fetchWeb(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const format = options.format ?? "markdown";
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000;

  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http:// or https://");
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response = await request(url, format, BROWSER_USER_AGENT, signal);
  // Cloudflare bot challenges are sometimes waived for honest, non-browser agents.
  if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
    response = await request(url, format, "pi", signal);
  }
  if (!response.ok)
    throw new Error(`Request failed with status ${response.status} ${response.statusText}`);

  const contentType = response.headers.get("content-type") ?? "";
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!isTextual(mime)) {
    await response.body?.cancel();
    throw new Error(`Unsupported content type: ${mime}`);
  }

  const body = await readBounded(response, maxBytes);
  const content = decode(body, contentType);
  return { url, contentType, format, content: convert(content, mime, format) };
}

async function request(
  url: string,
  format: Format,
  userAgent: string,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: "follow",
      signal,
      headers: {
        "User-Agent": userAgent,
        Accept: ACCEPT[format],
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (error) {
    if (signal.aborted && (error as Error)?.name === "TimeoutError")
      throw new Error("Request timed out");
    throw error;
  }
}

/** SVG is an image mime but is still text worth reading. */
function isTextual(mime: string): boolean {
  if (!mime) return true;
  if (mime === "image/svg+xml") return true;
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  );
}

/** Read the body, aborting as soon as it exceeds the byte limit. */
async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => new Error(`Response too large (exceeds ${maxBytes} byte limit)`);
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isSafeInteger(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let size = 0;
  // Leaving the loop early releases the reader and cancels the stream.
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([^;"']+)/i.exec(contentType)?.[1]?.trim();
  try {
    return new TextDecoder(charset || "utf-8").decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

function convert(content: string, mime: string, format: Format): string {
  if (mime !== "text/html" && mime !== "application/xhtml+xml") return content;
  if (format === "markdown") return convertHTMLToMarkdown(content);
  if (format === "text") return extractTextFromHTML(content);
  return content;
}

export function extractTextFromHTML(html: string): string {
  const skipped = ["script", "style", "noscript", "iframe", "object", "embed"];
  let text = "";
  let skipDepth = 0;
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || skipped.includes(name)) skipDepth++;
    },
    ontext(input) {
      if (skipDepth === 0) text += input;
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--;
    },
  });
  parser.write(html);
  parser.end();
  return text.trim();
}

export function convertHTMLToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndown.remove(["script", "style", "meta", "link"]);
  return turndown.turndown(html);
}
