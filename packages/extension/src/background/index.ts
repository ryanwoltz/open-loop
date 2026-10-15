import type { NewReportPayload } from '@open-loop/shared';
import { deriveTitle } from '@open-loop/shared/core';
import { ApiClient, ApiError } from '../lib/api';
import { createLogger, errorMessage } from '../lib/logger';
import type { BackgroundRequest, BackgroundResponses, Broadcast, ContentRequest, ContentResponses, Envelope } from '../lib/messages';
import { getSettings, isEnabled, setEnabled, ENABLED_KEY, SETTINGS_KEY } from '../lib/settings';
import type { PageSnapshot, ReportMeta, ServerStatus, SubmitResult, TabState } from '../lib/types';
import { compose } from './compose';
import { dequeue, enqueue, loadPayload, markAttempt, readQueue } from './queue';

const log = createLogger('background');
const VERSION = chrome.runtime.getManifest().version;
const FLUSH_ALARM = 'ol:flush';

self.addEventListener('error', (ev) => log.error('uncaught error in service worker', (ev as ErrorEvent).error ?? (ev as ErrorEvent).message));
self.addEventListener('unhandledrejection', (ev) => log.error('unhandled rejection in service worker', (ev as PromiseRejectionEvent).reason));

// Content scripts read their tab's drafts from session storage.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

// ---------- server status ----------

let lastStatus: ServerStatus = { connected: false, checkedAt: 0 };

const client = async () => new ApiClient((await getSettings()).serverUrl);

const checkServer = async (force = false): Promise<ServerStatus> => {
  if (!force && Date.now() - lastStatus.checkedAt < 3000) return lastStatus;
  const before = lastStatus.connected;
  try {
    const h = await (await client()).health();
    lastStatus = { connected: true, version: h.version, store: h.store, checkedAt: Date.now() };
  } catch (err) {
    lastStatus = { connected: false, error: errorMessage(err), checkedAt: Date.now() };
  }
  if (before !== lastStatus.connected) {
    log.info(lastStatus.connected ? 'server connected' : 'server unreachable', lastStatus.error);
    broadcast({ type: 'statusChanged' });
    if (lastStatus.connected) void flushQueue();
  }
  return lastStatus;
};

const broadcast = (msg: Broadcast): void => {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* no extension page is listening */
  });
};

// ---------- badge ----------

const refreshGlobalBadge = async (): Promise<void> => {
  const enabled = await isEnabled();
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#5B5BD6' : '#71717A' });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  await chrome.action.setTitle({ title: enabled ? 'Open Loop' : 'Open Loop (off)' });
};

const setTabBadge = async (tabId: number, count: number): Promise<void> => {
  try {
    if (!(await isEnabled())) return;
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
  } catch {
    /* tab closed */
  }
};

// ---------- talking to tabs ----------

const SUPPORTED = /^(https?|file):/;

