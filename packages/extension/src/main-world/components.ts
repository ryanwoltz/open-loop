import type { ComponentFrame } from '@open-loop/shared';
import { dropMinified } from '@open-loop/shared/core';

/**
 * Finds the framework component chain that owns a DOM element, nearest first.
 * Reads the private fields each framework's dev and prod builds attach to DOM
 * nodes; every probe is defensive because those fields are not public API.
 */
const MAX_FRAMES = 25;

type Fiber = {
  type?: unknown;
  elementType?: unknown;
  return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  _debugOwner?: Fiber | null;
};

const nameOfType = (type: unknown): string | undefined => {
  if (!type) return undefined;
  if (typeof type === 'function') {
    const f = type as { displayName?: string; name?: string };
    return f.displayName || f.name || undefined;
  }
  if (typeof type === 'object') {
    const t = type as { displayName?: string; render?: unknown; type?: unknown; _context?: unknown };
    if (t.displayName) return t.displayName;
    if (t.render) return nameOfType(t.render); // forwardRef
    if (t.type) return nameOfType(t.type); // memo
  }
  return undefined;
};

/** Skip framework plumbing that tells an agent nothing about the app. */
const NOISE = /^(Anonymous|Fragment|Suspense|StrictMode|Profiler|Provider|Consumer|Context|Router|Routes|Route|RenderedRoute|ErrorBoundary|InnerLayoutRouter|OuterLayoutRouter|RedirectBoundary|NotFoundBoundary|LoadingBoundary|ScrollAndFocusHandler|HotReload|AppRouter|ServerRoot|Root|Location|Navigation|DataRoutes|RouterProvider|BrowserRouter|Outlet|Await|QueryClientProvider|ThemeProvider)$/;

const react = (el: Element): ComponentFrame[] => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!key) return [];
  const frames: ComponentFrame[] = [];
  let fiber = (el as unknown as Record<string, Fiber | undefined>)[key];
  let guard = 0;
  while (fiber && frames.length < MAX_FRAMES && guard++ < 500) {
    const t = fiber.type;
    if (typeof t === 'function' || (t && typeof t === 'object')) {
      const name = nameOfType(t);
      if (name && !NOISE.test(name) && !name.startsWith('_')) {
        const src = fiber._debugSource;
        frames.push({
          name,
          framework: 'react',
          ...(src?.fileName ? { source: { file: src.fileName, line: src.lineNumber, column: src.columnNumber } } : {}),
        });
      }
    }
    fiber = fiber.return ?? undefined;
  }
  return frames;
};

type VueInstance = {
  type?: { name?: string; __name?: string; __file?: string };
  parent?: VueInstance | null;
};
type Vue2Instance = { $options?: { name?: string; _componentTag?: string; __file?: string }; $parent?: Vue2Instance };

const fileBase = (file?: string): string | undefined => file?.split('/').pop()?.replace(/\.\w+$/, '');

const vue = (el: Element): ComponentFrame[] => {
  const frames: ComponentFrame[] = [];
  let node: Element | null = el;
  while (node && !(node as unknown as { __vueParentComponent?: unknown }).__vueParentComponent && !(node as unknown as { __vue__?: unknown }).__vue__) {
    node = node.parentElement;
  }
  if (!node) return frames;
  let v3 = (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
  while (v3 && frames.length < MAX_FRAMES) {
    const name = v3.type?.name || v3.type?.__name || fileBase(v3.type?.__file);
    if (name) frames.push({ name, framework: 'vue', ...(v3.type?.__file ? { source: { file: v3.type.__file } } : {}) });
    v3 = v3.parent ?? undefined;
  }
  let v2 = (node as unknown as { __vue__?: Vue2Instance }).__vue__;
  while (v2 && frames.length < MAX_FRAMES) {
    const o = v2.$options;
    const name = o?.name || o?._componentTag || fileBase(o?.__file);
    if (name) frames.push({ name, framework: 'vue', ...(o?.__file ? { source: { file: o.__file } } : {}) });
    v2 = v2.$parent;
  }
  return frames;
};

const svelte = (el: Element): ComponentFrame[] => {
  const frames: ComponentFrame[] = [];
  const seen = new Set<string>();
  let node: Element | null = el;
  while (node && frames.length < MAX_FRAMES) {
    const meta = (node as unknown as { __svelte_meta?: { loc?: { file?: string; line?: number; column?: number } } }).__svelte_meta;
    const file = meta?.loc?.file;
    if (file && !seen.has(file)) {
      seen.add(file);
      frames.push({ name: fileBase(file) ?? file, framework: 'svelte', source: { file, line: meta?.loc?.line, column: meta?.loc?.column } });
    }
    node = node.parentElement;
  }
  return frames;
};

const angular = (el: Element): ComponentFrame[] => {
  const ng = (window as unknown as { ng?: { getOwningComponent?: (e: Element) => unknown; getComponent?: (e: Element) => unknown } }).ng;
  if (!ng?.getOwningComponent) return [];
  const frames: ComponentFrame[] = [];
  const seen = new Set<unknown>();
  let node: Element | null = el;
  while (node && frames.length < MAX_FRAMES) {
    let comp: unknown;
    try {
      comp = ng.getComponent?.(node) ?? ng.getOwningComponent(node);
    } catch {
      comp = undefined;
    }
    if (comp && !seen.has(comp)) {
      seen.add(comp);
      const name = (comp as { constructor?: { name?: string } }).constructor?.name;
      if (name && name !== 'Object') frames.push({ name: name.replace(/^_/, ''), framework: 'angular' });
    }
    node = node.parentElement;
  }
  return frames;
};

const webComponents = (el: Element): ComponentFrame[] => {
  const frames: ComponentFrame[] = [];
  let node: Node | null = el;
  while (node && frames.length < MAX_FRAMES) {
    if (node instanceof Element && node.localName.includes('-') && customElements.get(node.localName)) {
      frames.push({ name: node.localName, framework: 'web-component' });
    }
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
    if (node instanceof ShadowRoot) node = node.host;
  }
  return frames;
};

export interface ComponentResult {
  frames: ComponentFrame[];
  minified: boolean;
}

export const componentsFor = (el: Element): ComponentResult => {
  for (const probe of [react, vue, svelte, angular]) {
    try {
      const raw = probe(el);
      if (raw.length > 0) return dropMinified(raw);
    } catch {
      /* a framework's internals changed shape: try the next probe */
    }
  }
  try {
    return { frames: webComponents(el), minified: false };
  } catch {
    return { frames: [], minified: false };
  }
};
