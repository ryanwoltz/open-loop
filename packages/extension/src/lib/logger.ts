/**
 * Extension diagnostics log. Every context (service worker, side panel,
 * content script) writes here; entries go to the devtools console and to a
 * capped ring buffer in chrome.storage.local that the Settings tab shows and
 * exports. Logging never throws.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: string;
}

export const LOG_KEY = 'ol:logs';
const MAX_ENTRIES = 500;
const FLUSH_MS = 400;

let pending: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

const describe = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  try {
    const s = JSON.stringify(value, (_k, v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : v));
    return s.length > 2000 ? `${s.slice(0, 1999)}…` : s;
  } catch {
    return String(value);
  }
};

const hasStorage = (): boolean => {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local && !!chrome.runtime?.id;
  } catch {
    return false; // "Extension context invalidated" in an orphaned content script
  }
};

const flush = async (): Promise<void> => {
  timer = undefined;
  if (pending.length === 0 || !hasStorage()) {
    pending = [];
    return;
  }
  const batch = pending;
  pending = [];
  try {
    const got = await chrome.storage.local.get(LOG_KEY);
    const existing = (got[LOG_KEY] as LogEntry[] | undefined) ?? [];
    await chrome.storage.local.set({ [LOG_KEY]: [...existing, ...batch].slice(-MAX_ENTRIES) });
  } catch {
    /* storage full or context gone: console still has it */
  }
};

const write = (scope: string, level: LogLevel, message: string, data?: unknown): void => {
  const entry: LogEntry = { at: Date.now(), level, scope, message };
  const d = describe(data);
  if (d) entry.data = d;
  const line = `[open-loop:${scope}] ${message}`;
  const out = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error;
  // Content scripts must not pollute the page's console capture: they log to
  // the isolated world's console, which the main-world hooks never see.
  if (data === undefined) out(line);
  else out(line, data);
  if (level === 'debug') return;
  pending.push(entry);
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
};

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export const createLogger = (scope: string): Logger => ({
  debug: (m, d) => write(scope, 'debug', m, d),
  info: (m, d) => write(scope, 'info', m, d),
  warn: (m, d) => write(scope, 'warn', m, d),
  error: (m, d) => write(scope, 'error', m, d),
});

export const readLogs = async (): Promise<LogEntry[]> => {
  await flush();
  const got = await chrome.storage.local.get(LOG_KEY);
  return (got[LOG_KEY] as LogEntry[] | undefined) ?? [];
};

export const clearLogs = async (): Promise<void> => {
  pending = [];
  await chrome.storage.local.remove(LOG_KEY);
};

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
