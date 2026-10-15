import { describe, expect, it } from 'vitest';
import { CaptureBuffers, Ring } from '../src/content/buffers';
import { parseUserAgent } from '../src/content/device';
import { cropRect, fitWithin, pinCenter, toImageRect } from '../src/lib/geometry';
import { componentsFor } from '../src/main-world/components';

describe('buffers', () => {
  it('ring drops the oldest', () => {
    const r = new Ring<number>(3);
    [1, 2, 3, 4].forEach((n) => r.push(n));
    expect(r.toArray()).toEqual([2, 3, 4]);
  });

  it('collapses repeated console lines and counts failures', () => {
    const b = new CaptureBuffers();
    for (let i = 0; i < 3; i++) b.addConsole({ level: 'error', message: 'same', at: i });
    b.addConsole({ level: 'log', message: 'other', at: 9 });
    b.addNetwork({ method: 'GET', url: 'u', status: 500, ok: false, initiator: 'fetch', startedAt: 1, durationMs: 1 });
    expect(b.console.toArray()[0]).toMatchObject({ count: 3, at: 2 });
    expect(b.counts()).toMatchObject({ console: 2, consoleErrors: 1, failedRequests: 1 });
  });

  it('merges scroll bursts', () => {
    const b = new CaptureBuffers();
    b.addAction({ type: 'scroll', at: 0, detail: 'a' });
    b.addAction({ type: 'scroll', at: 500, detail: 'b' });
    b.addAction({ type: 'scroll', at: 5000, detail: 'c' });
    expect(b.actions.toArray().map((a) => a.detail)).toEqual(['b', 'c']);
  });
});

describe('geometry', () => {
  it('scales and clips to the image', () => {
    expect(toImageRect({ x: -10, y: 10, width: 50, height: 20 }, 2, 200, 200)).toEqual({ x: 0, y: 20, width: 80, height: 40 });
    expect(toImageRect({ x: 500, y: 0, width: 10, height: 10 }, 1, 100, 100)).toBeNull();
  });

  it('pads crops to a minimum size within bounds', () => {
    const c = cropRect({ x: 50, y: 50, width: 10, height: 10 }, 1, 1000, 1000, 32, 160)!;
    expect(c.width).toBeGreaterThanOrEqual(160);
    expect(c.height).toBeGreaterThanOrEqual(160);
    const edge = cropRect({ x: 0, y: 0, width: 10, height: 10 }, 1, 100, 100)!;
    expect(edge.x).toBe(0);
    expect(edge.x + edge.width).toBeLessThanOrEqual(100);
  });

  it('keeps pins inside the image and fits previews', () => {
    expect(pinCenter({ x: 0, y: 0, width: 5, height: 5 }, 10, 100, 100)).toEqual({ x: 12, y: 12 });
    expect(fitWithin(3000, 1500, 1568)).toEqual({ width: 1568, height: 784 });
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });
});

describe('parseUserAgent', () => {
  it('reads Chrome on macOS', () => {
    expect(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')).toEqual({
      browser: 'Chrome 140.0.0.0',
      os: 'macOS 10.15.7',
    });
  });

  it('reads Edge on Windows', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36 Edg/140.0.1')).toEqual({ browser: 'Edge 140.0.1', os: 'Windows 10/11' });
  });
});

describe('componentsFor', () => {
  it('walks a React fiber chain, skipping plumbing and keeping debug source', () => {
    const el = document.createElement('button');
    function PayButton() {}
    function CheckoutForm() {}
    const Memo = { $$typeof: Symbol.for('react.memo'), type: function Totals() {} };
    const fiber = {
      type: 'button',
      return: {
        type: PayButton,
        _debugSource: { fileName: '/src/PayButton.tsx', lineNumber: 12 },
        return: { type: Memo, return: { type: { displayName: 'Provider' }, return: { type: CheckoutForm, return: null } } },
      },
    };
    (el as unknown as Record<string, unknown>)['__reactFiber$abc'] = fiber;
    expect(componentsFor(el).frames).toEqual([
      { name: 'PayButton', framework: 'react', source: { file: '/src/PayButton.tsx', line: 12, column: undefined } },
      { name: 'Totals', framework: 'react' },
      { name: 'CheckoutForm', framework: 'react' },
    ]);
  });

  it('reads Vue 3 component instances from an ancestor', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.append(child);
    (parent as unknown as Record<string, unknown>).__vueParentComponent = {
      type: { __name: 'CartRow', __file: '/src/CartRow.vue' },
      parent: { type: { name: 'App' }, parent: null },
    };
    expect(componentsFor(child).frames.map((c) => c.name)).toEqual(['CartRow', 'App']);
  });

  it('returns nothing for plain DOM', () => {
    expect(componentsFor(document.createElement("div"))).toEqual({ frames: [], minified: false });
  });
});

import { dropMinified } from '@open-loop/shared/core';

describe('minified component chains', () => {
  const f = (name: string) => ({ name, framework: 'react' as const });

  it('drops short names when most of the chain is minified', () => {
    const chain = ['v2t', 'y2t', 'Ln', 'h2t', 'Sre', 'OrderFormPreview', 'kIt'].map(f);
    expect(dropMinified(chain)).toEqual({ frames: [f('OrderFormPreview')], minified: true });
  });

  it('keeps a dev chain with a few short real names', () => {
    const chain = ['Row', 'CartTable', 'CheckoutPage', 'App'].map(f);
    expect(dropMinified(chain)).toEqual({ frames: chain, minified: false });
  });

  it('skips router plumbing seen on a real production page', () => {
    const el = document.createElement('div');
    const chain = { type: function Location() {}, return: { type: function Navigation() {}, return: { type: function OrderForm() {}, return: null } } };
    (el as unknown as Record<string, unknown>)['__reactFiber$x'] = chain;
    expect(componentsFor(el).frames.map((c) => c.name)).toEqual(['OrderForm']);
  });
});
