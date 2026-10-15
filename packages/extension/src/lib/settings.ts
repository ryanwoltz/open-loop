import { DEFAULT_SERVER_URL } from '@open-loop/shared/core';
import type { Settings } from './types';

export const SETTINGS_KEY = 'ol:settings';
export const ENABLED_KEY = 'ol:enabled';

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: DEFAULT_SERVER_URL,
  captureConsole: true,
  captureNetwork: true,
  captureActions: true,
  captureFailedBodies: true,
};

export const getSettings = async (): Promise<Settings> => {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...((got[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}) };
};

export const saveSettings = async (patch: Partial<Settings>): Promise<Settings> => {
  const next = { ...(await getSettings()), ...patch };
  if (patch.serverUrl !== undefined) next.serverUrl = normalizeServerUrl(patch.serverUrl);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
};

/** On by default: capture only stays in the tab's memory until you save a report. */
export const isEnabled = async (): Promise<boolean> => {
  const got = await chrome.storage.local.get(ENABLED_KEY);
  return got[ENABLED_KEY] !== false;
};

export const setEnabled = async (enabled: boolean): Promise<void> => {
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
};

export const normalizeServerUrl = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Server URL must be http(s)');
  return url.origin;
};