const sendToTab = async <T extends ContentRequest>(tabId: number, req: T): Promise<ContentResponses[T['type']]> => {
  const res = (await chrome.tabs.sendMessage(tabId, req)) as Envelope<ContentResponses[T['type']]> | undefined;
  if (!res) throw new Error('The page did not answer');
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

/** Injects the content scripts into a tab that was open before the extension loaded. */
const inject = async (tabId: number): Promise<void> => {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['main-world.js'], world: 'MAIN', injectImmediately: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'], injectImmediately: true });
};

const toTab = async <T extends ContentRequest>(tabId: number, req: T): Promise<ContentResponses[T['type']]> => {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !SUPPORTED.test(tab.url) || /^https:\/\/chromewebstore\.google\.com/.test(tab.url)) {
    throw new Error("Open Loop can't run on this page. Browser pages (chrome://), the Web Store and the new-tab page are off-limits to extensions.");
  }
  try {
    return await sendToTab(tabId, req);
  } catch (err) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(errorMessage(err))) throw err;
    log.info('content script missing; injecting', { tabId });
    try {
      await inject(tabId);
    } catch (injectErr) {
      throw new Error(`Couldn't attach to this page: ${errorMessage(injectErr)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
    return sendToTab(tabId, req);
  }
};

const tabState = async (tabId: number, req: ContentRequest = { type: 'ol:getState' }): Promise<TabState> => {
  const state = (await toTab(tabId, req)) as Omit<TabState, 'tabId'>;
  return { tabId, ...state };
};

// ---------- capture & submit ----------

const inFlight = new Set<number>();

const buildPayload = (snap: PageSnapshot, images: Awaited<ReturnType<typeof compose>>, meta: ReportMeta): NewReportPayload => ({
  ...(meta.title?.trim() ? { title: meta.title.trim().slice(0, 300) } : {}),
  ...(meta.description?.trim() ? { description: meta.description.trim().slice(0, 10_000) } : {}),
  priority: meta.priority,
  tags: [],
  page: snap.page,
  viewport: snap.viewport,
  device: snap.device,
  ...(snap.performance ? { performance: snap.performance } : {}),
  annotations: snap.annotations.map((a) => ({
    id: a.id,
    index: a.index,
    kind: a.kind,
    category: a.category,
    comment: a.comment,
    rect: {
      x: Math.round(a.rect.x),
      y: Math.round(a.rect.y),
      width: Math.max(0, Math.round(a.rect.width)),
      height: Math.max(0, Math.round(a.rect.height)),
    },
    inViewport: a.inViewport,
    ...(a.element ? { element: a.element } : {}),
    ...(images.crops.get(a.id) ? { cropDataUrl: images.crops.get(a.id) } : {}),
  })),
  console: snap.console.slice(-2000),
  network: snap.network.slice(-2000),
  errors: snap.errors.slice(-1000),
  actions: snap.actions.slice(-2000),
  images: {
    original: images.original,
    annotated: images.annotated,
    originalPreview: images.originalPreview,
    annotatedPreview: images.annotatedPreview,
    width: images.width,
    height: images.height,
  },
  extensionVersion: VERSION,
  capturedAt: new Date().toISOString(),
  clientKey: crypto.randomUUID(),
});

const submit = async (tabId: number, meta: ReportMeta): Promise<SubmitResult> => {
  if (!(await isEnabled())) throw new Error('Open Loop is turned off');
  if (inFlight.has(tabId)) throw new Error('A capture is already in progress for this tab');
  inFlight.add(tabId);
  let submitted = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) throw new Error('Switch to that tab first: only the visible tab can be captured');
    const snap = await toTab(tabId, { type: 'ol:snapshot', include: meta.include });

    let shot: string;
    try {
      shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      throw new Error(`Screenshot failed: ${errorMessage(err)}`);
    }
    const images = await compose(shot, snap);
    const payload = buildPayload(snap, images, meta);
    const title = payload.title ?? deriveTitle(snap.annotations.map((a) => a.comment), snap.page.title);

    let result: SubmitResult;
    try {
      const { report } = await (await client()).create(payload);
      log.info('report saved', { id: report.id, annotations: report.annotations.length });
      result = { reportId: report.id, queued: false, title: report.title };
    } catch (err) {
      if (err instanceof ApiError && err.transient) {
        await enqueue(payload, title, err.message);
        log.warn('server unavailable; report queued', { title, error: err.message });
        result = { queued: true, title };
        void checkServer(true);
      } else {
        throw err;
      }
    }
    submitted = true;
    broadcast({ type: 'reportSaved', tabId, result });
    return result;
  } finally {
    inFlight.delete(tabId);
    await toTab(tabId, { type: 'ol:restore', submitted }).catch((err) => log.warn('could not restore overlay', err));
    if (submitted) void setTabBadge(tabId, 0);
  }
};

// ---------- offline queue ----------

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

/** One flush at a time; a caller arriving mid-flush waits for that flush's result. */
const flushQueue = (): Promise<{ sent: number; remaining: number }> => {
  flushing ??= runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
};

const runFlush = async (): Promise<{ sent: number; remaining: number }> => {
  let sent = 0;
  const api = await client();
  for (const item of await readQueue()) {
    if (item.failed) continue;
    const payload = await loadPayload(item.clientKey);
    if (!payload) {
      await dequeue(item.clientKey);
      continue;
    }
    try {
      const { report } = await api.create(payload);
      await dequeue(item.clientKey);
      sent++;
      log.info('queued report uploaded', { id: report.id });
    } catch (err) {
      const transient = err instanceof ApiError && err.transient;
      await markAttempt(item.clientKey, errorMessage(err), !transient);
      if (transient) break; // server still down: try again on the next alarm
      log.error('queued report rejected by server', { title: item.title, error: errorMessage(err) });
    }
  }
  const remaining = (await readQueue()).length;
  if (sent > 0) broadcast({ type: 'statusChanged' });
  return { sent, remaining };
};

// ---------- message router ----------

type Handler<K extends BackgroundRequest['type']> = (
  req: Extract<BackgroundRequest, { type: K }>,
  sender: chrome.runtime.MessageSender,
) => Promise<BackgroundResponses[K]>;

const handlers: { [K in BackgroundRequest['type']]: Handler<K> } = {
  hello: async (_req, sender) => ({ tabId: sender.tab?.id ?? null }),
  getStatus: async () => ({ enabled: await isEnabled(), server: await checkServer(), queue: await readQueue() }),
  setEnabled: async (req) => {
    await setEnabled(req.enabled);
    log.info(req.enabled ? 'turned on' : 'turned off');
    return { enabled: req.enabled };
  },
  getTabState: async (req) => tabState(req.tabId),
  startAnnotating: async (req) => {
    if (!(await isEnabled())) throw new Error('Turn Open Loop on first');
    return tabState(req.tabId, { type: 'ol:start', tool: req.tool });
  },
  stopAnnotating: async (req) => tabState(req.tabId, { type: 'ol:stop' }),
  updateDraft: async (req) => tabState(req.tabId, { type: 'ol:updateDraft', draftId: req.draftId, patch: req.patch }),
  removeDraft: async (req) => tabState(req.tabId, { type: 'ol:removeDraft', draftId: req.draftId }),
  clearDrafts: async (req) => tabState(req.tabId, { type: 'ol:clearDrafts' }),
  focusDraft: async (req) => tabState(req.tabId, { type: 'ol:focusDraft', draftId: req.draftId }),
  submitReport: async (req) => submit(req.tabId, req.meta),
  toolbarSubmit: async (_req, sender) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) throw new Error('toolbarSubmit must come from a tab');
    return submit(tabId, { priority: 'medium', include: { console: true, network: true, actions: true } });
  },
  retryQueue: async () => {
    // A manual retry also re-tries reports the server rejected before.
    const items = await readQueue();
    await chrome.storage.local.set({ 'ol:queue': items.map((q) => ({ ...q, failed: false })) });
    await checkServer(true);
    return flushQueue();
  },
  discardQueued: async (req) => {
    await dequeue(req.clientKey);
    return { remaining: (await readQueue()).length };
  },
  draftsChanged: async (req, sender) => {
    if (sender.tab?.id !== undefined) {
      void setTabBadge(sender.tab.id, req.count);
      broadcast({ type: 'tabChanged', tabId: sender.tab.id });
    }
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((req: BackgroundRequest, sender, sendResponse) => {
  // Broadcasts (tabChanged, …) and content-bound requests are not for us.
  if (typeof req?.type !== 'string' || !(req.type in handlers)) return false;
  const handler = handlers[req.type] as Handler<typeof req.type>;
  handler(req as never, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies Envelope<unknown>))
    .catch((err: unknown) => {
      log.warn(`${req.type} failed`, errorMessage(err));
      sendResponse({ ok: false, error: errorMessage(err) } satisfies Envelope<unknown>);
    });
  return true;
});

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(async (details) => {
  log.info(`installed (${details.reason}) v${VERSION}`);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => log.warn('setPanelBehavior failed', err));
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ol-annotate', title: 'Annotate with Open Loop', contexts: ['page', 'selection', 'image', 'link'] });
  });
  await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
  await refreshGlobalBadge();
  // Attach to tabs that were already open so their logs start now.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map((t) => (t.id !== undefined ? inject(t.id).catch(() => {}) : undefined)));
});

chrome.runtime.onStartup.addListener(() => {
  void refreshGlobalBadge();
  void chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
  void flushQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== FLUSH_ALARM) return;
  void readQueue().then((q) => {
    if (q.some((i) => !i.failed)) void checkServer(true).then((s) => {
      if (s.connected) void flushQueue();
    });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[ENABLED_KEY]) {
    void refreshGlobalBadge();
    broadcast({ type: 'statusChanged' });
  }
  if (changes[SETTINGS_KEY]) void checkServer(true);
});

const startOnActiveTab = async (tool: 'element' | 'region' = 'element'): Promise<void> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  try {
    if (!(await isEnabled())) {
      await setEnabled(true);
    }
    const state = await tabState(tab.id);
    await tabState(tab.id, state.annotating ? { type: 'ol:stop' } : { type: 'ol:start', tool });
  } catch (err) {
    log.warn('could not start annotating', errorMessage(err));
  }
};

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-annotate') void startOnActiveTab('element');
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ol-annotate' || tab?.id === undefined) return;
  void (async () => {
    try {
      if (!(await isEnabled())) await setEnabled(true);
      await tabState(tab.id!, { type: 'ol:start', tool: 'element' });
    } catch (err) {
      log.warn('context menu annotate failed', errorMessage(err));
    }
  })();
});

void refreshGlobalBadge();
