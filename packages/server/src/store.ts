import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  type ActivityEntry,
  type Annotation,
  type AnnotationPatch,
  type ListQuery,
  NewReportPayload,
  REPORT_ID_RE,
  Report,
  type ReportPatch,
  type ReportSummary,
  SCHEMA_VERSION,
  deriveTitle,
  isClosedStatus,
  toSummary,
} from '@open-loop/shared';
import type { Logger } from './logger';
import { silentLogger } from './logger';

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid' | 'conflict' | 'too_large' | 'busy',
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export const defaultHome = (): string => process.env.OPEN_LOOP_HOME || join(homedir(), '.open-loop');

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const FILE_NAME_RE = /^(?:[a-z0-9][a-z0-9._-]{0,80})$/;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  json: 'application/json',
};

export const mimeFor = (name: string): string =>
  MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

interface DecodedImage {
  ext: 'png' | 'jpg' | 'webp';
  bytes: Buffer;
}

const decodeDataUrl = (dataUrl: string, label: string): DecodedImage => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw new StoreError(`${label}: expected a base64 PNG, JPEG or WebP data URL`, 'invalid');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length === 0) throw new StoreError(`${label}: image is empty`, 'invalid');
  if (bytes.length > MAX_IMAGE_BYTES) throw new StoreError(`${label}: image exceeds 30 MB`, 'too_large');
  const ext = m[1] === 'jpeg' ? 'jpg' : (m[1] as 'png' | 'webp');
  return { ext, bytes };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Report id: date from the capture time, suffix hashed from the client key so retries dedupe. */
export const reportIdFor = (clientKey: string, capturedAt: string): string => {
  const d = new Date(capturedAt);
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  const hash = BigInt(`0x${createHash('sha256').update(clientKey).digest('hex').slice(0, 15)}`)
    .toString(36)
    .padStart(6, '0')
    .slice(-6);
  return `ol-${ymd}-${hash}`;
};

export interface Actor {
  actor: 'user' | 'agent' | 'system';
}

/**
 * Filesystem store shared by the HTTP daemon and any number of MCP processes.
 * Each report is a directory: report.json plus its images. Writes are
 * atomic (temp file + rename) and serialized per report with a lock directory,
 * so two processes updating the same report never lose an update.
 */
export class ReportStore {
  readonly root: string;
  readonly reportsDir: string;
  readonly trashDir: string;
  private readonly log: Logger;
  private readonly cache = new Map<string, { mtimeMs: number; report: Report }>();

  constructor(root: string = defaultHome(), log: Logger = silentLogger) {
    this.root = resolve(root);
    this.reportsDir = join(this.root, 'reports');
    this.trashDir = join(this.root, 'trash');
    this.log = log.child('store');
  }

  async init(): Promise<void> {
    await mkdir(this.reportsDir, { recursive: true });
    await mkdir(this.trashDir, { recursive: true });
  }

  reportDir(id: string): string {
    if (!REPORT_ID_RE.test(id)) throw new StoreError(`Invalid report id: ${id}`, 'invalid');
    return join(this.reportsDir, id);
  }

  /** Absolute path of a report file; refuses names that could escape the report directory. */
  filePath(id: string, name: string): string {
    if (!FILE_NAME_RE.test(name) && !/^crops\/[a-z0-9][a-z0-9._-]{0,80}$/.test(name)) {
      throw new StoreError(`Invalid file name: ${name}`, 'invalid');
    }
    const dir = this.reportDir(id);
    const full = resolve(dir, name);
    if (!full.startsWith(dir + sep)) throw new StoreError(`Invalid file name: ${name}`, 'invalid');
    return full;
  }

