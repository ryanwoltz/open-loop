# Open Loop

**Point at a bug on any web page, and your AI coding agent gets everything it needs to fix it.**

Open Loop is a Chrome extension and a local [MCP](https://modelcontextprotocol.io) server. You click on what's wrong, type a comment, and save. Your coding agent (Claude Code, Cursor, or any MCP client) then reads the report — screenshots, the exact DOM element, the framework component and source file behind it, console errors, failed network requests — fixes the code, and marks each issue resolved. You watch it happen in the extension's side panel.

[![ci](https://github.com/ryanwoltz/open-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/ryanwoltz/open-loop/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial%20license-available-green.svg)](COMMERCIAL-LICENSE.md)

---

## The problem

Describing a front-end bug to an AI agent is slow and lossy. You end up writing things like *"the button under the second card on the checkout page is misaligned, and there's an error in the console, let me paste it…"* — then taking a screenshot, copying the console, digging through the Network tab, and hoping the agent finds the right file.

The agent can't see your browser. It doesn't know which element you mean, which component renders it, what the page logged, or which request failed. So it guesses, and you go back and forth.

## The solution

Open Loop closes that loop:

1. **You mark it up in place.** Click an element or drag a region. Each note gets a numbered marker on the page.
2. **Open Loop captures the context automatically.** Screenshots, element selectors, the component chain (with source file and line in dev builds), console output, network failures, uncaught errors, and your recent clicks.
3. **Your agent picks it up over MCP.** It lists open reports, reads them, looks at the screenshots, and fixes the code.
4. **The agent reports back.** Each annotation flips to *Resolved* with a note on what changed and where. The report closes when every annotation is done.

No copy-pasting, no cloud service, no account. Everything stays on your machine.

## Features

- **Annotate in place.** Select an element or draw a region; hover shows the element and its framework component (React, Vue, Svelte, Angular, web components). <kbd>↑</kbd>/<kbd>↓</kbd> walks to the parent or child element.
- **Rich capture.** Original and annotated screenshots, a crop per annotation, CSS selector, XPath, attributes, computed styles, and the component chain.
- **Logs that matter.** Console output, network requests (with bodies of failed requests, redacted), uncaught errors and promise rejections, user actions, device and performance info.
- **Agent-native.** Eight MCP tools plus a `fix_report` prompt, designed so an agent can go from "what's open?" to "fixed and marked resolved" on its own.
- **Live status.** The side panel's **Issues** tab shows every report and per-annotation status as the agent works, including any questions it leaves you.
- **Offline-safe.** If the server isn't running when you save, the report waits in the extension and uploads automatically when the server is back.
- **Private by default.** Local storage only, typed text never recorded, credentials masked. See [Data & privacy](#data--privacy).

## How it works

```
┌──────────── Chrome ────────────┐        ┌──────── open-loop (Node) ────────┐
│ page ─ main-world hooks        │        │  HTTP API  127.0.0.1:7865        │
│   console/fetch/XHR/errors     │        │      │                           │
│      │ postMessage             │  HTTP  │      ▼                           │
│ content script ─ overlay UI ───┼───────▶│  ~/.open-loop/reports/<id>/      │◀── MCP (stdio) ── your agent
│      │ runtime messages        │        │    report.json  original.png     │
│ service worker ─ capture,      │        │    annotated.png  *.preview.jpg  │
│   compose, offline queue       │        │    crops/annotation-N.png        │
│ side panel ─ Capture/Issues/…  │        └──────────────────────────────────┘
└────────────────────────────────┘
```

- The **extension** hooks the page's console, `fetch`/XHR and error events from the start of page load, draws the annotation overlay, takes the screenshots, and posts the finished report to the local server.
- The **server** is one Node process. It writes each report to a folder under `~/.open-loop`, serves a small loopback-only HTTP API for the extension, and speaks MCP over stdio to your agent.

## Install

### Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- [pnpm](https://pnpm.io) (the repo pins its version; run `corepack enable` and Node will fetch the right one)
- Chrome (or another Chromium browser) 116 or newer

### 1. Build

```bash
git clone https://github.com/ryanwoltz/open-loop.git
cd open-loop
pnpm install
pnpm build
```

This produces the extension in `packages/extension/dist` and the server CLI at `packages/server/dist/cli.js`.

### 2. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `packages/extension/dist` folder.
4. Pin **Open Loop** to the toolbar and click it to open the side panel.

### 3. Connect your agent

The MCP server runs whenever your agent starts it. Use the absolute path to `cli.js` on your machine (run `pwd` inside the repo to get it).

**Claude Code**

```bash
claude mcp add --scope user open-loop -- node /absolute/path/to/open-loop/packages/server/dist/cli.js mcp
```

`--scope user` makes Open Loop available in every project, which is what you want: you'll capture bugs from whichever app you're working on.

**Cursor, Windsurf, Claude Desktop, and other MCP clients**

Add this to the client's MCP config (for Cursor, `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-loop": {
      "command": "node",
      "args": ["/absolute/path/to/open-loop/packages/server/dist/cli.js", "mcp"]
    }
  }
}
```

### 4. (Optional) Run the server without an agent

While the MCP server runs, it also serves the API the extension saves to. To capture reports when no agent is open:

```bash
node packages/server/dist/cli.js serve
```

Or, from the repo root, `pnpm serve`. If an agent later starts its own MCP server, both share the same report store.

## Usage

1. **Open the side panel** with the toolbar icon or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>. The switch in the header turns Open Loop on or off for every tab.
2. **Annotate.** Choose **Select element** (<kbd>E</kbd>) or **Draw region** (<kbd>R</kbd>), or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>, or right-click → *Annotate with Open Loop*. Click or drag on the page, type your comment, pick a category, and press <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>. Repeat for as many issues as you like.
3. **Save.** Add a title and priority, choose what to include, then **Capture & save report** (or **Save report** on the in-page toolbar).
4. **Hand it off.** Copy the agent prompt from the success card, or just tell your agent: *"fix the open Open Loop reports"*. In Claude Code you can also use the `fix_report` prompt.
5. **Watch it close.** In the **Issues** tab, annotations flip to *Resolved* with the agent's note. The report resolves when all of them do.

Drafts survive a page reload, and each tab keeps its own drafts and logs.

## MCP tools

| Tool | What it does |
| --- | --- |
| `list_reports` | Reports, newest first. `status` defaults to active (open + in progress). Filter by page URL or text. |
| `get_report` | Comments, element info, component chain, page/device/perf info, trimmed logs, activity, and absolute file paths. |
| `get_screenshot` | The annotated or original screenshot as an image (an agent-sized preview, or full resolution). |
| `get_annotation_crop` | One annotation up close, by id or marker number. |
| `get_logs` | One log section, filtered by level, failed-only, or substring. |
| `update_annotation_status` | Set `open` / `in_progress` / `resolved` / `wont_fix` with a note. The report status follows. |
| `update_report_status` | Close or reopen a whole report. |
| `add_note` | Ask a question or leave findings. It shows up in the side panel. |

The server also exposes a **`fix_report`** prompt that walks an agent through every open annotation on a report.

## CLI

```
open-loop serve [--port N]             Run the local API the Chrome extension saves to.
open-loop mcp   [--port N] [--no-http] Run the MCP server on stdio (also serves the API when the port is free).
open-loop list  [--status S]           Print reports (active | closed | all | open | resolved …).
open-loop path                         Print the data directory.
```

Run it as `node packages/server/dist/cli.js <command>`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPEN_LOOP_HOME` | `~/.open-loop` | Where reports, trash and logs are stored. |
| `OPEN_LOOP_PORT` | `7865` | Port for the extension API. If you change it, update the server URL in the extension's Settings too. |
| `OPEN_LOOP_ALLOWED_ORIGINS` | any extension | Comma-separated `chrome-extension://<id>` origins to accept. |
| `OPEN_LOOP_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

## Data & privacy

Open Loop has no cloud component. Reports live in `~/.open-loop` (or `OPEN_LOOP_HOME`). Deleted reports go to `~/.open-loop/trash` and are never removed automatically. Capture buffers live only in the tab's memory until you save.

- **Typed text is never recorded** — only "typed N characters". Form values are stripped from captured element HTML.
- **Credential-looking query parameters** (`token`, `key`, `password`, `signature`, …) are masked in every URL.
- **Request and response bodies** are kept only for failed requests, with password, token, card and session fields masked. You can turn this off in Settings.

### Security model

The local API is designed so that web pages can't read or write your reports:

- It listens on `127.0.0.1` only and rejects requests whose `Host` header isn't loopback (blocks DNS rebinding).
- It refuses requests from web-page origins.
- It requires an `x-open-loop` header, which a web page can't send without a CORS preflight the server rejects.
- Set `OPEN_LOOP_ALLOWED_ORIGINS=chrome-extension://<your-extension-id>` to accept only your copy of the extension.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Troubleshooting

- **"Can't annotate this page"** — Chrome blocks extensions on `chrome://` pages, the Chrome Web Store and the new-tab page.
- **Offline pill in the side panel** — the server isn't reachable. Start `open-loop serve`, or start your agent with the MCP server configured. Settings shows the URL it's trying and the exact error. Saved reports are queued and upload once it's back.
- **Port already in use** — another program has port 7865. Set `OPEN_LOOP_PORT` and update the server URL in the extension's Settings to match.
- **Agent doesn't see the tools** — check the path to `cli.js` is absolute and that you ran `pnpm build`. In Claude Code, `claude mcp list` shows whether the server connected.
- **Diagnostics** — Settings → Diagnostics shows the extension's own log (service worker, side panel and content scripts) and exports it as JSON. The server logs to `~/.open-loop/logs/server.log` (rotated at 5 MB). Set `OPEN_LOOP_LOG_LEVEL=debug` for request-level logs.

### Known limitations

- Captures the visible viewport, not the full scrolling page.
- Cross-origin iframes and closed shadow roots can't be annotated.
- Elements in the browser's top layer (`<dialog>` modals, popovers) may draw above the overlay.
- Source file and line for components are only available in development builds of your app.

## Development

```bash
pnpm typecheck
pnpm test                                    # unit + integration tests (shared, server, extension)
pnpm test:e2e                                # builds, then drives the real extension in Chromium with Playwright
pnpm --filter @open-loop/extension watch     # rebuild on save; then reload the extension in chrome://extensions
```

The first e2e run needs a browser: `pnpm exec playwright install chromium`.

### Project layout

| Path | Contents |
| --- | --- |
| `packages/shared` | Zod schemas for reports, redaction helpers, shared utilities. |
| `packages/server` | Report store, HTTP API, MCP server and CLI. |
| `packages/extension` | Manifest V3 extension: service worker, content scripts, main-world hooks, React side panel. |
| `e2e/` | Playwright tests that load the built extension against a fixture app. |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, test and submit changes. Contributors sign a short [Contributor License Agreement](CLA.md) in their first pull request.

## License

Copyright © 2026 Ryan Woltz. Open Loop is dual-licensed:

- **[AGPL-3.0](LICENSE)** — free to use, modify and share. If you distribute a modified version or run one as a network service, you must release your full source code under the AGPL-3.0 too.
- **[Commercial license](COMMERCIAL-LICENSE.md)** — for building Open Loop into a closed-source product or service, or using its code without the AGPL's obligations.

Using Open Loop as a tool to report bugs in your own apps, personally or at work, doesn't require a commercial license, and your apps aren't affected by Open Loop's license.
