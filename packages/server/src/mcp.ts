import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ANNOTATION_STATUSES, REPORT_STATUSES, dropMinified, type Annotation, type Report } from '@open-loop/shared';
import { mimeFor, type ReportStore, StoreError } from './store';
import type { Logger } from './logger';
import { VERSION } from './version';

const INSTRUCTIONS = `Open Loop holds bug reports a person captured in their browser: a screenshot,
the same screenshot with numbered markers, a comment per marker, the DOM element and framework
component each marker points at, and the page's console, network, error and user-action logs.

Typical workflow:
1. list_reports (defaults to unresolved reports) to see what is waiting.
2. get_report for the comments, element selectors, component names and log excerpts.
3. get_screenshot (annotated) to see what the person saw; get_annotation_crop for one marker up close.
4. Fix the code. Mark progress with update_annotation_status (in_progress, then resolved with a note
   saying what you changed and where). The report resolves itself when every annotation is closed.
5. Use add_note for questions or partial findings; the person sees notes in the extension.`;

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const failure = (err: unknown) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: err instanceof StoreError || err instanceof Error ? err.message : `Unexpected error: ${String(err)}`,
    },
  ],
});

const tail = <T>(items: T[], n: number) => ({
  entries: items.slice(-n),
  omitted: Math.max(0, items.length - n),
});

/** Re-applies the minified-name filter so reports from older extension builds read cleanly too. */
const cleanElement = (el: Annotation['element']): Annotation['element'] => {
  if (!el || el.componentsMinified) return el;
  const { frames, minified } = dropMinified(el.components);
  return minified ? { ...el, components: frames, componentsMinified: true } : el;
};

/** The report as an agent should read it: logs trimmed, file paths absolute. */
export const agentView = (store: ReportStore, r: Report, maxLog: number) => {
  const failedNetwork = r.network.filter((n) => !n.ok);
  const errorsAndWarnings = r.console.filter((c) => c.level === 'error' || c.level === 'warn');
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    tags: r.tags,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    page: r.page,
    viewport: r.viewport,
    device: r.device,
    performance: r.performance,
    annotations: r.annotations.map((a) => {
      const element = cleanElement(a.element);
      return {
        ...a,
        ...(element ? { element } : {}),
        crop: a.crop ? store.filePath(r.id, a.crop) : undefined,
        ...(element?.componentsMinified
          ? { hint: 'Production build: component names were minified. Find the code by element.testId, selector classes or visible text.' }
          : {}),
      };
    }),
    files: {
      original: store.filePath(r.id, r.screenshots.original),
      annotated: store.filePath(r.id, r.screenshots.annotated),
      reportJson: store.filePath(r.id, 'report.json'),
    },
    logs: {
      note: `Showing up to ${maxLog} most recent entries per section; call get_logs for more or to filter.`,
      errors: tail(r.errors, maxLog),
      consoleErrorsAndWarnings: tail(errorsAndWarnings, maxLog),
      failedRequests: tail(failedNetwork, maxLog),
      recentActions: tail(r.actions, Math.min(maxLog, 30)),
      totals: {
        console: r.console.length,
        network: r.network.length,
        failedRequests: failedNetwork.length,
        errors: r.errors.length,
        actions: r.actions.length,
      },
    },
    activity: r.activity,
  };
};

