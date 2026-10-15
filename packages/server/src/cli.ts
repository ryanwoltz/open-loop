import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_PORT } from '@open-loop/shared';
import { createLogger, type Logger } from './logger';
import { createMcpServer } from './mcp';
import { listen } from './http';
import { ReportStore, defaultHome } from './store';
import { VERSION } from './version';

const HELP = `open-loop ${VERSION}

Usage:
  open-loop serve [--port N]            Run the local API the Chrome extension saves to.
  open-loop mcp   [--port N] [--no-http] Run the MCP server on stdio (for Claude Code, Cursor, …).
                                        Also serves the extension API when the port is free.
  open-loop list  [--status S]          Print reports (active | closed | all | open | resolved …).
  open-loop path                        Print the data directory.

Environment:
  OPEN_LOOP_HOME             Data directory (default ~/.open-loop)
  OPEN_LOOP_PORT             API port (default ${DEFAULT_PORT})
  OPEN_LOOP_ALLOWED_ORIGINS  Comma-separated chrome-extension:// origins to accept (default: any extension)
  OPEN_LOOP_LOG_LEVEL        debug | info | warn | error (default info)
`;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const port = (): number => {
  const raw = arg('--port') ?? process.env.OPEN_LOOP_PORT;
  const n = raw ? Number(raw) : DEFAULT_PORT;
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    process.stderr.write(`Invalid port: ${raw}\n`);
    process.exit(2);
  }
  return n;
};

const allowedOrigins = (): string[] =>
  (process.env.OPEN_LOOP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const startHttp = async (store: ReportStore, log: Logger, required: boolean) => {
  const result = await listen({ store, log, port: port(), allowedOrigins: allowedOrigins() });
  if ('server' in result) {
    log.info(`extension API listening on http://127.0.0.1:${result.port}`, { store: store.root });
    return result.server;
  }
  const msg =
    result.inUseBy === 'open-loop'
      ? `Another Open Loop server already serves port ${result.port}; reports land in the same store.`
      : `Port ${result.port} is in use by another program. Set OPEN_LOOP_PORT or --port.`;
  if (required) {
    // Already running is fine; a stranger on the port is not.
    if (result.inUseBy === 'open-loop') {
      log.info(`${msg} Nothing to do — stop that one first to restart it.`);
      process.exit(0);
    }
    log.error(msg);
    process.exit(1);
  }
  log.warn(msg);
  return undefined;
};

const main = async (): Promise<void> => {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const home = defaultHome();
  const log = createLogger({ dir: join(home, 'logs') });
  const store = new ReportStore(home, log);
  await store.init();

  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { reason }));
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err });
    process.exitCode = 1;
  });

  switch (cmd) {
    case 'serve': {
      const server = await startHttp(store, log, true);
      const stop = () => {
        log.info('shutting down');
        server?.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return;
    }
    case 'mcp': {
      const server = process.argv.includes('--no-http') ? undefined : await startHttp(store, log, false);
      const mcp = createMcpServer(store, log);
      await mcp.connect(new StdioServerTransport());
      log.info('MCP server ready on stdio', { version: VERSION });
      const stop = () => {
        server?.close();
        void mcp.close().finally(() => process.exit(0));
      };
      process.stdin.on('close', stop);
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return;
    }
    case 'list': {
      const status = (arg('--status') ?? 'active') as 'active';
      const reports = await store.list({ status, limit: 200 });
      if (reports.length === 0) {
        process.stdout.write('No reports.\n');
        return;
      }
      for (const r of reports) {
        process.stdout.write(
          `${r.id}  ${r.status.padEnd(11)} ${r.priority.padEnd(8)} ${r.closedAnnotationCount}/${r.annotationCount}  ${r.title}\n    ${r.url}\n`,
        );
      }
      return;
    }
    case 'path':
      process.stdout.write(`${store.root}\n`);
      return;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(2);
  }
};

main().catch((err: unknown) => {
  process.stderr.write(`open-loop: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
