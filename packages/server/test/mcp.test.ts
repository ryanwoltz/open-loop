import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp';
import { silentLogger } from '../src/logger';
import { payload, tempStore } from './fixtures';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

const connect = async () => {
  const store = await tempStore();
  const server = createMcpServer(store, silentLogger);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  return { store, client, call };
};

describe('MCP server', () => {
  it('exposes the agent toolset and the fix_report prompt', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'add_note',
      'get_annotation_crop',
      'get_logs',
      'get_report',
      'get_screenshot',
      'list_reports',
      'update_annotation_status',
      'update_report_status',
    ]);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['fix_report']);
  });

  it('lists active reports and reads one with trimmed logs and absolute paths', async () => {
    const { store, call } = await connect();
    const { report } = await store.create(payload());
    const list = await call('list_reports');
    expect(list.content[0]!.text).toContain(report.id);

    const got = JSON.parse((await call('get_report', { id: report.id })).content[0]!.text!);
    expect(got.annotations[0].element.components[0].name).toBe('PayButton');
    expect(got.files.annotated).toBe(store.filePath(report.id, 'annotated.png'));
    expect(got.logs.failedRequests.entries).toHaveLength(1);
    expect(got.logs.totals.network).toBe(2);
  });

  it('returns screenshots and crops as images', async () => {
    const { store, call } = await connect();
    const { report } = await store.create(payload());
    const shot = await call('get_screenshot', { id: report.id });
    expect(shot.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(shot.content[0]!.data!.length).toBeGreaterThan(10);
    const crop = await call('get_annotation_crop', { id: report.id, annotation_id: '1' });
    expect(crop.content[0]!.type).toBe('image');
    const noCrop = await call('get_annotation_crop', { id: report.id, annotation_id: 'a2' });
    expect(noCrop.content[0]!.text).toContain('no crop');
  });

  it('tracks resolution by marker number and rolls the report up', async () => {
    const { store, call } = await connect();
    const { report } = await store.create(payload());
    const r1 = await call('update_annotation_status', { id: report.id, annotation_id: '1', status: 'resolved', note: 'Fixed in PayButton.tsx' });
    expect(r1.content[0]!.text).toContain('1 annotation(s) still open');
    await call('update_annotation_status', { id: report.id, annotation_id: '2', status: 'resolved', note: 'Copy fixed' });
    const r = await store.get(report.id);
    expect(r.status).toBe('resolved');
    expect(r.annotations[0]!.resolution?.by).toBe('agent');
    const listed = await call('list_reports');
    expect(listed.content[0]!.text).toBe('No matching reports.');
  });

  it('filters logs', async () => {
    const { store, call } = await connect();
    const { report } = await store.create(payload());
    const out = JSON.parse((await call('get_logs', { id: report.id, kind: 'network', failed_only: true })).content[0]!.text!);
    expect(out.total).toBe(1);
    expect(out.entries[0].status).toBe(500);
  });

  it('returns tool errors instead of throwing', async () => {
    const { call } = await connect();
    const r = await call('get_report', { id: 'ol-20260101-aaaaaa' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('not found');
    const bad = await call('get_report', { id: '../../etc' });
    expect(bad.isError).toBe(true);
  });

  it('adds notes from the agent', async () => {
    const { store, call } = await connect();
    const { report } = await store.create(payload());
    await call('add_note', { id: report.id, message: 'Is the total supposed to wrap?', annotation_id: '1' });
    const r = await store.get(report.id);
    expect(r.activity.at(-1)).toMatchObject({ actor: 'agent', type: 'note', annotationId: 'a1' });
  });
});
