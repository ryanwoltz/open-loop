import type { ElementInfo } from '@open-loop/shared';
import { truncate } from '@open-loop/shared/core';

const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'];
const KEEP_ATTRS = new Set(['name', 'type', 'href', 'src', 'alt', 'placeholder', 'title', 'role', 'for', 'action', 'method', 'disabled', 'aria-disabled', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-hidden', 'tabindex']);
const STYLE_PROPS = [
  'display', 'position', 'top', 'left', 'z-index', 'width', 'height', 'margin', 'padding', 'box-sizing',
  'color', 'background-color', 'border', 'border-radius', 'opacity', 'overflow', 'visibility',
  'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'white-space',
  'flex-direction', 'align-items', 'justify-content', 'gap', 'grid-template-columns', 'transform',
];

/** Class names that look generated (CSS-in-JS hashes, CSS modules) make brittle selectors. */
export const isStableClass = (c: string): boolean =>
  c.length > 0 &&
  c.length <= 40 &&
  !/^(css|sc|jsx|emotion|svelte|tw|chakra|mui|Mui[A-Z]\w*-root)-/.test(c) &&
  !/^[a-z]{1,3}-[a-zA-Z0-9]{5,}$/.test(c) &&
  !/__[a-zA-Z0-9]{5,}$/.test(c) &&
  !/[0-9a-f]{6,}/i.test(c) &&
  !/[:[\]/@!]/.test(c); // Tailwind variants like md:flex or w-[12px]

const esc = (s: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1'));

const rootOf = (el: Element): Document | ShadowRoot => {
  const r = el.getRootNode();
  return r instanceof ShadowRoot ? r : el.ownerDocument;
};

const uniqueIn = (root: Document | ShadowRoot, selector: string, el: Element): boolean => {
  try {
    const hits = root.querySelectorAll(selector);
    return hits.length === 1 && hits[0] === el;
  } catch {
    return false;
  }
};

const segment = (el: Element): string => {
  const tag = el.localName;
  const parent = el.parentElement;
  const classes = [...el.classList].filter(isStableClass).slice(0, 2).map((c) => `.${esc(c)}`).join('');
  let seg = tag + classes;
  if (parent) {
    const same = [...parent.children].filter((c) => c.localName === tag && (classes ? c.matches(seg) : true));
    if (same.length > 1) seg += `:nth-of-type(${[...parent.children].filter((c) => c.localName === tag).indexOf(el) + 1})`;
  }
  return seg;
};

/** Shortest reasonably stable CSS selector unique within the element's root (document or shadow root). */
export const selectorWithinRoot = (el: Element): string => {
  const root = rootOf(el);
  if (el.id && !/^\d|[0-9a-f]{8,}|:r[0-9a-z]+:/i.test(el.id)) {
    const s = `#${esc(el.id)}`;
    if (uniqueIn(root, s, el)) return s;
  }
  for (const attr of TEST_ID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) {
      const s = `[${attr}="${v.replace(/"/g, '\\"')}"]`;
      if (uniqueIn(root, s, el)) return s;
    }
  }
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.localName !== 'html') {
    if (node !== el && node.id && !/^\d|[0-9a-f]{8,}|:r[0-9a-z]+:/i.test(node.id)) {
      parts.unshift(`#${esc(node.id)}`);
      const s = parts.join(' > ');
      if (uniqueIn(root, s, el)) return s;
      parts.shift();
    }
    parts.unshift(segment(node));
    const s = parts.join(' > ');
    if (uniqueIn(root, s, el)) return s;
    node = node.parentElement;
  }
  return parts.join(' > ');
};

/** Selector across shadow roots: "host-selector >>> inner-selector" (Playwright's piercing syntax). */
export const uniqueSelector = (el: Element): string => {
  const chain: string[] = [selectorWithinRoot(el)];
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    chain.unshift(selectorWithinRoot(root.host));
    root = root.host.getRootNode();
  }
  return chain.join(' >>> ');
};

