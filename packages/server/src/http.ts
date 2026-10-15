import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { API_HEADER, API_HEADER_VALUE, AnnotationPatch, ListQuery, ReportPatch } from '@open-loop/shared';
import { mimeFor, type ReportStore, StoreError } from './store';
import type { Logger } from './logger';
import { VERSION } from './version';

const MAX_BODY_BYTES = 120 * 1024 * 1024;

export interface HttpOptions {
  store: ReportStore;
  log: Logger;
  port: number;
  host?: string;
  /**
   * Extension origins allowed to call the API (e.g. chrome-extension://abc…).
   * Empty means any chrome-extension:// origin.
   */
  allowedOrigins?: string[];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<StoreError['code'], number> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  too_large: 413,
  busy: 503,
};

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'Request body too large', 'too_large'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large', 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Body is not valid JSON', 'invalid'));
      }
    });
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: unknown): void => {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
};

export const isAllowedHost = (host: string | undefined, port: number): boolean => {
  if (!host) return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
};

export const isAllowedOrigin = (origin: string | undefined, allowed: string[]): boolean => {
  if (!origin) return true; // same-machine tools (curl, the CLI) send none
  if (allowed.length > 0) return allowed.includes(origin);
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
};

/**
 * The extension's API. It only answers requests that (1) name a loopback Host
 * (no DNS rebinding), (2) come from no Origin or an extension origin, and
 * (3) carry the x-open-loop header, which a web page can't attach without a
 * preflight this server refuses. See API_HEADER in @open-loop/shared.
 */
export const createHttpServer = (opts: HttpOptions): Server => {
  const { store } = opts;
  const log = opts.log.child('http');
  const allowed = opts.allowedOrigins ?? [];

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const port = (req.socket.localPort ?? opts.port) as number;
    if (!isAllowedHost(req.headers.host, port)) throw new HttpError(403, 'Host not allowed', 'forbidden');
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, allowed)) throw new HttpError(403, 'Origin not allowed', 'forbidden');
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': `content-type, ${API_HEADER}`,
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }
    if (req.headers[API_HEADER] !== API_HEADER_VALUE) {
      throw new HttpError(403, `Missing ${API_HEADER} header`, 'forbidden');
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== 'api') throw new HttpError(404, 'Not found', 'not_found');
    const [, resource, id, sub, subId, ...rest] = parts;

    if (resource === 'health' && req.method === 'GET') {
      return send(res, 200, { ok: true, name: 'open-loop', version: VERSION, store: store.root });
    }
    if (resource !== 'reports') throw new HttpError(404, 'Not found', 'not_found');

    if (!id) {
      if (req.method === 'GET') {
        const q = ListQuery.safeParse(Object.fromEntries(url.searchParams));
        if (!q.success) throw new HttpError(400, q.error.issues[0]?.message ?? 'Invalid query', 'invalid');
        return send(res, 200, { reports: await store.list(q.data) });
      }
      if (req.method === 'POST') {
        const { report, created } = await store.create(await readBody(req), { actor: 'user' });
        return send(res, created ? 201 : 200, { report, created });
      }
      throw new HttpError(405, 'Method not allowed', 'method');
    }

    if (!sub) {
      if (req.method === 'GET') return send(res, 200, { report: await store.get(id) });
      if (req.method === 'PATCH') {
        const patch = ReportPatch.safeParse(await readBody(req));
        if (!patch.success) throw new HttpError(400, patch.error.issues[0]?.message ?? 'Invalid patch', 'invalid');
        return send(res, 200, { report: await store.update(id, patch.data, { actor: 'user' }) });
      }
      if (req.method === 'DELETE') {
        await store.trash(id);
        return send(res, 200, { ok: true });
      }
      throw new HttpError(405, 'Method not allowed', 'method');
    }

    if (sub === 'annotations' && subId && rest.length === 0 && req.method === 'PATCH') {
      const patch = AnnotationPatch.safeParse(await readBody(req));
      if (!patch.success) throw new HttpError(400, patch.error.issues[0]?.message ?? 'Invalid patch', 'invalid');
      return send(res, 200, { report: await store.updateAnnotation(id, subId, patch.data, { actor: 'user' }) });
    }

    if (sub === 'notes' && !subId && req.method === 'POST') {
      const body = (await readBody(req)) as { message?: unknown; annotationId?: unknown } | undefined;
      if (typeof body?.message !== 'string' || !body.message.trim() || body.message.length > 5000) {
        throw new HttpError(400, 'message must be a non-empty string up to 5000 characters', 'invalid');
      }
      const aid = typeof body.annotationId === 'string' ? body.annotationId : undefined;
      return send(res, 200, { report: await store.addNote(id, body.message.trim(), { actor: 'user' }, aid) });
    }

    if (sub === 'files' && subId && req.method === 'GET') {
      const name = [subId, ...rest].join('/');
      const file = store.filePath(id, name);
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        throw new HttpError(404, 'File not found', 'not_found');
      }
      res.writeHead(200, { 'content-type': mimeFor(name), 'content-length': size, 'cache-control': 'private, max-age=31536000, immutable' });
      createReadStream(file).pipe(res);
      return;
    }

    throw new HttpError(404, 'Not found', 'not_found');
  };

  return createServer((req, res) => {
    const started = Date.now();
    handle(req, res)
      .catch((err: unknown) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
        if (err instanceof StoreError) return send(res, STATUS_BY_CODE[err.code], { error: err.message, code: err.code });
        log.error('unhandled request error', { method: req.method, url: req.url, err });
        send(res, 500, { error: 'Internal server error', code: 'internal' });
      })
      .finally(() => {
        log.debug('request', { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - started });
      });
  });
};

export type ListenResult = { server: Server; port: number } | { inUseBy: 'open-loop' | 'other'; port: number };

/** Listens on loopback; reports whether a busy port is another Open Loop or a stranger. */
export const listen = async (opts: HttpOptions): Promise<ListenResult> => {
  const server = createHttpServer(opts);
  const host = opts.host ?? '127.0.0.1';
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    try {
      const r = await fetch(`http://127.0.0.1:${opts.port}/api/health`, {
        headers: { [API_HEADER]: API_HEADER_VALUE },
        signal: AbortSignal.timeout(1500),
      });
      const body = (await r.json()) as { name?: string };
      return { inUseBy: body.name === 'open-loop' ? 'open-loop' : 'other', port: opts.port };
    } catch {
      return { inUseBy: 'other', port: opts.port };
    }
  }
  return { server, port: (server.address() as AddressInfo).port };
};
