import { z } from 'zod';

/** Bumped whenever a stored report.json changes shape incompatibly. */
export const SCHEMA_VERSION = 1;

export const REPORT_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'] as const;
export const ANNOTATION_STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const ANNOTATION_CATEGORIES = ['bug', 'ui', 'copy', 'idea', 'question'] as const;

export const ReportStatus = z.enum(REPORT_STATUSES);
export const AnnotationStatus = z.enum(ANNOTATION_STATUSES);
export const Priority = z.enum(PRIORITIES);
export const AnnotationCategory = z.enum(ANNOTATION_CATEGORIES);

export type ReportStatus = z.infer<typeof ReportStatus>;
export type AnnotationStatus = z.infer<typeof AnnotationStatus>;
export type Priority = z.infer<typeof Priority>;
export type AnnotationCategory = z.infer<typeof AnnotationCategory>;

/** Closed states: nothing left for an agent to do. */
export const isClosedStatus = (s: ReportStatus | AnnotationStatus): boolean =>
  s === 'resolved' || s === 'wont_fix';

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type Rect = z.infer<typeof Rect>;

/** One framework component in the chain from the clicked element up to the root. */
export const ComponentFrame = z.object({
  name: z.string().max(200),
  framework: z.enum(['react', 'vue', 'svelte', 'angular', 'web-component']),
  /** Source location when the framework exposes one (React dev builds, Svelte dev meta). */
  source: z
    .object({
      file: z.string().max(1000),
      line: z.number().int().optional(),
      column: z.number().int().optional(),
    })
    .optional(),
});
export type ComponentFrame = z.infer<typeof ComponentFrame>;

export const ElementInfo = z.object({
  selector: z.string().max(2000),
  xpath: z.string().max(2000),
  tagName: z.string().max(100),
  id: z.string().max(500).optional(),
  classes: z.array(z.string().max(300)).max(50),
  /** Visible text, whitespace-collapsed and truncated. */
  text: z.string().max(500).optional(),
  role: z.string().max(100).optional(),
  ariaLabel: z.string().max(500).optional(),
  testId: z.string().max(300).optional(),
  attributes: z.record(z.string().max(500)),
  /** Truncated outerHTML with the inner content elided. */
  html: z.string().max(4000),
  styles: z.record(z.string().max(300)),
  components: z.array(ComponentFrame).max(25),
});
export type ElementInfo = z.infer<typeof ElementInfo>;

export const ResolutionNote = z.object({
  note: z.string().max(5000),
  by: z.enum(['user', 'agent']),
  at: z.string(),
});
export type ResolutionNote = z.infer<typeof ResolutionNote>;

export const Annotation = z.object({
  id: z.string().min(1).max(64),
  /** 1-based number drawn on the pin in the annotated screenshot. */
  index: z.number().int().positive(),
  kind: z.enum(['element', 'region']),
  category: AnnotationCategory,
  comment: z.string().max(5000),
  /** Viewport CSS-pixel rect at the moment of capture. */
  rect: Rect,
  /** False when the annotated element was scrolled out of the captured viewport. */
  inViewport: z.boolean(),
  element: ElementInfo.optional(),
  status: AnnotationStatus,
  resolution: ResolutionNote.optional(),
  /** Crop of the original screenshot around this annotation, relative to the report dir. */
  crop: z.string().max(200).optional(),
});
export type Annotation = z.infer<typeof Annotation>;

