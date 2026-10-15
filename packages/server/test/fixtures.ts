import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewReportPayload } from '@open-loop/shared';
import { ReportStore } from '../src/store';

/** A real 1×1 PNG. */
export const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const tempStore = async (): Promise<ReportStore> => {
  const dir = await mkdtemp(join(tmpdir(), 'open-loop-test-'));
  const store = new ReportStore(dir);
  await store.init();
  return store;
};

let n = 0;
export const payload = (over: Partial<NewReportPayload> = {}): NewReportPayload => ({
  priority: 'high',
  tags: [],
  page: { url: 'https://app.example.com/checkout#step2', title: 'Checkout' },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 120, devicePixelRatio: 2, documentWidth: 1280, documentHeight: 2400 },
  device: {
    userAgent: 'Mozilla/5.0 Chrome/140',
    browser: 'Chrome 140',
    os: 'macOS',
    platform: 'MacIntel',
    language: 'en-US',
    languages: ['en-US'],
    timezone: 'America/New_York',
    screen: { width: 1512, height: 982, colorDepth: 30 },
    colorScheme: 'light',
    reducedMotion: false,
    touch: false,
    online: true,
  },
  annotations: [
    {
      id: 'a1',
      index: 1,
      kind: 'element',
      category: 'bug',
      comment: 'Pay button overlaps the total',
      rect: { x: 10, y: 20, width: 100, height: 40 },
      inViewport: true,
      element: {
        selector: '#pay',
        xpath: '//*[@id="pay"]',
        tagName: 'button',
        id: 'pay',
        classes: ['btn'],
        attributes: {},
        html: '<button id="pay" class="btn">…</button>',
        styles: {},
        components: [{ name: 'PayButton', framework: 'react' }],
      },
      cropDataUrl: PNG_1PX,
    },
    {
      id: 'a2',
      index: 2,
      kind: 'region',
      category: 'copy',
      comment: 'Typo in heading',
      rect: { x: 0, y: 0, width: 50, height: 50 },
      inViewport: true,
    },
  ],
  console: [{ level: 'error', message: 'TypeError: x is undefined', at: 1 }],
  network: [
    { method: 'POST', url: 'https://api.example.com/pay', status: 500, ok: false, initiator: 'fetch', startedAt: 2, durationMs: 30 },
    { method: 'GET', url: 'https://api.example.com/cart', status: 200, ok: true, initiator: 'xhr', startedAt: 1, durationMs: 10 },
  ],
  errors: [],
  actions: [{ type: 'click', at: 3, target: '#pay' }],
  images: {
    original: PNG_1PX,
    annotated: PNG_1PX,
    originalPreview: PNG_1PX,
    annotatedPreview: PNG_1PX,
    width: 1,
    height: 1,
  },
  extensionVersion: '0.1.0',
  capturedAt: '2026-10-14T12:00:00.000Z',
  clientKey: `test-key-${++n}-${Math.random()}`,
  ...over,
});