  async create(input: unknown, by: Actor = { actor: 'user' }): Promise<{ report: Report; created: boolean }> {
    const parsed = NewReportPayload.safeParse(input);
    if (!parsed.success) {
      throw new StoreError(`Invalid report payload: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 'invalid');
    }
    const p = parsed.data;
    const id = reportIdFor(p.clientKey, p.capturedAt);
    const dir = this.reportDir(id);

    const existing = await this.tryGet(id);
    if (existing) {
      this.log.info('duplicate upload ignored', { id });
      return { report: existing, created: false };
    }

    const images = {
      original: decodeDataUrl(p.images.original, 'images.original'),
      annotated: decodeDataUrl(p.images.annotated, 'images.annotated'),
      originalPreview: decodeDataUrl(p.images.originalPreview, 'images.originalPreview'),
      annotatedPreview: decodeDataUrl(p.images.annotatedPreview, 'images.annotatedPreview'),
    };

    const ids = new Set<string>();
    const indexes = new Set<number>();
    for (const a of p.annotations) {
      if (ids.has(a.id)) throw new StoreError(`Duplicate annotation id: ${a.id}`, 'invalid');
      if (indexes.has(a.index)) throw new StoreError(`Duplicate annotation index: ${a.index}`, 'invalid');
      ids.add(a.id);
      indexes.add(a.index);
    }

    const staging = join(this.reportsDir, `.staging-${randomBytes(6).toString('hex')}`);
    await mkdir(join(staging, 'crops'), { recursive: true });
    try {
      const files = {
        original: `original.${images.original.ext}`,
        annotated: `annotated.${images.annotated.ext}`,
        originalPreview: `original.preview.${images.originalPreview.ext}`,
        annotatedPreview: `annotated.preview.${images.annotatedPreview.ext}`,
      };
      await Promise.all([
        writeFile(join(staging, files.original), images.original.bytes),
        writeFile(join(staging, files.annotated), images.annotated.bytes),
        writeFile(join(staging, files.originalPreview), images.originalPreview.bytes),
        writeFile(join(staging, files.annotatedPreview), images.annotatedPreview.bytes),
      ]);

      const annotations: Annotation[] = [];
      for (const a of p.annotations) {
        const { cropDataUrl, ...rest } = a;
        let crop: string | undefined;
        if (cropDataUrl) {
          const img = decodeDataUrl(cropDataUrl, `annotation ${a.id} crop`);
          crop = `crops/annotation-${a.index}.${img.ext}`;
          await writeFile(join(staging, crop), img.bytes);
        }
        annotations.push({ ...rest, status: 'open', ...(crop ? { crop } : {}) });
      }

      const now = new Date().toISOString();
      const report: Report = {
        schemaVersion: SCHEMA_VERSION,
        id,
        title: p.title?.trim() || deriveTitle(p.annotations.map((a) => a.comment), p.page.title),
        ...(p.description?.trim() ? { description: p.description.trim() } : {}),
        status: 'open',
        priority: p.priority,
        tags: p.tags,
        createdAt: now,
        updatedAt: now,
        page: p.page,
        viewport: p.viewport,
        device: p.device,
        ...(p.performance ? { performance: p.performance } : {}),
        annotations,
        console: p.console,
        network: p.network,
        errors: p.errors,
        actions: p.actions,
        screenshots: { ...files, width: p.images.width, height: p.images.height },
        activity: [
          {
            at: now,
            actor: by.actor,
            type: 'created',
            message: `Report created with ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`,
          },
        ],
        source: { extensionVersion: p.extensionVersion, capturedAt: p.capturedAt },
      };
      Report.parse(report);
      await writeFile(join(staging, 'report.json'), JSON.stringify(report, null, 2));

      try {
        await rename(staging, dir);
      } catch (err) {
        // A concurrent retry of the same upload won the race: theirs stands.
        const raced = await this.tryGet(id);
        if (raced) return { report: raced, created: false };
        throw err;
      }
      this.log.info('report created', { id, annotations: annotations.length });
      return { report, created: true };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async get(id: string): Promise<Report> {
    const r = await this.tryGet(id);
    if (!r) throw new StoreError(`Report not found: ${id}`, 'not_found');
    return r;
  }

  private async tryGet(id: string): Promise<Report | undefined> {
    const file = join(this.reportDir(id), 'report.json');
    let st;
    try {
      st = await stat(file);
    } catch {
      this.cache.delete(id);
      return undefined;
    }
    const hit = this.cache.get(id);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.report;
    const raw = await readFile(file, 'utf8');
    const report = Report.parse(JSON.parse(raw));
    this.cache.set(id, { mtimeMs: st.mtimeMs, report });
    return report;
  }

  async list(q: ListQuery): Promise<ReportSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.reportsDir);
    } catch {
      return [];
    }
    const reports: Report[] = [];
    await Promise.all(
      names
        .filter((n) => REPORT_ID_RE.test(n))
        .map(async (id) => {
          try {
            const r = await this.tryGet(id);
            if (r) reports.push(r);
          } catch (err) {
            this.log.warn('skipping unreadable report', { id, err });
          }
        }),
    );
    const needle = q.search?.toLowerCase();
    return reports
      .filter((r) => {
        if (q.status === 'active' && isClosedStatus(r.status)) return false;
        if (q.status === 'closed' && !isClosedStatus(r.status)) return false;
        if (q.status !== 'all' && q.status !== 'active' && q.status !== 'closed' && r.status !== q.status) return false;
        if (q.url && !sameDocument(r.page.url, q.url)) return false;
        if (needle) {
          const hay = [r.id, r.title, r.page.url, r.page.title, ...r.annotations.map((a) => a.comment)]
            .join('\n')
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, q.limit)
      .map(toSummary);
  }

  async update(id: string, patch: ReportPatch, by: Actor): Promise<Report> {
    return this.mutate(id, (r, now) => {
      const log: ActivityEntry[] = [];
      if (patch.title !== undefined && patch.title !== r.title) {
        log.push({ at: now, actor: by.actor, type: 'updated', message: `Title changed to “${patch.title}”` });
        r.title = patch.title;
      }
      if (patch.priority !== undefined && patch.priority !== r.priority) {
        log.push({ at: now, actor: by.actor, type: 'updated', message: `Priority changed from ${r.priority} to ${patch.priority}` });
        r.priority = patch.priority;
      }
      if (patch.tags !== undefined) r.tags = patch.tags;
      if (patch.status !== undefined && patch.status !== r.status) {
        log.push({
          at: now,
          actor: by.actor,
          type: 'status_changed',
          message: `Status ${r.status} → ${patch.status}${patch.note ? `: ${patch.note}` : ''}`,
        });
        r.status = patch.status;
        // Closing the report closes what is still open under it, with the same note.
        if (isClosedStatus(patch.status)) {
          for (const a of r.annotations) {
            if (!isClosedStatus(a.status)) {
              a.status = patch.status;
              a.resolution = { note: patch.note ?? `Closed with the report (${patch.status})`, by: by.actor === 'agent' ? 'agent' : 'user', at: now };
            }
          }
        }
      } else if (patch.note) {
        log.push({ at: now, actor: by.actor, type: 'note', message: patch.note });
      }
      r.activity.push(...log);
    });
  }

  async updateAnnotation(id: string, annotationId: string, patch: AnnotationPatch, by: Actor): Promise<Report> {
    return this.mutate(id, (r, now) => {
      const a = r.annotations.find((x) => x.id === annotationId);
      if (!a) throw new StoreError(`Annotation ${annotationId} not found in ${id}`, 'not_found');
      if (patch.comment !== undefined && patch.comment !== a.comment) {
        a.comment = patch.comment;
        r.activity.push({ at: now, actor: by.actor, type: 'updated', message: `Comment on #${a.index} edited`, annotationId });
      }
      if (patch.status !== undefined && patch.status !== a.status) {
        const from = a.status;
        a.status = patch.status;
        if (isClosedStatus(patch.status)) {
          a.resolution = { note: patch.note ?? '', by: by.actor === 'agent' ? 'agent' : 'user', at: now };
        } else {
          delete a.resolution;
        }
        r.activity.push({
          at: now,
          actor: by.actor,
          type: 'annotation_status_changed',
          message: `#${a.index} ${from} → ${patch.status}${patch.note ? `: ${patch.note}` : ''}`,
          annotationId,
        });
        this.rollUp(r, now);
      } else if (patch.note) {
        r.activity.push({ at: now, actor: by.actor, type: 'note', message: patch.note, annotationId });
      }
    });
  }

  async addNote(id: string, message: string, by: Actor, annotationId?: string): Promise<Report> {
    return this.mutate(id, (r, now) => {
      if (annotationId && !r.annotations.some((a) => a.id === annotationId)) {
        throw new StoreError(`Annotation ${annotationId} not found in ${id}`, 'not_found');
      }
      r.activity.push({ at: now, actor: by.actor, type: 'note', message, ...(annotationId ? { annotationId } : {}) });
    });
  }

  /** Moves a report to the trash directory; nothing is ever hard-deleted. */
  async trash(id: string): Promise<void> {
    const dir = this.reportDir(id);
    try {
      await stat(dir);
    } catch {
      throw new StoreError(`Report not found: ${id}`, 'not_found');
    }
    await rename(dir, join(this.trashDir, `${id}-${Date.now()}`));
    this.cache.delete(id);
    this.log.info('report trashed', { id });
  }

  /** Report status follows its annotations: all closed ⇒ resolved; one reopened ⇒ open; work started ⇒ in progress. */
  private rollUp(r: Report, now: string): void {
    if (r.annotations.length === 0) return;
    const allClosed = r.annotations.every((a) => isClosedStatus(a.status));
    const anyStarted = r.annotations.some((a) => a.status === 'in_progress' || isClosedStatus(a.status));
    let next = r.status;
    if (allClosed) next = r.annotations.every((a) => a.status === 'wont_fix') ? 'wont_fix' : 'resolved';
    else if (isClosedStatus(r.status)) next = anyStarted ? 'in_progress' : 'open';
    else if (r.status === 'open' && anyStarted) next = 'in_progress';
    if (next !== r.status) {
      r.activity.push({ at: now, actor: 'system', type: 'status_changed', message: `Status ${r.status} → ${next} (follows annotations)` });
      r.status = next;
    }
  }

  private async mutate(id: string, fn: (r: Report, now: string) => void): Promise<Report> {
    const dir = this.reportDir(id);
    return this.withLock(dir, async () => {
      const file = join(dir, 'report.json');
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        throw new StoreError(`Report not found: ${id}`, 'not_found');
      }
      const report = Report.parse(JSON.parse(raw));
      const now = new Date().toISOString();
      fn(report, now);
      report.updatedAt = now;
      Report.parse(report);
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify(report, null, 2));
      await rename(tmp, file);
      this.cache.delete(id);
      return report;
    });
  }

  private async withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const lock = join(dir, '.lock');
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') throw new StoreError(`Report not found: ${dir.split(sep).pop()}`, 'not_found');
        if (code !== 'EEXIST') throw err;
        try {
          const st = await stat(lock);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            this.log.warn('removing stale lock', { lock });
            await rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) throw new StoreError('Report is locked by another writer; try again', 'busy');
        await sleep(20 + Math.random() * 30);
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

/** Same page ignoring the hash and trailing slash. */
export const sameDocument = (a: string, b: string): boolean => {
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      x.hash = '';
      return x.toString().replace(/\/$/, '');
    } catch {
      return u.replace(/#.*$/, '').replace(/\/$/, '');
    }
  };
  return norm(a) === norm(b);
};
