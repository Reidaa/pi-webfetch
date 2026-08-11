/**
 * webfetch tool: fetch an HTTP(S) URL and hand the content to the LLM as
 * markdown (default), plain text, or raw HTML.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TIMEOUT_SECONDS,
  fetchWeb,
  type Format,
  MAX_TIMEOUT_SECONDS,
} from "../src/fetch.ts";

const description = `Fetch content from an HTTP or HTTPS URL and return it as markdown (default), text, or HTML.

Usage notes:
- Prefer a more targeted tool if one is available.
- The URL must be fully formed, including the scheme.
- This tool is read-only and does not modify any files.
- Binary responses (images, archives) are rejected.
- Long content is truncated; the full response is written to a temp file whose path is reported.`;

export default function webfetchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "Fetch",
    description,
    promptSnippet: "Fetch a web page as markdown, text, or HTML",
    parameters: Type.Object({
      url: Type.String({ description: "The HTTP or HTTPS URL to fetch content from" }),
      format: Type.Optional(
        StringEnum(["markdown", "text", "html"] as const, {
          description: "Format to return the content in. Defaults to markdown.",
        }),
      ),
      timeout: Type.Optional(
        Type.Number({
          description: `Timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}, maximum: ${MAX_TIMEOUT_SECONDS})`,
        }),
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const timeoutSeconds = Math.min(
        params.timeout ?? DEFAULT_TIMEOUT_SECONDS,
        MAX_TIMEOUT_SECONDS,
      );
      const result = await fetchWeb(params.url, {
        format: (params.format as Format | undefined) ?? "markdown",
        timeoutMs: Math.max(timeoutSeconds, 1) * 1000,
        signal: signal ?? undefined,
      });

      const truncation = truncateHead(result.content, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      let text = truncation.content;
      if (truncation.truncated) {
        const file = join(mkdtempSync(join(tmpdir(), "pi-webfetch-")), "content");
        writeFileSync(file, result.content);
        text +=
          `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines` +
          ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
          ` Full content saved to: ${file}]`;
      }

      return {
        content: [{ type: "text", text }],
        details: {
          url: result.url,
          contentType: result.contentType,
          format: result.format,
          bytes: truncation.totalBytes,
          truncated: truncation.truncated,
        },
      };
    },
  });
}