export const createMcpServer = (store: ReportStore, log: Logger): McpServer => {
  const mlog = log.child('mcp');
  const server = new McpServer({ name: 'open-loop', version: VERSION }, { instructions: INSTRUCTIONS });

  const guarded =
    <A>(name: string, fn: (args: A) => Promise<ReturnType<typeof text> | Record<string, unknown>>) =>
    async (args: A) => {
      try {
        const out = await fn(args);
        mlog.info('tool call', { tool: name });
        return out as ReturnType<typeof text>;
      } catch (err) {
        // Bad ids and the like are the caller's mistake, not ours: no stack.
        if (err instanceof StoreError) mlog.info('tool call refused', { tool: name, reason: err.message });
        else mlog.error('tool call failed', { tool: name, err });
        return failure(err);
      }
    };

  server.registerTool(
    'list_reports',
    {
      title: 'List Open Loop reports',
      description:
        'Lists captured browser bug reports, newest first. status "active" (default) = open or in progress; "closed" = resolved or won\'t fix.',
      inputSchema: {
        status: z.enum(['active', 'closed', 'all', ...REPORT_STATUSES]).optional(),
        url: z.string().optional().describe('Only reports captured on this page URL (hash ignored).'),
        search: z.string().optional().describe('Case-insensitive match on id, title, URL and comments.'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guarded('list_reports', async (a) => {
      const reports = await store.list({ status: a.status ?? 'active', url: a.url, search: a.search, limit: a.limit ?? 50 });
      if (reports.length === 0) return text('No matching reports.');
      return text({ count: reports.length, reports });
    }),
  );

  server.registerTool(
    'get_report',
    {
      title: 'Get an Open Loop report',
      description:
        'Full report: annotations (comment, category, selector, XPath, component chain with source file when known, styles), page, device, performance, trimmed logs and activity.',
      inputSchema: {
        id: z.string().describe('Report id, e.g. ol-20261014-a1b2c3'),
        max_log_entries: z.number().int().min(0).max(500).optional().describe('Per log section; default 50.'),
      },
      annotations: { readOnlyHint: true },
    },
    guarded('get_report', async (a) => text(agentView(store, await store.get(a.id), a.max_log_entries ?? 50))),
  );

  server.registerTool(
    'get_screenshot',
    {
      title: 'Get a report screenshot',
      description:
        'Returns the screenshot as an image. "annotated" has numbered markers matching annotation index; "original" is untouched. Previews are downscaled for reading; set full_resolution for pixel detail.',
      inputSchema: {
        id: z.string(),
        variant: z.enum(['annotated', 'original']).optional(),
        full_resolution: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guarded('get_screenshot', async (a) => {
      const r = await store.get(a.id);
      const variant = a.variant ?? 'annotated';
      const name = a.full_resolution
        ? r.screenshots[variant]
        : r.screenshots[variant === 'annotated' ? 'annotatedPreview' : 'originalPreview'];
      const path = store.filePath(r.id, name);
      const data = (await readFile(path)).toString('base64');
      return {
        content: [
          { type: 'image', data, mimeType: mimeFor(name) },
          { type: 'text', text: `${variant} screenshot of ${r.page.url} (${path})` },
        ],
      };
    }),
  );

  server.registerTool(
    'get_annotation_crop',
    {
      title: 'Get one annotation up close',
      description: 'Returns the original screenshot cropped around one annotation, with its comment.',
      inputSchema: { id: z.string(), annotation_id: z.string().describe('Annotation id or its marker number') },
      annotations: { readOnlyHint: true },
    },
    guarded('get_annotation_crop', async (a) => {
      const r = await store.get(a.id);
      const ann = r.annotations.find((x) => x.id === a.annotation_id || String(x.index) === a.annotation_id);
      if (!ann) throw new StoreError(`Annotation ${a.annotation_id} not found in ${r.id}`, 'not_found');
      if (!ann.crop) {
        return text(`Annotation #${ann.index} has no crop (it was outside the captured viewport). Comment: ${ann.comment}`);
      }
      const data = (await readFile(store.filePath(r.id, ann.crop))).toString('base64');
      return {
        content: [
          { type: 'image', data, mimeType: mimeFor(ann.crop) },
          { type: 'text', text: `#${ann.index} [${ann.category}] ${ann.comment}${ann.element ? `\nselector: ${ann.element.selector}` : ''}` },
        ],
      };
    }),
  );

  server.registerTool(
    'get_logs',
    {
      title: 'Get report logs',
      description: 'One log section of a report, filtered. Timestamps are epoch ms.',
      inputSchema: {
        id: z.string(),
        kind: z.enum(['console', 'network', 'errors', 'actions']),
        level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional().describe('console only'),
        failed_only: z.boolean().optional().describe('network only'),
        contains: z.string().optional().describe('Case-insensitive substring filter'),
        limit: z.number().int().min(1).max(2000).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guarded('get_logs', async (a) => {
      const r = await store.get(a.id);
      let rows: unknown[] = r[a.kind];
      if (a.kind === 'console' && a.level) rows = r.console.filter((c) => c.level === a.level);
      if (a.kind === 'network' && a.failed_only) rows = r.network.filter((n) => !n.ok);
      if (a.contains) {
        const needle = a.contains.toLowerCase();
        rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
      }
      const t = tail(rows, a.limit ?? 200);
      return text({ kind: a.kind, total: rows.length, omitted: t.omitted, entries: t.entries });
    }),
  );

  server.registerTool(
    'update_annotation_status',
    {
      title: 'Update an annotation',
      description:
        'Set one annotation to in_progress, resolved, wont_fix or open. When closing, put what you changed (files, approach) in note — the person reads it. The report status follows automatically.',
      inputSchema: {
        id: z.string(),
        annotation_id: z.string().describe('Annotation id or its marker number'),
        status: z.enum(ANNOTATION_STATUSES),
        note: z.string().max(5000).optional(),
      },
      annotations: { idempotentHint: true },
    },
    guarded('update_annotation_status', async (a) => {
      const r = await store.get(a.id);
      const ann = r.annotations.find((x) => x.id === a.annotation_id || String(x.index) === a.annotation_id);
      if (!ann) throw new StoreError(`Annotation ${a.annotation_id} not found in ${r.id}`, 'not_found');
      const next = await store.updateAnnotation(r.id, ann.id, { status: a.status, note: a.note }, { actor: 'agent' });
      const open = next.annotations.filter((x) => x.status === 'open' || x.status === 'in_progress').length;
      return text(`#${ann.index} is now ${a.status}. Report ${next.id} is ${next.status}; ${open} annotation(s) still open.`);
    }),
  );

  server.registerTool(
    'update_report_status',
    {
      title: 'Update a report',
      description: 'Set the whole report status. Closing it (resolved/wont_fix) also closes its open annotations with the same note.',
      inputSchema: {
        id: z.string(),
        status: z.enum(REPORT_STATUSES),
        note: z.string().max(5000).optional(),
      },
      annotations: { idempotentHint: true },
    },
    guarded('update_report_status', async (a) => {
      const next = await store.update(a.id, { status: a.status, note: a.note }, { actor: 'agent' });
      const open = next.annotations.filter((x) => x.status === 'open' || x.status === 'in_progress').length;
      const hint =
        (next.status === 'open' || next.status === 'in_progress') && next.annotations.length > 0 && open === 0
          ? ' Every annotation is still closed: reopen the ones that need work with update_annotation_status.'
          : '';
      return text(`Report ${next.id} is now ${next.status}.${hint}`);
    }),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add a note to a report',
      description: 'Adds a note to the report activity (optionally about one annotation). Use for questions or findings.',
      inputSchema: {
        id: z.string(),
        message: z.string().min(1).max(5000),
        annotation_id: z.string().optional(),
      },
    },
    guarded('add_note', async (a) => {
      let annotationId: string | undefined;
      if (a.annotation_id) {
        const r = await store.get(a.id);
        annotationId = r.annotations.find((x) => x.id === a.annotation_id || String(x.index) === a.annotation_id)?.id;
        if (!annotationId) throw new StoreError(`Annotation ${a.annotation_id} not found in ${r.id}`, 'not_found');
      }
      await store.addNote(a.id, a.message, { actor: 'agent' }, annotationId);
      return text('Note added.');
    }),
  );

  server.registerPrompt(
    'fix_report',
    {
      title: 'Fix an Open Loop report',
      description: 'Work through every open annotation on a report and mark each one as you go.',
      argsSchema: { id: z.string().describe('Report id; leave empty for the newest open report').optional() },
    },
    ({ id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${id ? `Open Loop report ${id}` : 'The newest open Open Loop report (use list_reports)'}: read it with get_report and look at the annotated screenshot. For each open annotation, find the responsible code (use the selector, component chain and source hints), fix it, then mark it resolved with update_annotation_status and a note naming the files you changed. If something is unclear, add_note with your question instead of guessing.`,
          },
        },
      ],
    }),
  );

  return server;
};