export const xpathFor = (el: Element): string => {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (node.id && node.ownerDocument.querySelectorAll(`#${esc(node.id)}`).length === 1 && !(node.getRootNode() instanceof ShadowRoot)) {
      parts.unshift(`//*[@id="${node.id}"]`);
      return parts.join('/');
    }
    const parentEl: Element | null = node.parentElement;
    const tag = node.localName;
    const siblings = parentEl ? [...parentEl.children].filter((c) => c.localName === tag) : [];
    parts.unshift(siblings.length > 1 ? `${tag}[${siblings.indexOf(node) + 1}]` : tag);
    node = parentEl;
  }
  return `/${parts.join('/')}`;
};

const visibleText = (el: Element): string | undefined => {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const t = raw.replace(/\s+/g, ' ').trim();
  return t ? truncate(t, 300) : undefined;
};

/** Opening tag with attributes, children elided; form values are never included. */
export const shallowHtml = (el: Element): string => {
  const clone = el.cloneNode(false) as Element;
  clone.removeAttribute('value');
  clone.removeAttribute('data-open-loop-probe');
  if (clone instanceof HTMLInputElement || clone instanceof HTMLTextAreaElement) clone.removeAttribute('value');
  const html = clone.outerHTML;
  const hasChildren = el.childNodes.length > 0;
  const close = `</${el.localName}>`;
  const open = html.endsWith(close) ? html.slice(0, -close.length) : html;
  return truncate(hasChildren ? `${open}…${close}` : html, 1500);
};

export const elementInfo = (el: Element): Omit<ElementInfo, 'components'> => {
  const attributes: Record<string, string> = {};
  let dataCount = 0;
  for (const a of [...el.attributes]) {
    if (a.name === 'value' || a.name === 'data-open-loop-probe' || a.name === 'style') continue;
    const keep = KEEP_ATTRS.has(a.name) || a.name.startsWith('aria-') || (a.name.startsWith('data-') && dataCount++ < 15);
    if (keep) attributes[a.name] = truncate(a.value, 300);
  }
  const cs = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) styles[p] = truncate(v, 200);
  }
  const testAttr = TEST_ID_ATTRS.find((a) => el.hasAttribute(a));
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const text = isField ? undefined : visibleText(el);
  return {
    selector: truncate(uniqueSelector(el), 2000),
    xpath: truncate(xpathFor(el), 2000),
    tagName: el.localName,
    ...(el.id ? { id: truncate(el.id, 300) } : {}),
    classes: [...el.classList].slice(0, 30).map((c) => truncate(c, 200)),
    ...(text ? { text } : {}),
    ...(el.getAttribute('role') ? { role: truncate(el.getAttribute('role')!, 100) } : {}),
    ...(el.getAttribute('aria-label') ? { ariaLabel: truncate(el.getAttribute('aria-label')!, 300) } : {}),
    ...(testAttr ? { testId: truncate(el.getAttribute(testAttr)!, 300) } : {}),
    attributes,
    html: shallowHtml(el),
    styles,
  };
};

/** "button#pay.btn" — what the hover label and the draft card show. */
export const shortLabel = (el: Element): string => {
  const id = el.id ? `#${el.id}` : '';
  const cls = [...el.classList].filter(isStableClass).slice(0, 2).map((c) => `.${c}`).join('');
  return truncate(`${el.localName}${id}${cls}`, 80);
};

/** Deepest element under a point, descending into open shadow roots, skipping our own overlay. */
export const elementAt = (x: number, y: number, skip: Element): Element | null => {
  let root: Document | ShadowRoot = document;
  let found: Element | null = null;
  for (let depth = 0; depth < 20; depth++) {
    const hit: Element | undefined = root.elementsFromPoint(x, y).find((e) => e !== skip && !skip.contains(e));
    if (!hit || hit === found) break;
    found = hit;
    if (hit.shadowRoot) root = hit.shadowRoot;
    else break;
  }
  return found;
};
