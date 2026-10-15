import type { NewReportPayload } from '@open-loop/shared';
import type { QueuedReport } from '../lib/types';

/**
 * Reports that could not reach the server wait here (chrome.storage.local with
 * unlimitedStorage) and upload on the next flush. The index and each payload
 * are separate keys so a flush never rewrites megabytes of screenshots.
 */
const INDEX_KEY = 'ol:queue';
const payloadKey = (clientKey: string) => `ol:queue:${clientKey}`;

export const readQueue = async (): Promise<QueuedReport[]> =>
  ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] as QueuedReport[] | undefined) ?? [];

const writeQueue = (items: QueuedReport[]) => chrome.storage.local.set({ [INDEX_KEY]: items });

export const enqueue = async (payload: NewReportPayload, title: string, lastError: string): Promise<void> => {
  await chrome.storage.local.set({ [payloadKey(payload.clientKey)]: payload });
  const items = (await readQueue()).filter((q) => q.clientKey !== payload.clientKey);
  items.push({ clientKey: payload.clientKey, title, url: payload.page.url, queuedAt: Date.now(), attempts: 1, lastError });
  await writeQueue(items);
};

export const loadPayload = async (clientKey: string): Promise<NewReportPayload | undefined> =>
  (await chrome.storage.local.get(payloadKey(clientKey)))[payloadKey(clientKey)] as NewReportPayload | undefined;

export const dequeue = async (clientKey: string): Promise<void> => {
  await chrome.storage.local.remove(payloadKey(clientKey));
  await writeQueue((await readQueue()).filter((q) => q.clientKey !== clientKey));
};

export const markAttempt = async (clientKey: string, lastError: string, failed: boolean): Promise<void> => {
  await writeQueue(
    (await readQueue()).map((q) =>
      q.clientKey === clientKey ? { ...q, attempts: q.attempts + 1, lastError, ...(failed ? { failed: true } : {}) } : q,
    ),
  );
};
