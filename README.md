# pi-webfetch

A `webfetch` tool for [pi](https://pi.dev): fetch an HTTP(S) URL and give the
model the content as markdown, plain text, or raw HTML. Port of opencode's
webfetch tool.

## Install

```bash
pi install ./pi-webfetch          # local checkout
pi install git:github.com/you/pi-webfetch@v0.1.0
```

Try it without installing:

```bash
pi -e ./extensions/webfetch.ts
```

## Tool

`webfetch(url, format?, timeout?)`

| Parameter | Description                             |
| --------- | --------------------------------------- |
| `url`     | HTTP or HTTPS URL to fetch              |
| `format`  | `markdown` (default), `text`, or `html` |
| `timeout` | Seconds, default 30, maximum 120        |

Behavior:

- HTML is converted with turndown (markdown) or htmlparser2 (text, skipping
  `script`/`style`/`iframe` content). Other content types are returned as-is.
- Binary responses (images, archives) are rejected; SVG is kept as text.
- Responses are capped at 5 MB, and the request is retried with a plain
  `pi` user agent when Cloudflare serves a challenge.
- Output longer than pi's tool limits is truncated; the full content is written
  to a temp file and its path is reported to the model.
- In the TUI, the fetched URL appears beside the tool call and output stays
  collapsed until you press `Ctrl+O`.

## Development

```bash
npm install
npm test        # node --test, spins up local HTTP servers
npm run fmt     # oxfmt
npm run lint    # oxlint + oxfmt --check + tsc
```
