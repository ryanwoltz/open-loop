import type { AnnotationCategory } from '@open-loop/shared';
import type { Draft, PageSnapshot, QueuedReport, ReportMeta, ServerStatus, SubmitResult, TabState } from './types';

/** Requests handled by the background service worker. */
export type BackgroundRequest =
  | { type: 'hello' }
  | { type: 'getStatus' }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'getTabState'; tabId: number }
  | { type: 'startAnnotating'; tabId: number; tool: 'element' | 'region' }
  | { type: 'stopAnnotating'; tabId: number }
  | { type: 'updateDraft'; tabId: number; draftId: string; patch: { comment?: string; category?: AnnotationCategory } }
  | { type: 'removeDraft'; tabId: number; draftId: string }
  | { type: 'clearDrafts'; tabId: number }
  | { type: 'focusDraft'; tabId: number; draftId: string }
  | { type: 'submitReport'; tabId: number; meta: ReportMeta }
  | { type: 'retryQueue' }
  | { type: 'discardQueued'; clientKey: string }
  | { type: 'draftsChanged'; count: number }
  | { type: 'toolbarSubmit' };

export interface BackgroundResponses {
  hello: { tabId: number | null };
  getStatus: { enabled: boolean; server: ServerStatus; queue: QueuedReport[] };
  setEnabled: { enabled: boolean };
  getTabState: TabState;
  startAnnotating: TabState;
  stopAnnotating: TabState;
  updateDraft: TabState;
  removeDraft: TabState;
  clearDrafts: TabState;
  focusDraft: TabState;
  submitReport: SubmitResult;
  retryQueue: { sent: number; remaining: number };
  discardQueued: { remaining: number };
  draftsChanged: { ok: true };
  toolbarSubmit: SubmitResult;
}

/** Requests the background (or side panel) sends into a tab's content script. */
export type ContentRequest =
  | { type: 'ol:getState' }
  | { type: 'ol:start'; tool: 'element' | 'region' }
  | { type: 'ol:stop' }
  | { type: 'ol:updateDraft'; draftId: string; patch: { comment?: string; category?: AnnotationCategory } }
  | { type: 'ol:removeDraft'; draftId: string }
  | { type: 'ol:clearDrafts' }
  | { type: 'ol:focusDraft'; draftId: string }
  | { type: 'ol:snapshot'; include: ReportMeta['include'] }
  | { type: 'ol:restore'; submitted: boolean };

export interface ContentResponses {
  'ol:getState': Omit<TabState, 'tabId'>;
  'ol:start': Omit<TabState, 'tabId'>;
  'ol:stop': Omit<TabState, 'tabId'>;
  'ol:updateDraft': Omit<TabState, 'tabId'>;
  'ol:removeDraft': Omit<TabState, 'tabId'>;
  'ol:clearDrafts': Omit<TabState, 'tabId'>;
  'ol:focusDraft': Omit<TabState, 'tabId'>;
  'ol:snapshot': PageSnapshot;
  'ol:restore': { ok: true };
}

/** Broadcast to extension pages (the side panel) when something they show changed. */
export type Broadcast =
  | { type: 'tabChanged'; tabId: number }
  | { type: 'reportSaved'; tabId: number; result: SubmitResult }
  | { type: 'statusChanged' };

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export type { Draft };
