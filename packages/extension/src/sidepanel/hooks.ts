import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../lib/api';
import { errorMessage } from '../lib/logger';
import type { Broadcast } from '../lib/messages';
import { callBackground } from '../lib/rpc';
import { SETTINGS_KEY, getSettings } from '../lib/settings';
import type { QueuedReport, ServerStatus, Settings, TabState } from '../lib/types';

/** Subscribes to background broadcasts. */
export const useBroadcast = (fn: (msg: Broadcast) => void): void => {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const listener = (msg: unknown) => {
      if (msg && typeof msg === 'object' && 'type' in msg) ref.current(msg as Broadcast);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
};

export const useSettings = (): Settings | undefined => {
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => {
    void getSettings().then(setSettings);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SETTINGS_KEY]) void getSettings().then(setSettings);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return settings;
};

export const useApi = (): ApiClient | undefined => {
  const settings = useSettings();
  return useMemo(() => (settings ? new ApiClient(settings.serverUrl) : undefined), [settings]);
};

export interface AppStatus {
  enabled: boolean;
  server: ServerStatus;
  queue: QueuedReport[];
}

export const useStatus = (): { status?: AppStatus; refresh: () => void } => {
  const [status, setStatus] = useState<AppStatus>();
  const refresh = useCallback(() => {
    callBackground({ type: 'getStatus' })
      .then(setStatus)
      .catch(() => {
        /* service worker restarting; the next tick retries */
      });
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);
  useBroadcast((m) => {
    if (m.type === 'statusChanged' || m.type === 'reportSaved') refresh();
  });
  return { status, refresh };
};

/** The tab the side panel is looking at: the active tab of this window. */
export const useActiveTab = (): chrome.tabs.Tab | undefined => {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  useEffect(() => {
    let windowId: number | undefined;
    const load = () =>
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
        windowId = t?.windowId;
        setTab(t);
      });
    load();
    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (windowId === undefined || info.windowId === windowId) load();
    };
    const onUpdated = (_id: number, change: { url?: string; status?: string; title?: string }, t: chrome.tabs.Tab) => {
      if (t.active && (windowId === undefined || t.windowId === windowId) && (change.url || change.status || change.title)) setTab(t);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
};

export const useTabState = (
  tab: chrome.tabs.Tab | undefined,
  enabled: boolean,
): { state?: TabState; error?: string; refresh: () => void; setState: (s: TabState) => void } => {
  const [state, setState] = useState<TabState>();
  const [error, setError] = useState<string>();
  const tabId = tab?.id;
  const refresh = useCallback(() => {
    if (tabId === undefined || !enabled) return;
    callBackground({ type: 'getTabState', tabId })
      .then((s) => {
        setState(s);
        setError(undefined);
      })
      .catch((err) => {
        setState(undefined);
        setError(errorMessage(err));
      });
  }, [tabId, enabled]);
  useEffect(() => {
    setState(undefined);
    setError(undefined);
    refresh();
    // Log counters move while the page runs.
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [refresh, tab?.url, tab?.status]);
  useBroadcast((m) => {
    if ((m.type === 'tabChanged' || m.type === 'reportSaved') && m.tabId === tabId) refresh();
  });
  return { state, error, refresh, setState };
};

/** Object URL for a server-hosted image (images need the API header, so no plain <img src>). */
export const useBlobUrl = (api: ApiClient | undefined, id: string | undefined, name: string | undefined) => {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!api || !id || !name) return;
    let revoked = false;
    let current: string | undefined;
    setUrl(undefined);
    setError(undefined);
    api
      .fileBlob(id, name)
      .then((blob) => {
        if (revoked) return;
        current = URL.createObjectURL(blob);
        setUrl(current);
      })
      .catch((err) => !revoked && setError(errorMessage(err)));
    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [api, id, name]);
  return { url, error };
};
