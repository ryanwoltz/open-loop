# Open Loop

Mark up any web page, capture the context a developer needs, and hand it to your AI coding agent over MCP — then watch the agent close the loop.

- **Annotate in place.** Click an element or drag a region; each note gets a numbered marker. Hover shows the element and its framework component (React, Vue, Svelte, Angular, web components); ↑/↓ walks to the parent/child.
- **Capture everything an agent needs.** Original and annotated screenshots, a crop per annotation, the element's selector, XPath, attributes, computed styles and component chain (with source file and line in dev builds), plus console output, network requests (bodies of failed ones, redacted), uncaught errors, user actions, device and performance info.
- **Hand it to the agent.** A local MCP server gives Claude Code (or any MCP client) the reports: list, read, view screenshots, filter logs, and mark each annotation resolved with a note.
- **Track resolution.** The side panel's Issues tab shows every report and live per-annotation status as the agent works.

```
┌──────────── Chrome ────────────┐        ┌──────── open-loop (Node) ────────┐
│ page ─ main-world hooks        │        │  HTTP API  127.0.0.1:7865        │
│   console/fetch/XHR/errors     │        │      │                           │
│      │ postMessage             │  HTTP  │      ▼                           │
│ content script ─ overlay UI ───┼───────▶│  ~/.open-loop/reports/<id>/      │◀── MCP (stdio) ── Claude Code
│      │ runtime messages        │        │    report.json  original.png     │
│ service worker ─ capture,      │        │    annotated.png  *.preview.jpg  │
│   compose, offline queue       │        │    crops/annotation-N.png        │
│ side panel ─ Capture/Issues/…  │        └──────────────────────────────────┘
└────────────────────────────────┘
```

## Install

Requires Node 20+, pnpm and Chrome 116+.

```bash
git clone <this repo> open-loop && cd open-loop
pnpm install
pnpm build
```

**Load the extension:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `packages/extension/dist`. Pin Open Loop and click it to open the side panel.

**Connect your agent** (Claude Code shown; any MCP client works the same way):

```bash
claude mcp add open-loop -- node /absolute/path/to/open-loop/packages/server/dist/cli.js mcp
```

While the MCP server runs it also serves the extension's API. To keep the API up without an agent:

```bash
node packages/server/dist/cli.js serve
```

If the server is down when you save, the report waits in the extension and uploads automatically when it's back.

## Use

1. Open the side panel (toolbar icon or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>). The switch in the header turns Open Loop on or off for every tab.
2. **Select element** (<kbd>E</kbd>) or **Draw region** (<kbd>R</kbd>) — or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>, or right-click → *Annotate with Open Loop*. Click (or drag) on the page, type the comment, pick a category, <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>.
3. Add a title, priority and what to include, then **Capture & save report** (or **Save report** on the in-page toolbar).
4. Copy the agent prompt from the success card, or just ask your agent: *"fix the open Open Loop reports"*. Claude Code also gets a `fix_report` prompt.
5. Watch the **Issues** tab: annotations flip to *Resolved* with the agent's note; the report resolves when all do.

Drafts survive a page reload. Each tab keeps its own drafts and logs.

## MCP tools

| Tool | What it does |
| --- | --- |
| `list_reports` | Reports, newest first; `status` defaults to active (open + in progress). Filter by page URL or text. |
| `get_report` | Comments, element info, component chain, page/device/perf, trimmed logs, activity, absolute file paths. |
| `get_screenshot` | Annotated or original screenshot as an image (agent-sized preview, or full resolution). |
| `get_annotation_crop` | One annotation up close, by id or marker number. |
| `get_logs` | One log section, filtered (level, failed only, substring). |
| `update_annotation_status` | `open` / `in_progress` / `resolved` / `wont_fix` with a note; the report status follows. |
| `update_report_status` | Close or reopen the whole report. |
| `add_note` | Ask a question or leave findings; it shows in the side panel. |

## Data & privacy

Everything stays on your machine: reports live in `~/.open-loop` (`OPEN_LOOP_HOME` to move it); trash goes to `~/.open-loop/trash`, never deleted. Capture buffers live only in the tab's memory until you save.

- Typed text is never recorded — only "typed N characters". Form values are stripped from element HTML.
- Credential-looking query parameters (`token`, `key`, `password`, `signature`, …) are masked in every URL.
- Failed request/response bodies are kept only for failed requests, with password/token/card/session fields masked. Turn this off in Settings.
- The local API only answers loopback `Host` headers, refuses web-page origins, and requires an `x-open-loop` header a web page can't send without a preflight the server rejects. Pin to your extension id with `OPEN_LOOP_ALLOWED_ORIGINS=chrome-extension://<id>`.

## Troubleshooting

- **"Can't annotate this page"** — Chrome blocks extensions on `chrome://` pages, the Web Store and the new-tab page.
- **Offline pill** — start `open-loop serve` or your agent with the MCP server. Settings shows the URL it is trying and the exact error.
- **Diagnostics** — Settings → Diagnostics shows the extension's own log (service worker, side panel and content scripts) and exports it as JSON. The server logs to `~/.open-loop/logs/server.log` (rotated at 5 MB). `OPEN_LOOP_LOG_LEVEL=debug` for request-level logs.

Limitations: captures the visible viewport (not the full page); cross-origin iframes and closed shadow roots aren't annotatable; elements in the browser's top layer (`<dialog>` modals, popovers) may draw above the overlay.

## Develop

```bash
pnpm typecheck
pnpm test            # unit + integration (shared, server, extension)
pnpm test:e2e        # builds, then drives the real extension in Chromium with Playwright
pnpm --filter @open-loop/extension watch   # rebuild on save; reload the extension in chrome://extensions
```

Layout: `packages/shared` (zod schemas, redaction), `packages/server` (store, HTTP API, MCP server, CLI), `packages/extension` (MV3 service worker, content scripts, side panel), `e2e/`.

## License

MIT
