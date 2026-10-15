import type { AnnotationPatch, NewReportPayload, Report, ReportPatch, ReportSummary } from '@open-loop/shared';
import { API_HEADER, API_HEADER_VALUE } from '@open-loop/shared/core';

export class ApiError extends Error {
  constructor(
    message: string,
    /** 0 = the server could not be reached. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Worth retrying later: unreachable, overloaded or locked. */
  get transient(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Thin client for the local Open Loop server (see packages/server/src/http.ts). */
export class ApiClient {
  constructor(private readonly base: string) {}

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { [API_HEADER]: API_HEADER_VALUE, 'content-type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
      throw new ApiError(`Open Loop server at ${this.base} ${reason}`, 0);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* non-JSON error */
      }
      throw new ApiError(message, res.status);
    }
    return (await res.json()) as T;
  }

  health() {
    return this.request<{ ok: true; name: string; version: string; store: string }>('/api/health', {}, 2500);
  }

  list(params: { status?: string; url?: string; search?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return this.request<{ reports: ReportSummary[] }>(`/api/reports?${q.toString()}`);
  }

  get(id: string) {
    return this.request<{ report: Report }>(`/api/reports/${encodeURIComponent(id)}`);
  }

  create(payload: NewReportPayload) {
    return this.request<{ report: Report; created: boolean }>(
      '/api/reports',
      { method: 'POST', body: JSON.stringify(payload) },
      60_000,
    );
  }

  patch(id: string, patch: ReportPatch) {
    return this.request<{ report: Report }>(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  patchAnnotation(id: string, annotationId: string, patch: AnnotationPatch) {
    return this.request<{ report: Report }>(
      `/api/reports/${encodeURIComponent(id)}/annotations/${encodeURIComponent(annotationId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  }

  addNote(id: string, message: string, annotationId?: string) {
    return this.request<{ report: Report }>(`/api/reports/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ message, annotationId }),
    });
  }

  trash(id: string) {
    return this.request<{ ok: true }>(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Image files need the API header, so they are fetched as blobs, not <img src>. */
  async fileBlob(id: string, name: string): Promise<Blob> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/reports/${encodeURIComponent(id)}/files/${name.split('/').map(encodeURIComponent).join('/')}`, {
        headers: { [API_HEADER]: API_HEADER_VALUE },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ApiError(`Open Loop server at ${this.base} is not reachable`, 0);
    }
    if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
    return res.blob();
  }
}
