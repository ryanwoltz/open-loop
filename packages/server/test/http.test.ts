import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { listen } from '../src/http';
import { silentLogger } from '../src/logger';
import { payload, tempStore } from './fixtures';

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

const start = async () => {
  const store = await tempStore();
  const r = await listen({ store, log: silentLogger, port: 0 });
  if (!('server' in r)) throw new Error('port busy');
  server = r.server;
  const base = `http://127.0.0.1:${r.port}`;
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { 'x-open-loop': '1', 'content-type': 'application/json', ...(init.headers ?? {}) } });
  return { store, base, port: r.port, api };
};

/** fetch() can't spoof Host; node:http can. */
const rawGet = (port: number, path: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });

describe('HTTP API', () => {
  it('creates, lists, reads, patches and trashes a report', async () => {
    const { api } = await start();
    const created = await api('/api/reports', { method: 'POST', body: JSON.stringify(payload()) });
    expect(created.status).toBe(201);
    const { report } = (await created.json()) as { report: { id: string } };

    const list = (await (await api('/api/reports?status=active')).json()) as { reports: unknown[] };
    expect(list.reports).toHaveLength(1);

    const patched = await api(`/api/reports/${report.id}/annotations/a1`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved', note: 'done' }),
    });
    expect(patched.status).toBe(200);

    const note = await api(`/api/reports/${report.id}/notes`, { method: 'POST', body: JSON.stringify({ message: 'hi' }) });
    expect(note.status).toBe(200);

    const img = await api(`/api/reports/${report.id}/files/annotated.preview.png`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const crop = await api(`/api/reports/${report.id}/files/crops/annotation-1.png`);
    expect(crop.status).toBe(200);

    expect((await api(`/api/reports/${report.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await api(`/api/reports/${report.id}`)).status).toBe(404);
  });

  it('returns 200 (not 201) for a retried upload', async () => {
    const { api } = await start();
    const body = JSON.stringify(payload());
    expect((await api('/api/reports', { method: 'POST', body })).status).toBe(201);
    expect((await api('/api/reports', { method: 'POST', body })).status).toBe(200);
  });

  it('maps validation errors to 400 and unknown ids to 404', async () => {
    const { api } = await start();
    expect((await api('/api/reports', { method: 'POST', body: '{"x":1}' })).status).toBe(400);
    expect((await api('/api/reports', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await api('/api/reports/ol-20260101-aaaaaa')).status).toBe(404);
    expect((await api('/api/reports/..%2F..%2Fetc')).status).toBe(400);
    expect((await api('/api/reports/ol-20260101-aaaaaa', { method: 'PATCH', body: '{"bogus":1}' })).status).toBe(400);
  });

  it('refuses requests without the API header', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/health`)).status).toBe(403);
  });

  it('refuses web origins, allows extension origins and their preflight', async () => {
    const { api, base } = await start();
    expect((await api('/api/health', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    const ok = await api('/api/health', { headers: { origin: EXT } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(EXT);
    const pre = await fetch(`${base}/api/reports`, { method: 'OPTIONS', headers: { origin: EXT } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-open-loop');
    const evilPre = await fetch(`${base}/api/reports`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(evilPre.status).toBe(403);
  });

  it('refuses a non-loopback Host header (DNS rebinding)', async () => {
    const { port } = await start();
    expect(await rawGet(port, '/api/health', { host: `evil.example:${port}`, 'x-open-loop': '1' })).toBe(403);
    expect(await rawGet(port, '/api/health', { host: `localhost:${port}`, 'x-open-loop': '1' })).toBe(200);
  });

  it('reports a busy port as another open-loop', async () => {
    const { port, store } = await start();
    const second = await listen({ store, log: silentLogger, port });
    expect(second).toEqual({ inUseBy: 'open-loop', port });
  });
});
