import type { Report, ReportSummary } from './schema';
import { isClosedStatus } from './schema';

export * from './core';

export const toSummary = (r: Report): ReportSummary => ({
  id: r.id,
  title: r.title,
  status: r.status,
  priority: r.priority,
  tags: r.tags,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  url: r.page.url,
  pageTitle: r.page.title,
  annotationCount: r.annotations.length,
  closedAnnotationCount: r.annotations.filter((a) => isClosedStatus(a.status)).length,
  errorCount: r.errors.length + r.console.filter((c) => c.level === 'error').length,
  failedRequestCount: r.network.filter((n) => !n.ok).length,
});

export const REPORT_ID_RE = /^ol-[0-9]{8}-[a-z0-9]{6}$/;
