import { redactUrl, truncate } from '@open-loop/shared/core';
import { redactBody } from '@open-loop/shared/redact';
import type { ConsoleEntry, ErrorEntry, NetworkEntry } from '@open-loop/shared';
import { BRIDGE, type ContentToMain, type MainToContent, PROBE_ATTR, isBridgeMessage } from '../lib/bridge';
import { componentsFor } from './components';
import { formatArgs } from './serialize';

/**
 * Runs in the page's own JavaScript world at document_start. It wraps console,
 * fetch and XMLHttpRequest and listens for errors, then forwards entries to the
 * isolated content script. Until the content script says capture is on, it
 * keeps at most PRE_CONFIG_MAX entries; when it says off, it forwards nothing.
 * Every wrapper calls through to the original first and never throws into
 * the page.
 */
declare global {
  interface Window {
    __openLoopMain?: boolean;
  }
}

(() => {
  if (window.__openLoopMain) return;
  window.__openLoopMain = true;

  const PRE_CONFIG_MAX = 300;
  const BODY_MAX = 4000;

  let configured = false;
  let enabled = false;
  let captureConsole = true;
  let captureNetwork = true;
  let failedBodies = true;
  const early: MainToContent[] = [];

  type Up = MainToContent extends infer M ? (M extends unknown ? Omit<M, 'bridge' | 'dir'> : never) : never;
  const post = (msg: Up): void => {
    const full = { bridge: BRIDGE, dir: 'up', ...msg } as MainToContent;
    if (!configured) {
      if (early.length < PRE_CONFIG_MAX) early.push(full);
      return;
    }
    if (!enabled) return;
    try {
      window.postMessage(full, '*');
    } catch {
      /* uncloneable payload: entries are plain strings/numbers, so this should not happen */
    }
  };

  // ---------- console ----------
  const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const level of LEVELS) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function openLoopConsole(this: Console, ...args: unknown[]) {
      try {
        if (captureConsole && (enabled || !configured)) {
          const entry: ConsoleEntry = { level, message: formatArgs(args, 10_000), at: Date.now() };
          if (level === 'error') {
            const err = args.find((a): a is Error => a instanceof Error);
            if (err?.stack) entry.stack = truncate(err.stack, 10_000);
          }
          post({ kind: 'console', entry });
        }
      } catch {
        /* never break the page's logging */
      }
      return original.apply(this, args);
    };
  }

  // ---------- errors ----------
  window.addEventListener(
    'error',
    (ev: ErrorEvent) => {
      // Resource load errors (img/script 404s) arrive here without .error/.message.
      if (!(ev instanceof ErrorEvent)) return;
      const entry: ErrorEntry = {
        kind: 'error',
        message: truncate(ev.message || String(ev.error ?? 'Unknown error'), 10_000),
        at: Date.now(),
      };
      if (ev.filename) entry.source = redactUrl(ev.filename);
      if (ev.lineno) entry.line = ev.lineno;
      if (ev.colno) entry.column = ev.colno;
      const stack = (ev.error as Error | undefined)?.stack;
      if (stack) entry.stack = truncate(stack, 10_000);
      post({ kind: 'error', entry });
    },
    true,
  );
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason as unknown;
    const entry: ErrorEntry = {
      kind: 'unhandledrejection',
      message: truncate(reason instanceof Error ? `${reason.name}: ${reason.message}` : formatArgs([reason]), 10_000),
      at: Date.now(),
    };
    if (reason instanceof Error && reason.stack) entry.stack = truncate(reason.stack, 10_000);
    post({ kind: 'error', entry });
  });

  // ---------- network ----------
  const absolute = (url: string): string => {
    try {
      return redactUrl(new URL(url, location.href).toString());
    } catch {
      return truncate(url, 4000);
    }
  };
  const isTextual = (ct: string | null | undefined): boolean =>
    !ct || /json|text|xml|javascript|graphql|x-www-form-urlencoded/i.test(ct);
  const bodyText = (body: unknown): string | undefined => {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      const parts: string[] = [];
      body.forEach((v, k) => parts.push(`${encodeURIComponent(k)}=${typeof v === 'string' ? encodeURIComponent(v) : '[file]'}`));
      return parts.join('&');
    }
    return body == null ? undefined : `[${Object.prototype.toString.call(body).slice(8, -1)}]`;
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function openLoopFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const startedAt = Date.now();
      const t0 = performance.now();
      let method = 'GET';
      let url = '';
      let reqBody: string | undefined;
      let reqType: string | undefined;
      try {
        if (input instanceof Request) {
          method = input.method;
          url = input.url;
          reqType = input.headers.get('content-type') ?? undefined;
        } else {
          url = String(input);
        }
        if (init?.method) method = init.method.toUpperCase();
        if (init?.body !== undefined) reqBody = bodyText(init.body);
        const h = init?.headers;
        if (h) reqType = new Headers(h).get('content-type') ?? reqType;
      } catch {
        /* keep defaults */
      }

      let response: Response;
      try {
        response = await originalFetch.call(this as typeof globalThis, input, init);
      } catch (err) {
        if (captureNetwork) {
          const aborted = err instanceof DOMException && err.name === 'AbortError';
          post({
            kind: 'network',
            entry: {
              method,
              url: absolute(url),
              status: 0,
              ok: false,
              initiator: 'fetch',
              startedAt,
              durationMs: Math.round(performance.now() - t0),
              ...(reqType ? { requestContentType: truncate(reqType, 200) } : {}),
              ...(failedBodies && reqBody ? { requestBody: redactBody(reqBody, BODY_MAX) } : {}),
              error: aborted ? 'Aborted' : truncate(err instanceof Error ? err.message : String(err), 1000),
            },
          });
        }
        throw err;
      }

      if (captureNetwork) {
        try {
          const resType = response.headers.get('content-type');
          const len = Number(response.headers.get('content-length'));
          const entry: NetworkEntry = {
            method,
            url: absolute(response.url || url),
            status: response.status,
            ok: response.ok,
            initiator: 'fetch',
            startedAt,
            durationMs: Math.round(performance.now() - t0),
            ...(response.statusText ? { statusText: truncate(response.statusText, 200) } : {}),
            ...(reqType ? { requestContentType: truncate(reqType, 200) } : {}),
            ...(resType ? { responseContentType: truncate(resType, 200) } : {}),
            ...(Number.isFinite(len) && len > 0 ? { responseSize: len } : {}),
          };
          if (!response.ok && failedBodies) {
            if (reqBody) entry.requestBody = redactBody(reqBody, BODY_MAX);
            if (isTextual(resType) && response.type !== 'opaque') {
              response
                .clone()
                .text()
                .then((t) => post({ kind: 'network', entry: { ...entry, responseBody: redactBody(t, BODY_MAX) } }))
                .catch(() => post({ kind: 'network', entry }));
              return response;
            }
          }
          post({ kind: 'network', entry });
        } catch {
          /* never break the page's fetch */
        }
      }
      return response;
    };
  }

  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string; startedAt: number; t0: number; body?: string }>();

  XHR.open = function openLoopOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    try {
      xhrMeta.set(this, { method: String(method).toUpperCase(), url: String(url), startedAt: 0, t0: 0 });
    } catch {
      /* ignore */
    }
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;

  XHR.send = function openLoopSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMeta.get(this);
    if (meta && captureNetwork) {
      meta.startedAt = Date.now();
      meta.t0 = performance.now();
      meta.body = bodyText(body);
      this.addEventListener('loadend', () => {
        try {
          const ok = this.status >= 200 && this.status < 400;
          const resType = this.getResponseHeader('content-type');
          const entry: NetworkEntry = {
            method: meta.method,
            url: absolute(this.responseURL || meta.url),
            status: this.status,
            ok,
            initiator: 'xhr',
            startedAt: meta.startedAt,
            durationMs: Math.round(performance.now() - meta.t0),
            ...(this.statusText ? { statusText: truncate(this.statusText, 200) } : {}),
            ...(resType ? { responseContentType: truncate(resType, 200) } : {}),
          };
          if (this.status === 0) entry.error = 'Network error, CORS failure or aborted';
          if (!ok && failedBodies) {
            if (meta.body) entry.requestBody = redactBody(meta.body, BODY_MAX);
            if ((this.responseType === '' || this.responseType === 'text') && isTextual(resType) && this.responseText) {
              entry.responseBody = redactBody(this.responseText, BODY_MAX);
            }
          }
          post({ kind: 'network', entry });
        } catch {
          /* ignore */
        }
      });
    }
    return originalSend.call(this, body);
  };

  // ---------- SPA navigation ----------
  for (const fn of ['pushState', 'replaceState'] as const) {
    const original = history[fn];
    history[fn] = function openLoopHistory(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      try {
        post({ kind: 'action', entry: { type: 'navigation', at: Date.now(), detail: fn, url: redactUrl(location.href) } });
      } catch {
        /* ignore */
      }
      return result;
    };
  }

  // ---------- messages from the content script ----------
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window || !isBridgeMessage(ev.data, 'down')) return;
    const msg = ev.data as ContentToMain;
    if (msg.kind === 'config') {
      enabled = msg.enabled;
      captureConsole = msg.console;
      captureNetwork = msg.network;
      failedBodies = msg.failedBodies;
      if (!configured) {
        configured = true;
        if (enabled) for (const m of early) window.postMessage(m, '*');
        early.length = 0;
      }
      return;
    }
    if (msg.kind === 'probe') {
      let result: ReturnType<typeof componentsFor> = { frames: [], minified: false };
      try {
        const el = document.querySelector(`[${PROBE_ATTR}="${CSS.escape(msg.nonce)}"]`) ?? findInShadows(msg.nonce);
        if (el) result = componentsFor(el);
      } catch {
        /* report none */
      }
      window.postMessage(
        { bridge: BRIDGE, dir: 'up', kind: 'components', nonce: msg.nonce, components: result.frames, minified: result.minified } satisfies MainToContent,
        '*',
      );
    }
  });

  const findInShadows = (nonce: string): Element | null => {
    const sel = `[${PROBE_ATTR}="${CSS.escape(nonce)}"]`;
    const walk = (root: Document | ShadowRoot): Element | null => {
      const hit = root.querySelector(sel);
      if (hit) return hit;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const inner = walk(el.shadowRoot);
          if (inner) return inner;
        }
      }
      return null;
    };
    return walk(document);
  };

  window.postMessage({ bridge: BRIDGE, dir: 'up', kind: 'ready' } satisfies MainToContent, '*');
})();
