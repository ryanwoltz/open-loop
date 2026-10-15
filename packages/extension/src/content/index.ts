import type { ActionEntry, AnnotationCategory, ComponentFrame, Rect } from '@open-loop/shared';
import { redactUrl, truncate } from '@open-loop/shared/core';
import { BRIDGE, type ContentToMain, type MainToContent, PROBE_ATTR, isBridgeMessage } from '../lib/bridge';
import { createLogger, errorMessage } from '../lib/logger';
import type { ContentRequest, ContentResponses, Envelope } from '../lib/messages';
import { callBackground } from '../lib/rpc';
import { ENABLED_KEY, SETTINGS_KEY, getSettings, isEnabled } from '../lib/settings';
import type { Draft, PageSnapshot, Settings, TabState } from '../lib/types';
import { CaptureBuffers } from './buffers';
import { deviceInfo, performanceInfo, viewportInfo } from './device';
import { elementInfo, shortLabel, uniqueSelector } from './dom';
import { Overlay, type PendingAnnotation, type Tool } from './overlay';

declare global {
  interface Window {
    __openLoopContent?: boolean;
  }
}

const log = createLogger('content');

/** True while chrome.runtime still belongs to a live extension (false after an update/reload). */
const alive = (): boolean => {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
};

if (!window.__openLoopContent && window.top === window) {
  window.__openLoopContent = true;
  main();
}

