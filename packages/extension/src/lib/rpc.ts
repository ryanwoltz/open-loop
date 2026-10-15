import type { BackgroundRequest, BackgroundResponses, Envelope } from './messages';

/** Typed request to the service worker; rejects with the worker's error message. */
export const callBackground = async <T extends BackgroundRequest>(
  req: T,
): Promise<BackgroundResponses[T['type']]> => {
  const res = (await chrome.runtime.sendMessage(req)) as Envelope<BackgroundResponses[T['type']]> | undefined;
  if (!res) throw new Error('No response from the Open Loop service worker');
  if (!res.ok) throw new Error(res.error);
  return res.data;
};
