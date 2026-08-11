import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, describe, test } from "node:test";
import { fetchWeb } from "../src/fetch.ts";

type Handler = Parameters<typeof createServer>[1];

const servers: Server[] = [];

/** Start a throwaway HTTP server and return its base URL. */
async function serve(handler: Handler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

after(() => {
  for (const server of servers) server.close();
});

const html = `<html><head><style>b{}</style><script>var x=1</script></head>
<body><h1>Title</h1><p>Hello <b>world</b></p></body></html>`;

describe("fetchWeb", () => {
  test("converts HTML to markdown by default", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    const result = await fetchWeb(url, { format: "markdown" });
    assert.match(result.content, /^# Title/m);
    assert.match(result.content, /Hello \*\*world\*\*/);
    assert.doesNotMatch(result.content, /var x=1/);
  });

  test("extracts plain text without script and style content", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    const result = await fetchWeb(url, { format: "text" });
    assert.match(result.content, /Hello world/);
    assert.doesNotMatch(result.content, /var x=1/);
  });

  test("returns raw HTML when format is html", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    const result = await fetchWeb(url, { format: "html" });
    assert.match(result.content, /<h1>Title<\/h1>/);
  });

  test("leaves non-HTML text alone", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"a":1}');
    });
    const result = await fetchWeb(url, { format: "markdown" });
    assert.equal(result.content, '{"a":1}');
    assert.equal(result.contentType, "application/json");
  });

  test("decodes non-UTF-8 charsets", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=iso-8859-1" });
      res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9])); // café in latin-1
    });
    const result = await fetchWeb(url, { format: "text" });
    assert.equal(result.content, "café");
  });

  test("rejects binary content types", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([137, 80, 78, 71]));
    });
    await assert.rejects(fetchWeb(url, { format: "markdown" }), /image\/png/);
  });

  test("rejects non-HTTP URLs", async () => {
    await assert.rejects(fetchWeb("file:///etc/passwd", {}), /http/);
  });

  test("rejects HTTP error status", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("nope");
    });
    await assert.rejects(fetchWeb(url, {}), /404/);
  });

  test("rejects bodies over the size limit", async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(2048));
    });
    await assert.rejects(fetchWeb(url, { maxBytes: 1024 }), /too large/i);
  });

  test("times out slow responses", async () => {
    const url = await serve(() => {
      /* never respond */
    });
    await assert.rejects(fetchWeb(url, { timeoutMs: 150 }), /timed out/i);
  });
});