export const ConsoleEntry = z.object({
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  message: z.string().max(10_000),
  at: z.number(),
  /** Collapsed repeat count of the same consecutive message. */
  count: z.number().int().positive().optional(),
  stack: z.string().max(10_000).optional(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

export const NetworkEntry = z.object({
  method: z.string().max(20),
  url: z.string().max(4000),
  status: z.number().int(),
  statusText: z.string().max(200).optional(),
  ok: z.boolean(),
  /** fetch | xhr */
  initiator: z.enum(['fetch', 'xhr']),
  startedAt: z.number(),
  durationMs: z.number().nonnegative(),
  requestContentType: z.string().max(200).optional(),
  responseContentType: z.string().max(200).optional(),
  responseSize: z.number().int().nonnegative().optional(),
  /** Request body, truncated; only captured for failed requests. */
  requestBody: z.string().max(4000).optional(),
  /** Response body, truncated; only captured for failed requests. */
  responseBody: z.string().max(4000).optional(),
  error: z.string().max(1000).optional(),
});
export type NetworkEntry = z.infer<typeof NetworkEntry>;

export const ErrorEntry = z.object({
  kind: z.enum(['error', 'unhandledrejection']),
  message: z.string().max(10_000),
  source: z.string().max(2000).optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  stack: z.string().max(10_000).optional(),
  at: z.number(),
});
export type ErrorEntry = z.infer<typeof ErrorEntry>;

export const ActionEntry = z.object({
  type: z.enum(['click', 'input', 'submit', 'navigation', 'keydown', 'scroll']),
  at: z.number(),
  target: z.string().max(2000).optional(),
  /** Human-readable description; input values are never recorded. */
  detail: z.string().max(1000).optional(),
  url: z.string().max(4000).optional(),
});
export type ActionEntry = z.infer<typeof ActionEntry>;

export const DeviceInfo = z.object({
  userAgent: z.string().max(1000),
  browser: z.string().max(200),
  os: z.string().max(200),
  platform: z.string().max(200),
  language: z.string().max(100),
  languages: z.array(z.string().max(100)).max(20),
  timezone: z.string().max(100),
  screen: z.object({ width: z.number(), height: z.number(), colorDepth: z.number() }),
  hardwareConcurrency: z.number().optional(),
  deviceMemoryGb: z.number().optional(),
  connection: z
    .object({
      effectiveType: z.string().max(20).optional(),
      downlinkMbps: z.number().optional(),
      rttMs: z.number().optional(),
      saveData: z.boolean().optional(),
    })
    .optional(),
  colorScheme: z.enum(['light', 'dark']),
  reducedMotion: z.boolean(),
  touch: z.boolean(),
  online: z.boolean(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const Viewport = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  scrollX: z.number(),
  scrollY: z.number(),
  devicePixelRatio: z.number().positive(),
  documentWidth: z.number().nonnegative(),
  documentHeight: z.number().nonnegative(),
});
export type Viewport = z.infer<typeof Viewport>;

export const PagePerformance = z.object({
  /** ms from navigation start */
  domContentLoadedMs: z.number().optional(),
  loadMs: z.number().optional(),
  firstContentfulPaintMs: z.number().optional(),
  largestContentfulPaintMs: z.number().optional(),
  usedJsHeapMb: z.number().optional(),
});
export type PagePerformance = z.infer<typeof PagePerformance>;

export const ActivityEntry = z.object({
  at: z.string(),
  actor: z.enum(['user', 'agent', 'system']),
  type: z.enum(['created', 'status_changed', 'annotation_status_changed', 'note', 'updated']),
  message: z.string().max(5000),
  annotationId: z.string().max(64).optional(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const ScreenshotSet = z.object({
  original: z.string(),
  annotated: z.string(),
  originalPreview: z.string(),
  annotatedPreview: z.string(),
  /** Pixel size of the full-resolution images. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ScreenshotSet = z.infer<typeof ScreenshotSet>;

export const Report = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().regex(/^ol-[0-9]{8}-[a-z0-9]{6}$/),
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).optional(),
  status: ReportStatus,
  priority: Priority,
  tags: z.array(z.string().max(50)).max(20),
  createdAt: z.string(),
  updatedAt: z.string(),
  page: z.object({
    url: z.string().max(4000),
    title: z.string().max(1000),
    referrer: z.string().max(4000).optional(),
  }),
  viewport: Viewport,
  device: DeviceInfo,
  performance: PagePerformance.optional(),
  annotations: z.array(Annotation).max(200),
  console: z.array(ConsoleEntry).max(2000),
  network: z.array(NetworkEntry).max(2000),
  errors: z.array(ErrorEntry).max(1000),
  actions: z.array(ActionEntry).max(2000),
  screenshots: ScreenshotSet,
  activity: z.array(ActivityEntry).max(2000),
  source: z.object({
    extensionVersion: z.string().max(50),
    capturedAt: z.string(),
  }),
});
export type Report = z.infer<typeof Report>;

/**
 * What the extension POSTs: a report without server-owned fields, plus images
 * as base64 data URLs. The server assigns ids, file names and the activity log.
 */
export const NewReportPayload = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(10_000).optional(),
  priority: Priority.default('medium'),
  tags: z.array(z.string().max(50)).max(20).default([]),
  page: Report.shape.page,
  viewport: Viewport,
  device: DeviceInfo,
  performance: PagePerformance.optional(),
  annotations: z
    .array(
      Annotation.omit({ status: true, resolution: true, crop: true }).extend({
        cropDataUrl: z.string().optional(),
      }),
    )
    .max(200),
  console: z.array(ConsoleEntry).max(2000),
  network: z.array(NetworkEntry).max(2000),
  errors: z.array(ErrorEntry).max(1000),
  actions: z.array(ActionEntry).max(2000),
  images: z.object({
    original: z.string(),
    annotated: z.string(),
    originalPreview: z.string(),
    annotatedPreview: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  extensionVersion: z.string().max(50),
  capturedAt: z.string(),
  /** Client-generated key so a retried upload never creates a duplicate. */
  clientKey: z.string().min(8).max(100),
});
export type NewReportPayload = z.input<typeof NewReportPayload>;
export type ParsedNewReportPayload = z.output<typeof NewReportPayload>;

export const ReportSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: ReportStatus,
  priority: Priority,
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string(),
  pageTitle: z.string(),
  annotationCount: z.number().int(),
  closedAnnotationCount: z.number().int(),
  errorCount: z.number().int(),
  failedRequestCount: z.number().int(),
});
export type ReportSummary = z.infer<typeof ReportSummary>;

export const ReportPatch = z
  .object({
    status: ReportStatus.optional(),
    title: z.string().min(1).max(300).optional(),
    priority: Priority.optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    note: z.string().max(5000).optional(),
  })
  .strict();
export type ReportPatch = z.infer<typeof ReportPatch>;

export const AnnotationPatch = z
  .object({
    status: AnnotationStatus.optional(),
    comment: z.string().max(5000).optional(),
    note: z.string().max(5000).optional(),
  })
  .strict();
export type AnnotationPatch = z.infer<typeof AnnotationPatch>;

export const ListQuery = z.object({
  status: z.union([ReportStatus, z.literal('active'), z.literal('closed'), z.literal('all')]).default('all'),
  url: z.string().max(4000).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListQuery = z.infer<typeof ListQuery>;