function main(): void {
  const buffers = new CaptureBuffers();
  let enabled = false;
  let settings: Settings | undefined;
  let tabId: number | null = null;
  let drafts: Draft[] = [];
  const elements = new Map<string, Element>();
  /** Last known page-coordinate rect, used if an element later leaves the DOM. */
  const lastPageRect = new Map<string, Rect>();
  const componentCache = new WeakMap<Element, Promise<ComponentFrame[]>>();
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;
  let lastUrl = location.href;

  // ---------- main-world bridge ----------

  const sendConfig = (): void => {
    const msg: ContentToMain = {
      bridge: BRIDGE,
      dir: 'down',
      kind: 'config',
      enabled,
      console: settings?.captureConsole ?? true,
      network: settings?.captureNetwork ?? true,
      failedBodies: settings?.captureFailedBodies ?? true,
    };
    window.postMessage(msg, '*');
  };

  const pendingProbes = new Map<string, (c: ComponentFrame[]) => void>();
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window || !isBridgeMessage(ev.data, 'up')) return;
    const msg = ev.data as MainToContent;
    try {
      switch (msg.kind) {
        case 'ready':
          if (settings) sendConfig();
          return;
        case 'components': {
          pendingProbes.get(msg.nonce)?.(Array.isArray(msg.components) ? msg.components.slice(0, 25) : []);
          pendingProbes.delete(msg.nonce);
          return;
        }
      }
      if (!enabled) return;
      if (msg.kind === 'console') buffers.addConsole(msg.entry);
      else if (msg.kind === 'network') buffers.addNetwork(msg.entry);
      else if (msg.kind === 'error') buffers.addError(msg.entry);
      else if (msg.kind === 'action' && settings?.captureActions !== false) buffers.addAction(msg.entry);
    } catch (err) {
      log.warn('dropped a malformed bridge message', err);
    }
  });

  /** Asks the main world which framework components own an element (≤ 600 ms). */
  const components = (el: Element): Promise<ComponentFrame[]> => {
    const cached = componentCache.get(el);
    if (cached) return cached;
    const p = new Promise<ComponentFrame[]>((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      el.setAttribute(PROBE_ATTR, nonce);
      const done = (c: ComponentFrame[]) => {
        el.removeAttribute(PROBE_ATTR);
        resolve(c);
      };
      pendingProbes.set(nonce, done);
      setTimeout(() => {
        if (pendingProbes.delete(nonce)) done([]);
      }, 600);
      window.postMessage({ bridge: BRIDGE, dir: 'down', kind: 'probe', nonce } satisfies ContentToMain, '*');
    });
    componentCache.set(el, p);
    return p;
  };

  // ---------- user actions ----------

  const fromOverlay = (ev: Event): boolean => ev.composedPath().includes(overlay.host);
  const describeTarget = (target: EventTarget | null): string | undefined => {
    if (!(target instanceof Element)) return undefined;
    try {
      return truncate(uniqueSelector(target), 2000);
    } catch {
      return target.localName;
    }
  };
  const record = (entry: ActionEntry): void => {
    if (enabled && settings?.captureActions !== false) buffers.addAction(entry);
  };

  window.addEventListener(
    'click',
    (ev) => {
      if (overlay.active || fromOverlay(ev)) return;
      const t = ev.target instanceof Element ? ev.target : null;
      const text = t ? ((t as HTMLElement).innerText ?? t.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
      record({ type: 'click', at: Date.now(), target: describeTarget(t), ...(text ? { detail: truncate(`"${text}"`, 120) } : {}) });
    },
    { capture: true, passive: true },
  );
  const inputTimers = new WeakMap<EventTarget, ReturnType<typeof setTimeout>>();
  window.addEventListener(
    'input',
    (ev) => {
      if (overlay.active || fromOverlay(ev) || !ev.target) return;
      const target = ev.target;
      clearTimeout(inputTimers.get(target));
      inputTimers.set(
        target,
        setTimeout(() => {
          const len = (target as HTMLInputElement).value?.length;
          const type = (target as HTMLInputElement).type;
          record({
            type: 'input',
            at: Date.now(),
            target: describeTarget(target),
            detail: type === 'password' ? 'typed a password' : len !== undefined ? `typed ${len} character${len === 1 ? '' : 's'}` : 'edited',
          });
        }, 700),
      );
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'submit',
    (ev) => record({ type: 'submit', at: Date.now(), target: describeTarget(ev.target) }),
    { capture: true, passive: true },
  );
  window.addEventListener(
    'keydown',
    (ev) => {
      if (overlay.active || fromOverlay(ev)) return;
      if (['Enter', 'Escape', 'Tab'].includes(ev.key)) {
        record({ type: 'keydown', at: Date.now(), target: describeTarget(ev.target), detail: ev.key });
      }
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'scroll',
    () => record({ type: 'scroll', at: Date.now(), detail: `scrollY ${Math.round(window.scrollY)}` }),
    { passive: true },
  );
  const onNav = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    record({ type: 'navigation', at: Date.now(), url: redactUrl(location.href) });
  };
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);

  // ---------- drafts ----------

  const draftKey = () => (tabId !== null ? `ol:drafts:${tabId}` : null);

  const persistDrafts = async (): Promise<void> => {
    const key = draftKey();
    if (!key || !alive()) return;
    try {
      if (drafts.length === 0) await chrome.storage.session.remove(key);
      else await chrome.storage.session.set({ [key]: { url: location.href, drafts, rects: Object.fromEntries(lastPageRect) } });
    } catch (err) {
      log.warn('could not persist drafts', err);
    }
  };

  const changed = (): void => {
    overlay.setDrafts(drafts);
    void persistDrafts();
    if (alive()) callBackground({ type: 'draftsChanged', count: drafts.length }).catch(() => {});
  };

  const renumber = () => drafts.forEach((d, i) => (d.index = i + 1));

  const resolveSelector = (selector: string): Element | null => {
    try {
      const parts = selector.split(' >>> ');
      let root: Document | ShadowRoot = document;
      let found: Element | null = null;
      for (const part of parts) {
        found = root.querySelector(part);
        if (!found) return null;
        if (found.shadowRoot) root = found.shadowRoot;
      }
      return found;
    } catch {
      return null;
    }
  };

  const rectOf = (d: Draft): Rect | null => {
    if (d.kind === 'region' && d.pageRect) {
      return { x: d.pageRect.x - window.scrollX, y: d.pageRect.y - window.scrollY, width: d.pageRect.width, height: d.pageRect.height };
    }
    let node = elements.get(d.id);
    if ((!node || !node.isConnected) && d.element) {
      node = resolveSelector(d.element.selector) ?? undefined;
      if (node) elements.set(d.id, node);
    }
    if (node?.isConnected) {
      const r = node.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        lastPageRect.set(d.id, { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height });
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    const last = lastPageRect.get(d.id);
    return last ? { x: last.x - window.scrollX, y: last.y - window.scrollY, width: last.width, height: last.height } : null;
  };

  const createDraft = async (pending: PendingAnnotation, comment: string, category: AnnotationCategory): Promise<void> => {
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const base: Draft = { id, index: drafts.length + 1, kind: pending.kind, category, comment, label: 'Region', createdAt: Date.now() };
    if (pending.kind === 'element' && pending.element) {
      const el = pending.element;
      const info = elementInfo(el);
      const comps = await components(el);
      base.element = { ...info, components: comps };
      base.label = comps[0] ? `${shortLabel(el)} · ${comps[0].name}` : shortLabel(el);
      elements.set(id, el);
      const r = el.getBoundingClientRect();
      lastPageRect.set(id, { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height });
    } else if (pending.rect) {
      base.pageRect = { x: pending.rect.x + window.scrollX, y: pending.rect.y + window.scrollY, width: pending.rect.width, height: pending.rect.height };
      base.label = `Region ${Math.round(pending.rect.width)}×${Math.round(pending.rect.height)}`;
    }
    drafts.push(base);
    renumber();
    changed();
  };

  const updateDraft = (id: string, patch: { comment?: string; category?: AnnotationCategory }): void => {
    const d = drafts.find((x) => x.id === id);
    if (!d) return;
    if (patch.comment !== undefined) d.comment = patch.comment.slice(0, 5000);
    if (patch.category !== undefined) d.category = patch.category;
    changed();
  };

  const removeDraft = (id: string): void => {
    drafts = drafts.filter((d) => d.id !== id);
    elements.delete(id);
    lastPageRect.delete(id);
    renumber();
    changed();
  };

  const clearDrafts = (): void => {
    drafts = [];
    elements.clear();
    lastPageRect.clear();
    changed();
  };

  const overlay = new Overlay({
    rectOf,
    componentName: async (el) => (await components(el))[0]?.name,
    create: (pending, comment, category) => {
      createDraft(pending, comment, category).catch((err) => {
        log.error('could not create annotation', err);
        overlay.toast(`Couldn't add that note: ${errorMessage(err)}`, 'error');
      });
    },
    update: updateDraft,
    remove: removeDraft,
    modeChanged: () => {
      if (alive()) callBackground({ type: 'draftsChanged', count: drafts.length }).catch(() => {});
    },
    submit: () => {
      if (!alive()) return;
      callBackground({ type: 'toolbarSubmit' })
        .then((r) => overlay.toast(r.queued ? `Saved offline — will upload when the Open Loop server is back` : `Report ${r.reportId} saved`, r.queued ? 'warn' : 'ok'))
        .catch((err) => overlay.toast(`Couldn't save: ${errorMessage(err)}`, 'error'));
    },
  });

  // ---------- state & snapshot ----------

  const state = (): Omit<TabState, 'tabId'> => ({
    url: location.href,
    title: document.title,
    annotating: overlay.active,
    drafts,
    counts: buffers.counts(),
  });

  const intersects = (r: Rect): boolean =>
    r.x < window.innerWidth && r.y < window.innerHeight && r.x + r.width > 0 && r.y + r.height > 0;

  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

  const snapshot = async (include: { console: boolean; network: boolean; actions: boolean }): Promise<PageSnapshot> => {
    overlay.hide();
    clearTimeout(restoreTimer);
    // If the background never answers (crash, closed panel), don't leave the overlay hidden.
    restoreTimer = setTimeout(() => overlay.show(), 8000);
    await nextFrame();
    const annotations = drafts.map((d) => {
      const rect = rectOf(d) ?? { x: 0, y: 0, width: 0, height: 0 };
      const connected = d.kind === 'region' || !!elements.get(d.id)?.isConnected;
      return { ...d, rect, inViewport: connected && rect.width > 0 && intersects(rect) };
    });
    return {
      page: { url: redactUrl(location.href), title: document.title.slice(0, 1000), ...(document.referrer ? { referrer: redactUrl(document.referrer) } : {}) },
      viewport: viewportInfo(),
      device: deviceInfo(),
      performance: performanceInfo(),
      annotations,
      console: include.console ? buffers.console.toArray() : [],
      network: include.network ? buffers.network.toArray() : [],
      errors: buffers.errors.toArray(),
      actions: include.actions ? buffers.actions.toArray() : [],
    };
  };

  // ---------- messages from the extension ----------

  const handle = async (req: ContentRequest): Promise<ContentResponses[ContentRequest['type']]> => {
    switch (req.type) {
      case 'ol:getState':
        return state();
      case 'ol:start':
        if (!enabled) throw new Error('Open Loop is turned off');
        overlay.start(req.tool as Tool);
        return state();
      case 'ol:stop':
        overlay.stop();
        return state();
      case 'ol:updateDraft':
        updateDraft(req.draftId, req.patch);
        return state();
      case 'ol:removeDraft':
        removeDraft(req.draftId);
        return state();
      case 'ol:clearDrafts':
        clearDrafts();
        return state();
      case 'ol:focusDraft':
        overlay.focusDraft(req.draftId);
        return state();
      case 'ol:snapshot':
        return snapshot(req.include);
      case 'ol:restore':
        clearTimeout(restoreTimer);
        overlay.show();
        if (req.submitted) {
          clearDrafts();
          overlay.stop();
        }
        return { ok: true };
    }
  };

  chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
    if (typeof req?.type !== 'string' || !req.type.startsWith('ol:')) return false;
    handle(req)
      .then((data) => sendResponse({ ok: true, data } satisfies Envelope<unknown>))
      .catch((err: unknown) => {
        log.warn(`request ${req.type} failed`, err);
        sendResponse({ ok: false, error: errorMessage(err) } satisfies Envelope<unknown>);
      });
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[ENABLED_KEY]) {
      enabled = changes[ENABLED_KEY].newValue !== false;
      sendConfig();
      if (!enabled) {
        overlay.stop();
        overlay.setDrafts([]);
      } else {
        overlay.setDrafts(drafts);
      }
    }
    if (changes[SETTINGS_KEY]) {
      void getSettings().then((s) => {
        settings = s;
        sendConfig();
      });
    }
  });

  // An extension update orphans this script: tear the overlay down instead of throwing.
  const watchdog = setInterval(() => {
    if (!alive()) {
      clearInterval(watchdog);
      overlay.destroy();
      window.__openLoopContent = false;
    }
  }, 5000);

  // ---------- boot ----------

  void (async () => {
    try {
      [enabled, settings] = await Promise.all([isEnabled(), getSettings()]);
      sendConfig();
      const hello = await callBackground({ type: 'hello' });
      tabId = hello.tabId;
      const key = draftKey();
      if (key && enabled) {
        const saved = (await chrome.storage.session.get(key))[key] as
          | { url: string; drafts: Draft[]; rects?: Record<string, Rect> }
          | undefined;
        if (saved && saved.url === location.href && Array.isArray(saved.drafts)) {
          drafts = saved.drafts;
          for (const [id, r] of Object.entries(saved.rects ?? {})) lastPageRect.set(id, r);
          overlay.setDrafts(drafts);
          log.info(`restored ${drafts.length} draft annotation(s) after reload`);
        } else if (saved) {
          await chrome.storage.session.remove(key);
        }
      }
    } catch (err) {
      log.error('content script failed to start', err);
    }
  })();
}
