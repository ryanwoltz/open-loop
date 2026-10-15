import { appendFileSync, mkdirSync, renameSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  /** Directory for server.log; omit to log to stderr only. */
  dir?: string;
  level?: LogLevel;
  /** Rotate at this size; keeps `keep` old files. */
  maxBytes?: number;
  keep?: number;
  /** Never set to true in MCP mode: stdout is the protocol channel. */
  stderr?: boolean;
}

const serializeError = (value: unknown): unknown =>
  value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;

/**
 * JSON-lines file logger with size rotation. It writes to stderr (never stdout,
 * which carries MCP frames) and swallows its own I/O failures: a full disk must
 * not take the server down.
 */
export const createLogger = (opts: LoggerOptions = {}, scope = 'open-loop'): Logger => {
  const threshold = RANK[opts.level ?? ((process.env.OPEN_LOOP_LOG_LEVEL as LogLevel) || 'info')] ?? RANK.info;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const keep = opts.keep ?? 3;
  const file = opts.dir ? join(opts.dir, 'server.log') : undefined;
  if (opts.dir) {
    try {
      mkdirSync(opts.dir, { recursive: true });
    } catch {
      /* falls back to stderr only */
    }
  }

  const rotate = (): void => {
    if (!file || !existsSync(file)) return;
    if (statSync(file).size < maxBytes) return;
    const oldest = `${file}.${keep}`;
    if (existsSync(oldest)) rmSync(oldest);
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      if (existsSync(from)) renameSync(from, `${file}.${i + 1}`);
    }
    renameSync(file, `${file}.1`);
  };

  const write = (s: string, level: LogLevel, msg: string, data?: Record<string, unknown>): void => {
    if (RANK[level] < threshold) return;
    const at = new Date().toISOString();
    const fields = data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, serializeError(v)]))
      : undefined;
    if (file) {
      try {
        rotate();
        appendFileSync(file, `${JSON.stringify({ at, level, scope: s, msg, ...fields })}\n`);
      } catch {
        /* logging must never throw */
      }
    }
    if (opts.stderr !== false) {
      const extra = fields ? ` ${JSON.stringify(fields)}` : '';
      process.stderr.write(`[${at}] ${level.toUpperCase().padEnd(5)} ${s}: ${msg}${extra}\n`);
    }
  };

  const make = (s: string): Logger => ({
    debug: (m, d) => write(s, 'debug', m, d),
    info: (m, d) => write(s, 'info', m, d),
    warn: (m, d) => write(s, 'warn', m, d),
    error: (m, d) => write(s, 'error', m, d),
    child: (c) => make(`${s}:${c}`),
  });
  return make(scope);
};

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
