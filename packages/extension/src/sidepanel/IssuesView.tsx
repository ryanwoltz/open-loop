import { useCallback, useEffect, useState } from 'react';
import type { ReportSummary } from '@open-loop/shared';
import { errorMessage } from '../lib/logger';
import { callBackground } from '../lib/rpc';
import type { QueuedReport } from '../lib/types';
import { PRIORITY_META, STATUS_META } from '../lib/ui';
import { ReportDetail } from './ReportDetail';
import { hostOf, relativeTime } from './format';
import { useActiveTab, useApi, useBlobUrl, useBroadcast } from './hooks';
import { IconCloudOff, IconInbox, IconRefresh, IconSearch, IconTrash } from './icons';
import { Badge, Empty, Spinner, useToast } from './ui';

type Filter = 'active' | 'open' | 'in_progress' | 'closed' | 'all';
const FILTERS: Array<[Filter, string]> = [
  ['active', 'Active'],
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['closed', 'Closed'],
  ['all', 'All'],
];

interface Props {
  openId?: string;
  onOpen: (id: string | undefined) => void;
  connected: boolean;
  queue: QueuedReport[];
}

export const IssuesView = ({ openId, onOpen, connected, queue }: Props) => {
  const api = useApi();
  const tab = useActiveTab();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [thisPage, setThisPage] = useState(false);
  const [reports, setReports] = useState<ReportSummary[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const { reports: rows } = await api.list({
        status: filter,
        search: search.trim() || undefined,
        url: thisPage && tab?.url ? tab.url : undefined,
        limit: 200,
      });
      setReports(rows);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, filter, search, thisPage, tab?.url]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 250 : 0);
    // Agents resolve annotations while you watch: poll while the list is open.
    const id = setInterval(() => void load(), 4000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load, search]);
  useBroadcast((m) => {
    if (m.type === 'reportSaved' || m.type === 'statusChanged') void load();
  });

  if (openId) return <ReportDetail id={openId} onBack={() => onOpen(undefined)} onChanged={() => void load()} />;

  const pending = queue;
  return (
    <div className="stack">
      <div className="search">
        <IconSearch />
        <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles, comments, URLs, ids" />
      </div>
      <div className="filters">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`chip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
        <label className="check check-inline">
          <input type="checkbox" checked={thisPage} onChange={(e) => setThisPage(e.target.checked)} />
          This page
        </label>
      </div>

      {pending.length > 0 && (
        <section className="queue">
          <div className="section-head">
            <h3>
              <IconCloudOff /> Waiting to upload
            </h3>
            <button
              className="link"
              onClick={() =>
                void callBackground({ type: 'retryQueue' })
                  .then((r) => toast(r.sent ? `Uploaded ${r.sent}` : 'Server still unreachable', r.sent ? 'ok' : 'warn'))
                  .catch((err) => toast(errorMessage(err), 'error'))
              }
            >
              <IconRefresh width={13} height={13} /> Retry
            </button>
          </div>
          {pending.map((q) => (
            <div key={q.clientKey} className="queue-row">
              <div className="queue-main">
                <div className="row-title">{q.title}</div>
                <div className="row-sub">
                  {hostOf(q.url)} · {relativeTime(q.queuedAt)}
                  {q.failed ? <span className="tone-red"> · rejected: {q.lastError}</span> : null}
                </div>
              </div>
              <button
                className="icon-btn"
                aria-label="Discard queued report"
                onClick={() => {
                  if (confirm(`Discard “${q.title}”? It hasn't been uploaded.`)) {
                    void callBackground({ type: 'discardQueued', clientKey: q.clientKey }).catch((err) => toast(errorMessage(err), 'error'));
                  }
                }}
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </section>
      )}

      {error && !connected ? (
        <Empty icon={<IconCloudOff width={22} height={22} />} title="Server not reachable">
          <p className="muted">Start it with</p>
          <pre className="code">open-loop serve</pre>
          <p className="muted small">or connect the MCP server to your agent (Settings) — it serves the API too.</p>
        </Empty>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : !reports ? (
        <div className="center">
          <Spinner />
        </div>
      ) : reports.length === 0 ? (
        <Empty icon={<IconInbox width={22} height={22} />} title={filter === 'active' ? 'Nothing open' : 'No reports'}>
          <p className="muted">{filter === 'active' ? 'Every report is resolved. Nice.' : 'Try another filter.'}</p>
        </Empty>
      ) : (
        <ul className="reports">
          {reports.map((r) => (
            <ReportRow key={r.id} report={r} onOpen={() => onOpen(r.id)} />
          ))}
        </ul>
      )}
    </div>
  );
};

const ReportRow = ({ report: r, onOpen }: { report: ReportSummary; onOpen: () => void }) => {
  const api = useApi();
  const { url } = useBlobUrl(api, r.id, 'annotated.preview.jpg');
  const done = r.closedAnnotationCount;
  const total = r.annotationCount;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <li>
      <button className="report-row" onClick={onOpen}>
        <div className="thumb">{url ? <img src={url} alt="" /> : <span className="thumb-ph" />}</div>
        <div className="row-body">
          <div className="row-title">{r.title}</div>
          <div className="row-sub">
            {hostOf(r.url)} · {relativeTime(r.createdAt)}
          </div>
          <div className="row-badges">
            <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
            {r.priority !== 'medium' && <Badge tone={PRIORITY_META[r.priority].tone}>{PRIORITY_META[r.priority].label}</Badge>}
            {r.errorCount > 0 && <Badge tone="red">{r.errorCount} errors</Badge>}
            {r.failedRequestCount > 0 && <Badge tone="amber">{r.failedRequestCount} failed</Badge>}
          </div>
          {total > 0 && (
            <div className="progress" title={`${done} of ${total} annotations closed`}>
              <span style={{ width: `${pct}%` }} />
              <small>
                {done}/{total}
              </small>
            </div>
          )}
        </div>
      </button>
    </li>
  );
};
