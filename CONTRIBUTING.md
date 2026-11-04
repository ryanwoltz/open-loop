# Contributing to Open Loop

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue with:

- What you did, what you expected, and what happened.
- Your Chrome version, OS, Node version, and which MCP client you use.
- Anything relevant from **Settings → Diagnostics** in the side panel (export it as JSON) or from `~/.open-loop/logs/server.log`.

Please check captured logs for anything private before attaching them.

## Setting up

```bash
corepack enable
pnpm install
pnpm build
```

Load `packages/extension/dist` as an unpacked extension (see the [README](README.md#install)). For extension work, run `pnpm --filter @open-loop/extension watch` and reload the extension in `chrome://extensions` after each rebuild.

## Before you open a pull request

```bash
pnpm typecheck
pnpm test
pnpm test:e2e     # first run: pnpm exec playwright install chromium
```

CI runs all three on every pull request.

- Keep changes focused; one topic per pull request.
- Add or update tests for behavior you change.
- If you touch what gets captured (logs, network bodies, element HTML), make sure redaction still covers it. See `packages/shared/src/redact.ts`.
- Update the README if you change install steps, MCP tools, CLI flags or environment variables.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
