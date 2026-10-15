import { beforeEach, describe, expect, it } from 'vitest';
import { elementInfo, isStableClass, shallowHtml, uniqueSelector, xpathFor } from '../src/content/dom';

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <ul class="list">
        <li class="item css-1x2y3z">One</li>
        <li class="item css-9a8b7c">Two <button data-testid="buy">Buy</button></li>
        <li class="item">Three <button>Buy</button></li>
      </ul>
      <form><input id="email" type="email" value="me@example.com"><input type="password" value="hunter2"></form>
      <div id="r1:"><span>generated id</span></div>
    </main>`;
});

const unique = (sel: string, el: Element) => {
  const hits = document.querySelectorAll(sel);
  return hits.length === 1 && hits[0] === el;
};

describe('uniqueSelector', () => {
  it('prefers a stable id', () => {
    const el = document.getElementById('email')!;
    expect(uniqueSelector(el)).toBe('#email');
  });

  it('prefers a test id attribute', () => {
    const el = document.querySelector('[data-testid="buy"]')!;
    expect(uniqueSelector(el)).toBe('[data-testid="buy"]');
  });

  it('builds a unique structural path for anonymous elements', () => {
    for (const el of document.querySelectorAll('li, li button, span, input')) {
      const sel = uniqueSelector(el);
      expect(unique(sel, el), `${sel} should match exactly its element`).toBe(true);
    }
  });

  it('never uses hashed CSS-in-JS classes', () => {
    const el = document.querySelectorAll('li')[1]!;
    expect(uniqueSelector(el)).not.toContain('css-');
  });

  it('pierces shadow roots with >>>', () => {
    const host = document.createElement('x-card');
    host.id = 'card';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p><b class="title">Hi</b></p>';
    const inner = root.querySelector('b')!;
    const sel = uniqueSelector(inner);
    expect(sel.startsWith('#card >>> ')).toBe(true);
    expect(root.querySelector(sel.split(' >>> ')[1]!)).toBe(inner);
  });
});

describe('isStableClass', () => {
  it.each([
    ['btn', true],
    ['checkout-button', true],
    ['css-1x2y3z', false],
    ['sc-bdVaJa', false],
    ['Button_root__a8f3k', false],
    ['md:flex', false],
    ['w-[12px]', false],
  ])('%s → %s', (c, ok) => expect(isStableClass(c)).toBe(ok));
});

describe('element info', () => {
  it('xpath resolves to the element', () => {
    const el = document.querySelectorAll('li')[2]!;
    const xp = xpathFor(el);
    const hit = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    expect(hit).toBe(el);
  });

  it('never records form values', () => {
    const pw = document.querySelector('input[type=password]')!;
    const info = elementInfo(pw);
    expect(JSON.stringify(info)).not.toContain('hunter2');
    expect(info.text).toBeUndefined();
    expect(shallowHtml(document.getElementById('email')!)).not.toContain('me@example.com');
  });

  it('captures text, test id and elides children in html', () => {
    const btn = document.querySelector('[data-testid="buy"]')!;
    const info = elementInfo(btn);
    expect(info).toMatchObject({ tagName: 'button', testId: 'buy' });
    expect(info.attributes['data-testid']).toBe('buy');
    expect(shallowHtml(document.querySelector('ul')!)).toBe('<ul class="list">…</ul>');
  });
});
