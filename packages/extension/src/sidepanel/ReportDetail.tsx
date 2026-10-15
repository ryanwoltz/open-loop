import { useCallback, useEffect, useState } from 'react';
import { ANNOTATION_STATUSES, REPORT_STATUSES, type Annotation, type AnnotationStatus, type Report, type ReportStatus } from '@open-loop/shared';
import { errorMessage } from '../lib/logger';
import { CATEGORY_META, PRIORITY_META, STATUS_META } from '../lib/ui';
import { agentPrompt, clockTime, relativeTime } from './format';
import { useApi, useBlobUrl } from './hooks';
import { IconBack, IconCopy, IconExternal, IconTrash } from './icons';
import { Badge, Spinner, copyText, useToast } from './ui';

type LogTab = 'console' | 'network' | 'errors' | 'actions' | 'device';

export const ReportDetail = ({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) => {
  const api = useApi();
  const toast = useToast();
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();
  const [variant, setVariant] = useState<'annotated' | 'original'>('annotated');
  const [logTab, setLogTab] = useState<LogTab>('console');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setReport((await api.get(id)).report);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const image = useBlobUrl(api, report?.id, report ? report.screenshots[variant === 'annotated' ? 'annotatedPreview' : 'originalPreview'] : undefined);

  const act = async (fn: () => Promise<{ report: Report } | unknown>, ok?: string) => {
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'report' in res) setReport((res as { report: Report }).report);
      if (ok) toast(ok);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  if (error && !report) {
    return (
      <div className="stack">
        <button className="link back" onClick={onBack}>
          <IconBack /> All reports
        </button>
        <p className="error-text">{error}</p>
      </div>
    );
  }
  if (!report || !api) return <div className="center"><Spinner /></div>;

  const openFull = async () => {
    try {
      const blob = await api.fileBlob(report.id, report.screenshots[variant]);
      await chrome.tabs.create({ url: URL.createObjectURL(blob) });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="stack detail">
      <div className="detail-nav">
        <button className="link back" onClick={onBack}>
          <IconBack /> All reports
        </button>
        <code className="muted small">{report.id}</code>
      </div>

      <div>
        <h2 className="detail-title">{report.title}</h2>
        <div className="row-sub">
          <a href={report.page.url} target="_blank" rel="noreferrer" className="link-plain">
            {report.page.url}
          </a>
        </div>
        <div className="row-sub">
          Created {relativeTime(report.createdAt)} · updated {relativeTime(report.updatedAt)}
        </div>
      </div>

      <div className="detail-controls">
        <select
          className={`status-select tone-${STATUS_META[report.status].tone}`}
          value={report.status}
          onChange={(e) => void act(() => api.patch(report.id, { status: e.target.value as ReportStatus }), 'Status updated')}
          aria-label="Report status"
        >
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <Badge tone={PRIORITY_META[report.priority].tone}>{PRIORITY_META[report.priority].label}</Badge>
        <span className="spacer" />
        <button className="icon-btn" title="Copy agent prompt" onClick={() => void copyText(agentPrompt(report.id)).then(() => toast('Prompt copied'))}>
          <IconCopy />
        </button>
        <button className="icon-btn" title="Open page" onClick={() => void chrome.tabs.create({ url: report.page.url })}>
          <IconExternal />
        </button>
        <button
          className="icon-btn danger"
          title="Move to trash"
          onClick={() => {
            if (confirm('Move this report to the trash? (It stays in the trash folder of the Open Loop data directory.)')) {
              void act(() => api.trash(report.id), 'Moved to trash').then(onBack);
            }
          }}
        >
          <IconTrash />
        </button>
      </div>

      {report.description && <p className="description">{report.description}</p>}

      <div className="shot">
        <div className="seg seg-sm">
          <button className={`seg-btn ${variant === 'annotated' ? 'on' : ''}`} onClick={() => setVariant('annotated')}>
            Annotated
          </button>
          <button className={`seg-btn ${variant === 'original' ? 'on' : ''}`} onClick={() => setVariant('original')}>
            Original
          </button>
        </div>
        <button className="shot-frame" onClick={() => void openFull()} title="Open full resolution">
          {image.url ? <img src={image.url} alt={`${variant} screenshot`} /> : image.error ? <span className="error-text">{image.error}</span> : <Spinner />}
        </button>
      </div>

      <section>
        <h3>Annotations</h3>
        {report.annotations.length === 0 ? (
          <p className="muted small">No annotations.</p>
        ) : (
          <ol className="drafts">
            {report.annotations.map((a) => (
              <AnnotationCard
                key={a.id}
                a={a}
                onStatus={(status, n) => void act(() => api.patchAnnotation(report.id, a.id, { status, ...(n ? { note: n } : {}) }))}
              />
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3>Activity</h3>
        <ul className="timeline">
          {[...report.activity].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`} className={`tl tl-${e.actor}`}>
              <span className="tl-dot" />
              <div>
                <div className="tl-msg">{e.message}</div>
                <div className="tl-meta">
                  {e.actor === 'agent' ? 'Agent' : e.actor === 'system' ? 'Open Loop' : 'You'} · {relativeTime(e.at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void act(() => api.addNote(report.id, note.trim()), 'Note added').then(() => setNote(''));
          }}
        >
          <input className="input" value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the agent…" />
          <button className="btn btn-sm" disabled={!note.trim()}>
            Add
          </button>
        </form>
      </section>

      <section>
        <div className="seg seg-sm logs-tabs">
          {(
            [
              ['console', `Console ${report.console.length}`],
              ['network', `Network ${report.network.length}`],
              ['errors', `Errors ${report.errors.length}`],
              ['actions', `Actions ${report.actions.length}`],
              ['device', 'Device'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`seg-btn ${logTab === k ? 'on' : ''}`} onClick={() => setLogTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <LogPane report={report} tab={logTab} />
      </section>
    </div>
  );
};

const AnnotationCard = ({ a, onStatus }: { a: Annotation; onStatus: (s: AnnotationStatus, note?: string) => void }) => {
  const meta = CATEGORY_META[a.category];
  return (
    <li className={`draft ann-${a.status}`} style={{ ['--c' as string]: meta.color }}>
      <div className="draft-head">
        <span className="pin">{a.index}</span>
        <span className="draft-label" title={a.element?.selector}>
          {a.element ? `${a.element.tagName}${a.element.id ? `#${a.element.id}` : ''}` : 'Region'}
          {a.element?.components[0] ? ` · ${a.element.components[0].name}` : ''}
        </span>
        <select
          className={`status-select status-sm tone-${STATUS_META[a.status].tone}`}
          value={a.status}
          onChange={(e) => {
            const s = e.target.value as AnnotationStatus;
            const n = s === 'resolved' || s === 'wont_fix' ? (prompt('Resolution note (optional)') ?? undefined) : undefined;
            onStatus(s, n || undefined);
          }}
          aria-label={`Status of annotation ${a.index}`}
        >
          {ANNOTATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>
      <p className="ann-comment">{a.comment || <span className="muted">(no comment)</span>}</p>
      {!a.inViewport && <p className="muted small">Outside the captured viewport.</p>}
      {a.resolution?.note && (
        <div className="resolution">
          <b>{a.resolution.by === 'agent' ? 'Agent' : 'You'}:</b> {a.resolution.note}
        </div>
      )}
      {a.element?.components[0]?.source?.file && <code className="source">{a.element.components[0].source.file}{a.element.components[0].source.line ? `:${a.element.components[0].source.line}` : ''}</code>}
    </li>
  );
};

const LogPane = ({ report, tab }: { report: Report; tab: LogTab }) => {
  if (tab === 'device') {
    const d = report.device;
    const v = report.viewport;
    const p = report.performance;
    const rows: Array<[string, string]> = [
      ['Browser', d.browser],
      ['OS', d.os],
      ['Viewport', `${v.width}×${v.height} @${v.devicePixelRatio}x`],
      ['Screen', `${d.screen.width}×${d.screen.height}`],
      ['Scroll', `${v.scrollX}, ${v.scrollY} of ${v.documentWidth}×${v.documentHeight}`],
      ['Language', d.language],
      ['Timezone', d.timezone],
      ['Color scheme', d.colorScheme],
      ['Network', d.connection?.effectiveType ? `${d.connection.effectiveType}${d.connection.rttMs !== undefined ? `, ${d.connection.rttMs}ms RTT` : ''}` : d.online ? 'online' : 'offline'],
      ...(p?.loadMs ? [['Load', `${p.loadMs} ms`] as [string, string]] : []),
      ...(p?.largestContentfulPaintMs ? [['LCP', `${p.largestContentfulPaintMs} ms`] as [string, string]] : []),
      ...(p?.usedJsHeapMb ? [['JS heap', `${p.usedJsHeapMb} MB`] as [string, string]] : []),
      ['Extension', report.source.extensionVersion],
    ];
    return (
      <dl className="kv">
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (tab === 'console') {
    if (!report.console.length) return <p className="muted small">No console output.</p>;
    return (
      <ul className="logs">
        {report.console.map((c, i) => (
          <li key={i} className={`log log-${c.level}`}>
            <span className="log-time">{clockTime(c.at)}</span>
            <span className="log-msg">
              {c.message}
              {c.count && c.count > 1 ? <span className="log-count">×{c.count}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (tab === 'network') {
    if (!report.network.length) return <p className="muted small">No requests recorded.</p>;
    return (
      <ul className="logs">
        {report.network.map((n, i) => (
          <li key={i} className={`log ${n.ok ? '' : 'log-error'}`} title={n.responseBody ?? n.error ?? ''}>
            <span className="log-status">{n.status || 'ERR'}</span>
            <span className="log-msg">
              <b>{n.method}</b> {n.url}
            </span>
            <span className="log-time">{n.durationMs}ms</span>
          </li>
        ))}
      </ul>
    );
  }
  if (tab === 'errors') {
    if (!report.errors.length) return <p className="muted small">No uncaught errors.</p>;
    return (
      <ul className="logs">
        {report.errors.map((e, i) => (
          <li key={i} className="log log-error">
            <span className="log-time">{clockTime(e.at)}</span>
            <span className="log-msg">
              {e.message}
              {e.source ? <small className="muted"> — {e.source}:{e.line}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (!report.actions.length) return <p className="muted small">No actions recorded.</p>;
  return (
    <ul className="logs">
      {report.actions.map((a, i) => (
        <li key={i} className="log">
          <span className="log-time">{clockTime(a.at)}</span>
          <span className="log-msg">
            <b>{a.type}</b> {a.target ?? a.url ?? ''} {a.detail ? <span className="muted">{a.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
};
