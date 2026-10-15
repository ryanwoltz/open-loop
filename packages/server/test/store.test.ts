import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ReportStore, StoreError, reportIdFor, sameDocument } from '../src/store';
import { payload, tempStore } from './fixtures';

describe('ReportStore.create', () => {
  it('writes report.json, four screenshots and crops, with server-owned fields', async () => {
    const store = await tempStore();
    const { report, created } = await store.create(payload());
    expect(created).toBe(true);
    expect(report.id).toMatch(/^ol-20261014-[a-z0-9]{6}$/);
    expect(report.status).toBe('open');
    expect(report.title).toBe('Pay button overlaps the total');
    expect(report.annotations.map((a) => a.status)).toEqual(['open', 'open']);
    expect(report.annotations[0]!.crop).toBe('crops/annotation-1.png');
    expect(report.annotations[1]!.crop).toBeUndefined();
    for (const f of ['report.json', 'original.png', 'annotated.png', 'original.preview.png', 'annotated.preview.png', 'crops/annotation-1.png']) {
      expect(existsSync(store.filePath(report.id, f))).toBe(true);
    }
    expect(report.activity[0]!.type).toBe('created');
  });

  it('dedupes a retried upload with the same client key', async () => {
    const store = await tempStore();
    const p = payload();
    const first = await store.create(p);
    const second = await store.create(p);
    expect(second.created).toBe(false);
    expect(second.report.id).toBe(first.report.id);
    expect((await store.list({ status: 'all', limit: 10 })).length).toBe(1);
  });

  it('dedupes concurrent uploads of the same report', async () => {
    const store = await tempStore();
    const p = payload();
    const results = await Promise.all([store.create(p), store.create(p), store.create(p)]);
    expect(results.filter((r) => r.created).length).toBe(1);
    const leftovers = (await readdir(store.reportsDir)).filter((n) => n.startsWith('.staging'));
    expect(leftovers).toEqual([]);
  });

  it('rejects invalid payloads and non-image data URLs', async () => {
    const store = await tempStore();
    await expect(store.create({ nope: true })).rejects.toBeInstanceOf(StoreError);
    const bad = payload();
    bad.images.original = 'data:text/html;base64,PGgxPg==';
    await expect(store.create(bad)).rejects.toThrow(/images.original/);
  });

  it('rejects duplicate annotation indexes', async () => {
    const store = await tempStore();
    const p = payload();
    p.annotations[1]!.index = 1;
    await expect(store.create(p)).rejects.toThrow(/Duplicate annotation index/);
  });
});

describe('ReportStore status tracking', () => {
  it('rolls the report up from its annotations', async () => {
    const store = await tempStore();
    const { report } = await store.create(payload());
    let r = await store.updateAnnotation(report.id, 'a1', { status: 'in_progress' }, { actor: 'agent' });
    expect(r.status).toBe('in_progress');
    r = await store.updateAnnotation(report.id, 'a1', { status: 'resolved', note: 'Fixed z-index in PayButton.tsx' }, { actor: 'agent' });
    expect(r.annotations[0]!.resolution).toMatchObject({ by: 'agent', note: 'Fixed z-index in PayButton.tsx' });
    expect(r.status).toBe('in_progress');
    r = await store.updateAnnotation(report.id, 'a2', { status: 'wont_fix' }, { actor: 'user' });
    expect(r.status).toBe('resolved');
    r = await store.updateAnnotation(report.id, 'a2', { status: 'open' }, { actor: 'user' });
    expect(r.status).toBe('in_progress');
    expect(r.annotations[1]!.resolution).toBeUndefined();
  });

  it('closing the report closes open annotations', async () => {
    const store = await tempStore();
    const { report } = await store.create(payload());
    const r = await store.update(report.id, { status: 'wont_fix', note: 'Duplicate of ol-x' }, { actor: 'user' });
    expect(r.annotations.every((a) => a.status === 'wont_fix')).toBe(true);
    expect(r.annotations[0]!.resolution?.note).toBe('Duplicate of ol-x');
  });

  it('serializes concurrent writers without losing updates', async () => {
    const store = await tempStore();
    const { report } = await store.create(payload());
    const other = new ReportStore(store.root); // a second process sharing the directory
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 ? store : other).addNote(report.id, `note ${i}`, { actor: 'agent' })),
    );
    const r = await store.get(report.id);
    expect(r.activity.filter((a) => a.type === 'note').length).toBe(12);
  });

  it('throws not_found for unknown reports and annotations', async () => {
    const store = await tempStore();
    await expect(store.get('ol-20260101-aaaaaa')).rejects.toMatchObject({ code: 'not_found' });
    const { report } = await store.create(payload());
    await expect(store.updateAnnotation(report.id, 'zz', { status: 'resolved' }, { actor: 'agent' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('ReportStore.list / files / trash', () => {
  it('filters by status, url and search', async () => {
    const store = await tempStore();
    const a = (await store.create(payload())).report;
    await store.create(payload({ page: { url: 'https://other.example.com/', title: 'Other' }, title: 'Banner misaligned' }));
    await store.update(a.id, { status: 'resolved' }, { actor: 'user' });
    expect((await store.list({ status: 'active', limit: 10 })).map((r) => r.title)).toEqual(['Banner misaligned']);
    expect((await store.list({ status: 'closed', limit: 10 })).map((r) => r.id)).toEqual([a.id]);
    expect((await store.list({ status: 'all', url: 'https://app.example.com/checkout', limit: 10 })).length).toBe(1);
    expect((await store.list({ status: 'all', search: 'banner', limit: 10 })).length).toBe(1);
  });

  it('refuses path traversal in ids and file names', async () => {
    const store = await tempStore();
    expect(() => store.reportDir('../../etc')).toThrow(StoreError);
    expect(() => store.filePath('ol-20260101-aaaaaa', '../report.json')).toThrow(StoreError);
    expect(() => store.filePath('ol-20260101-aaaaaa', 'crops/../../x')).toThrow(StoreError);
  });

  it('moves trashed reports out of the list', async () => {
    const store = await tempStore();
    const { report } = await store.create(payload());
    await store.trash(report.id);
    expect(await store.list({ status: 'all', limit: 10 })).toEqual([]);
    expect((await readdir(store.trashDir)).length).toBe(1);
  });
});

describe('helpers', () => {
  it('reportIdFor is stable per key', () => {
    expect(reportIdFor('k', '2026-01-02T00:00:00Z')).toBe(reportIdFor('k', '2026-01-02T00:00:00Z'));
    expect(reportIdFor('k', '2026-01-02T00:00:00Z')).not.toBe(reportIdFor('k2', '2026-01-02T00:00:00Z'));
  });

  it('sameDocument ignores hash and trailing slash', () => {
    expect(sameDocument('https://a.com/x/#h', 'https://a.com/x')).toBe(true);
    expect(sameDocument('https://a.com/x?q=1', 'https://a.com/x')).toBe(false);
  });
});
