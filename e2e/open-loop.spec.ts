import { type BrowserContext, type Page, chromium, expect, test } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const EXT = join(ROOT, 'packages/extension/dist');
const CLI = join(ROOT, 'packages/server/dist/cli.js');
const API_PORT = 17865;
const API = `http://127.0.0.1:${API_PORT}`;

let site: Server;
let siteUrl: string;
let api: ChildProcess | undefined;
let home: string;
let context: BrowserContext;
let extId: string;
let panel: Page;

const startApi = async () => {
  api = spawn(process.execPath, [CLI, 'serve'], { env: { ...process.env, OPEN_LOOP_HOME: home, OPEN_LOOP_PORT: String(API_PORT) }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${API}/api/health`, { headers: { 'x-open-loop': '1' } });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('API did not start');
};
const stopApi = async () => {
  if (!api) return;
  const p = new Promise((r) => api!.once('exit', r));
  api.kill('SIGTERM');
  await p;
  api = undefined;
};
const apiGet = async <T>(path: string): Promise<T> => (await fetch(`${API}${path}`, { headers: { 'x-open-loop': '1' } })).json() as Promise<T>;

/** Sends a message to the background as the side panel would. */
const bg = <T>(msg: unknown): Promise<T> =>
  panel.evaluate(async (m) => {
    const res = await chrome.runtime.sendMessage(m);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }, msg) as Promise<T>;

test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'open-loop-e2e-'));
  const html = readFileSync(join(__dirname, 'fixtures/app.html'));
  site = createServer((req, res) => {
    if (req.url?.startsWith('/api/pay')) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'card_declined', sessionToken: 'abc' }));
    } else if (req.url?.startsWith('/api/cart')) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no cart');
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    }
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  siteUrl = `http://127.0.0.1:${(site.address() as { port: number }).port}/checkout`;
  await startApi();

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate((url) => chrome.storage.local.set({ 'ol:settings': { serverUrl: url } }), API);
});

test.afterAll(async () => {
  await context?.close();
  await stopApi();
  site?.close();
});

const shadow = (page: Page) => page.locator('open-loop-overlay');
/** Set OPEN_LOOP_SHOTS=<dir> to save UI screenshots for visual review. */
const shot = async (p: Page, name: string) => {
  if (process.env.OPEN_LOOP_SHOTS) await p.screenshot({ path: join(process.env.OPEN_LOOP_SHOTS, `${name}.png`) });
};

test('annotate, capture and save a report with full context', async () => {
  const page = await context.newPage();
  await page.goto(siteUrl);
  await page.click('#fail');
  await page.fill('#card', '4242424242424242');
  await page.waitForTimeout(800);

  const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}*` }))[0]!.id!, siteUrl);
  const counts = await bg<{ counts: { consoleErrors: number; failedRequests: number; errors: number } }>({ type: 'getTabState', tabId });
  expect(counts.counts.consoleErrors).toBeGreaterThanOrEqual(1);
  expect(counts.counts.failedRequests).toBe(2);
  expect(counts.counts.errors).toBeGreaterThanOrEqual(1);

  await page.bringToFront();
  await bg({ type: 'startAnnotating', tabId, tool: 'element' });
  await expect(shadow(page).locator('.toolbar')).toBeVisible();

  // Element annotation: hover, ↑ to parent and ↓ back, click, comment.
  const pay = await page.locator('#pay').boundingBox();
  await page.mouse.move(pay!.x + 10, pay!.y + 10);
  await expect(shadow(page).locator('.hover-label')).toContainText('button#pay');
  await expect(shadow(page).locator('.hover-label')).toContainText('PayButton');
  await page.keyboard.press('ArrowUp');
  await expect(shadow(page).locator('.hover-label')).toContainText('section');
  await page.keyboard.press('ArrowDown');
  await page.mouse.click(pay!.x + 10, pay!.y + 10);
  await shadow(page).locator('.ed-text').fill('Pay button should be green');
  await shot(page, '1-editor');
  await shadow(page).locator('.cat[data-cat="ui"]').click();
  await shadow(page).locator('.primary.ok').click();
  await expect(shadow(page).locator('.mark .pin')).toHaveText(['1']);

  // The click annotated instead of paying: the page never saw it.
  const actionsBefore = (await bg<{ counts: { actions: number } }>({ type: 'getTabState', tabId })).counts.actions;

  // Region annotation by dragging.
  const area = await page.locator('#empty-area').boundingBox();
  await page.mouse.move(area!.x + 20, area!.y + 20);
  await page.mouse.down();
  await page.mouse.move(area!.x + 200, area!.y + 120, { steps: 6 });
  await page.mouse.up();
  await shadow(page).locator('.ed-text').fill('Too much empty space');
  await page.keyboard.press('Meta+Enter');
  await expect(shadow(page).locator('.mark .pin')).toHaveText(['1', '2']);

  // Production-style minified chain: short names dropped, flagged.
  const total = await page.locator('.total').boundingBox();
  await page.mouse.click(total!.x + 5, total!.y + 5);
  await shadow(page).locator('.ed-text').fill('Total is too big');
  await shadow(page).locator('.primary.ok').click();
  await expect(shadow(page).locator('.mark .pin')).toHaveText(['1', '2', '3']);

  await page.mouse.move(pay!.x + 10, pay!.y + 10);
  await shot(page, '2-annotating');
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.reload();
  await shot(panel, '3-panel-capture');
  await panel.setViewportSize({ width: 1280, height: 800 });
  await page.bringToFront();
  const state = await bg<{ drafts: Array<{ label: string; element?: { components: Array<{ name: string }> } }>; counts: { actions: number } }>({ type: 'getTabState', tabId });
  expect(state.drafts).toHaveLength(3);
  expect(state.drafts[0]!.label).toContain('PayButton');
  expect(state.counts.actions).toBe(actionsBefore);

  // Save from the in-page toolbar.
  await shadow(page).locator('.toolbar .save').click();
  await expect(shadow(page).locator('.toast')).toContainText(/Report ol-\d{8}-[a-z0-9]{6} saved/, { timeout: 15_000 });
  await expect(shadow(page).locator('.mark')).toHaveCount(0);
  await expect(shadow(page).locator('.toolbar')).toBeHidden();

  const { reports } = await apiGet<{ reports: Array<{ id: string; annotationCount: number }> }>('/api/reports?status=all');
  expect(reports).toHaveLength(1);
  const { report } = await apiGet<{ report: any }>(`/api/reports/${reports[0]!.id}`);

  expect(report.title).toBe('Pay button should be green');
  expect(report.annotations[0]).toMatchObject({ index: 1, kind: 'element', category: 'ui', inViewport: true });
  expect(report.annotations[0].element.selector).toBe('#pay');
  expect(report.annotations[0].element.testId).toBe('pay-button');
  expect(report.annotations[0].element.components[0]).toEqual({
    name: 'PayButton',
    framework: 'react',
    source: { file: '/src/PayButton.tsx', line: 12, column: 3 },
  });
  expect(report.annotations[1]).toMatchObject({ index: 2, kind: 'region', comment: 'Too much empty space' });
  expect(report.annotations[0].crop).toBe('crops/annotation-1.png');
  expect(report.annotations[0].element.componentsMinified).toBeUndefined();
  expect(report.annotations[2].element.components.map((c: any) => c.name)).toEqual(['TotalsCard']);
  expect(report.annotations[2].element.componentsMinified).toBe(true);

  // Logs.
  expect(report.console.some((c: any) => c.level === 'error' && c.message.includes('Payment failed'))).toBe(true);
  expect(report.console.some((c: any) => c.message.includes('fixture booted') && c.message.includes('"cart":3'))).toBe(true);
  const payReq = report.network.find((n: any) => n.url.includes('/api/pay'));
  expect(payReq).toMatchObject({ method: 'POST', status: 500, ok: false, initiator: 'fetch' });
  expect(payReq.url).toContain('token=REDACTED');
  expect(payReq.requestBody).toContain('"password":"REDACTED"');
  expect(payReq.responseBody).toContain('"sessionToken":"REDACTED"');
  expect(report.network.find((n: any) => n.url.includes('/api/cart'))).toMatchObject({ status: 404, initiator: 'xhr', responseBody: 'no cart' });
  expect(report.errors.some((e: any) => e.message.includes('Uncaught checkout crash'))).toBe(true);
  expect(report.network.find((n: any) => n.url.includes('/api/tiles'))).toMatchObject({ ok: false, aborted: true, error: 'Aborted' });
  expect(report.actions.some((a: any) => a.type === 'click' && a.target === '#fail')).toBe(true);
  expect(report.actions.some((a: any) => a.type === 'input' && a.detail === 'typed a password')).toBe(true);
  expect(JSON.stringify(report)).not.toContain('4242424242424242');
  expect(JSON.stringify(report)).not.toContain('hunter2');
  expect(JSON.stringify(report)).not.toContain('secret123');

  // Device & screenshots.
  expect(report.viewport).toMatchObject({ width: 1280, height: 800 });
  expect(report.device.browser).toMatch(/Chrome/);
  const dir = join(home, 'reports', report.id);
  if (process.env.OPEN_LOOP_SHOTS) require('node:fs').copyFileSync(join(dir, report.screenshots.annotated), join(process.env.OPEN_LOOP_SHOTS, '6-annotated-output.png'));
  const original = readFileSync(join(dir, report.screenshots.original));
  const annotated = readFileSync(join(dir, report.screenshots.annotated));
  expect(original.subarray(1, 4).toString()).toBe('PNG');
  expect(annotated.equals(original)).toBe(false);
  expect(report.screenshots.width).toBe(1280 * report.viewport.devicePixelRatio);
  expect(existsSync(join(dir, report.screenshots.annotatedPreview))).toBe(true);
  expect(existsSync(join(dir, 'crops/annotation-1.png'))).toBe(true);
  await page.close();
});

test('side panel shows the report and reflects an agent resolving it', async () => {
  const { reports } = await apiGet<{ reports: Array<{ id: string }> }>('/api/reports?status=all');
  const id = reports[0]!.id;
  for (const aid of (await apiGet<{ report: any }>(`/api/reports/${id}`)).report.annotations.map((a: any) => a.id)) {
    await fetch(`${API}/api/reports/${id}/annotations/${aid}`, {
      method: 'PATCH',
      headers: { 'x-open-loop': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', note: 'Fixed in PayButton.tsx' }),
    });
  }
  await panel.bringToFront();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.reload();
  await panel.getByRole('tab', { name: 'Issues' }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await expect(panel.locator('.report-row')).toHaveCount(1);
  await expect(panel.locator('.report-row .badge').first()).toHaveText('Resolved');
  await expect(panel.locator('.progress small')).toHaveText('3/3');
  await shot(panel, '4-panel-issues');
  await panel.locator('.report-row').click();
  await expect(panel.locator('.detail-title')).toHaveText('Pay button should be green');
  await expect(panel.locator('.resolution').first()).toContainText('Fixed in PayButton.tsx');
  await expect(panel.locator('.shot-frame img')).toBeVisible();
  await shot(panel, '5-panel-detail');
});

test('queues reports while the server is down and uploads them later', async () => {
  await stopApi();
  const page = await context.newPage();
  await page.goto(`${siteUrl}?offline=1`);
  const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}?offline=1` }))[0]!.id!, siteUrl);
  await page.bringToFront();
  await bg({ type: 'startAnnotating', tabId, tool: 'element' });
  const pay = await page.locator('#pay').boundingBox();
  await page.mouse.click(pay!.x + 5, pay!.y + 5);
  await shadow(page).locator('.ed-text').fill('Offline note');
  await shadow(page).locator('.primary.ok').click();
  const result = await bg<{ queued: boolean }>({
    type: 'submitReport',
    tabId,
    meta: { priority: 'high', include: { console: true, network: true, actions: true } },
  });
  expect(result.queued).toBe(true);
  const status = await bg<{ queue: unknown[] }>({ type: 'getStatus' });
  expect(status.queue).toHaveLength(1);

  await startApi();
  const flushed = await bg<{ sent: number; remaining: number }>({ type: 'retryQueue' });
  expect(flushed).toEqual({ sent: 1, remaining: 0 });
  const { reports } = await apiGet<{ reports: Array<{ title: string; priority: string }> }>('/api/reports?status=all');
  expect(reports.map((r) => r.title)).toContain('Offline note');
  await page.close();
});

test('turning Open Loop off stops capture and annotation', async () => {
  await bg({ type: 'setEnabled', enabled: false });
  const page = await context.newPage();
  await page.goto(`${siteUrl}?off=1`);
  await page.click('#fail');
  await page.waitForTimeout(500);
  const tabId = await panel.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}?off=1` }))[0]!.id!, siteUrl);
  const state = await bg<{ counts: { console: number; network: number } }>({ type: 'getTabState', tabId });
  expect(state.counts).toMatchObject({ console: 0, network: 0 });
  await expect(bg({ type: 'startAnnotating', tabId, tool: 'element' })).rejects.toThrow(/Turn Open Loop on/);
  await bg({ type: 'setEnabled', enabled: true });
  await page.close();
});
