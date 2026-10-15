import type {
  ActionEntry,
  AnnotationCategory,
  ConsoleEntry,
  DeviceInfo,
  ElementInfo,
  ErrorEntry,
  NetworkEntry,
  PagePerformance,
  Priority,
  Rect,
  Viewport,
} from '@open-loop/shared';

/** An annotation being drafted in a tab, before the report is saved. */
export interface Draft {
  id: string;
  index: number;
  kind: 'element' | 'region';
  category: AnnotationCategory;
  comment: string;
  /** Short human label, e.g. "button#pay · PayButton". */
  label: string;
  element?: ElementInfo;
  /** Region drafts: document coordinates, so they survive scrolling. */
  pageRect?: Rect;
  createdAt: number;
}

export interface LogCounts {
  console: number;
  consoleErrors: number;
  network: number;
  failedRequests: number;
  errors: number;
  actions: number;
}

export interface TabState {
  tabId: number;
  url: string;
  title: string;
  annotating: false | 'element' | 'region';
  drafts: Draft[];
  counts: LogCounts;
}

/** Everything the content script hands over at capture time. */
export interface PageSnapshot {
  page: { url: string; title: string; referrer?: string };
  viewport: Viewport;
  device: DeviceInfo;
  performance?: PagePerformance;
  annotations: Array<Draft & { rect: Rect; inViewport: boolean }>;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  errors: ErrorEntry[];
  actions: ActionEntry[];
}

export interface ReportMeta {
  title?: string;
  description?: string;
  priority: Priority;
  include: { console: boolean; network: boolean; actions: boolean };
}

export interface Settings {
  serverUrl: string;
  captureConsole: boolean;
  captureNetwork: boolean;
  captureActions: boolean;
  /** Keep (redacted) bodies of failed requests. */
  captureFailedBodies: boolean;
}

export interface QueuedReport {
  clientKey: string;
  title: string;
  url: string;
  queuedAt: number;
  attempts: number;
  lastError?: string;
  /** Permanently rejected by the server (4xx): retrying won't help. */
  failed?: boolean;
}

export interface ServerStatus {
  connected: boolean;
  version?: string;
  store?: string;
  error?: string;
  checkedAt: number;
}

export interface SubmitResult {
  reportId?: string;
  queued: boolean;
  title: string;
}
