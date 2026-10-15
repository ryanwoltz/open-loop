import { useEffect, useRef, useState } from 'react';
import { PRIORITIES, type AnnotationCategory, type Priority } from '@open-loop/shared';
import { errorMessage } from '../lib/logger';
import { callBackground } from '../lib/rpc';
import type { Draft, ReportMeta, SubmitResult, TabState } from '../lib/types';
import { CATEGORY_META, CATEGORY_ORDER, PRIORITY_META } from '../lib/ui';
import { agentPrompt, hostOf } from './format';
import { useActiveTab, useBroadcast, useTabState } from './hooks';
import { IconAlert, IconCheck, IconCopy, IconCursor, IconGlobe, IconRegion, IconSend, IconTrash, IconX } from './icons';
import { Empty, Spinner, copyText, useToast } from './ui';

interface Props {
  enabled: boolean;
  onEnable: () => void;
  onOpenReport: (id: string) => void;
}

const FORM_KEY = 'ol:captureForm';

export const CaptureView = ({ enabled, onEnable, onOpenReport }: Props) => {
  const tab = useActiveTab();
  const { state, error, refresh, setState } = useTabState(tab, enabled);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [include, setInclude] = useState<ReportMeta['include']>({ console: true, network: true, actions: true });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SubmitResult>();

  // Remember the include toggles between captures.
  useEffect(() => {
    void chrome.storage.local.get(FORM_KEY).then((got) => {
      const f = got[FORM_KEY] as { include?: ReportMeta['include'] } | undefined;
      if (f?.include) setInclude(f.include);
    });
  }, []);
  const setIncludeKey = (k: keyof ReportMeta['include'], v: boolean) => {
    const next = { ...include, [k]: v };
    setInclude(next);
    void chrome.storage.local.set({ [FORM_KEY]: { include: next } });
  };

  useEffect(() => setSaved(undefined), [tab?.id]);
  useBroadcast((m) => {
    if (m.type === 'reportSaved' && m.tabId === tab?.id) {
      setSaved(m.result);
      setTitle('');
      setDescription('');
    }
  });

  if (!enabled) {
    return (
      <Empty icon={<IconCursor width={22} height={22} />} title="Open Loop is off">
        <p className="muted">Nothing is being captured. Turn it on to annotate pages and record console, network and click history.</p>
        <button className="btn btn-primary" onClick={onEnable}>
          Turn on
        </button>
      </Empty>
    );
  }
  if (!tab || tab.id === undefined) return <div className="center"><Spinner /></div>;
  if (error) {
    return (
      <Empty icon={<IconGlobe width={22} height={22} />} title="Can't annotate this page">
        <p className="muted">{error}</p>
        <button className="btn" onClick={refresh}>
          Try again
        </button>
      </Empty>
    );
  }
  if (!state) return <div className="center"><Spinner /></div>;

  const tabId = tab.id;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      const next = await fn();
      if (next && typeof next === 'object' && 'drafts' in next) setState(next as TabState);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const startTool = (tool: 'element' | 'region') =>
    run(() =>
      state.annotating === tool ? callBackground({ type: 'stopAnnotating', tabId }) : callBackground({ type: 'startAnnotating', tabId, tool }),
    );

  const submit = async () => {
    setSaving(true);
    setSaved(undefined);
    try {
      const result = await callBackground({
        type: 'submitReport',
        tabId,
        meta: { title, description, priority, include },
      });
      setSaved(result);
      setTitle('');
      setDescription('');
      toast(result.queued ? 'Server offline — report queued and will upload automatically' : `Saved ${result.reportId}`, result.queued ? 'warn' : 'ok');
      refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const c = state.counts;
  return (
    <div className="stack">
      <section className="page-card">
        <div className="page-title" title={state.title}>
          {state.title || 'Untitled page'}
        </div>
        <div className="page-url" title={state.url}>
          {hostOf(state.url)}
        </div>
        <div className="counters">
          <Counter label="errors" value={c.errors + c.consoleErrors} tone={c.errors + c.consoleErrors > 0 ? 'red' : undefined} />
          <Counter label="failed requests" value={c.failedRequests} tone={c.failedRequests > 0 ? 'amber' : undefined} />
          <Counter label="console" value={c.console} />
          <Counter label="requests" value={c.network} />
          <Counter label="actions" value={c.actions} />
        </div>
      </section>

      <section className="tools">
        <button className={`tool-btn ${state.annotating === 'element' ? 'active' : ''}`} onClick={() => void startTool('element')}>
          <IconCursor />
          <span>
            <b>Select element</b>
            <small>Click to comment on a component</small>
          </span>
          <kbd>E</kbd>
        </button>
        <button className={`tool-btn ${state.annotating === 'region' ? 'active' : ''}`} onClick={() => void startTool('region')}>
          <IconRegion />
          <span>
            <b>Draw region</b>
            <small>Drag to mark any area</small>
          </span>
          <kbd>R</kbd>
        </button>
      </section>

      {saved && (
        <section className={`saved ${saved.queued ? 'saved-queued' : ''}`}>
          <div className="saved-head">
            {saved.queued ? <IconAlert /> : <IconCheck />}
            <b>{saved.queued ? 'Queued offline' : 'Report saved'}</b>
            {saved.reportId && <code>{saved.reportId}</code>}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setSaved(undefined)}>
              <IconX />
            </button>
          </div>
          {saved.reportId ? (
            <div className="saved-actions">
              <button
                className="btn btn-sm"
                onClick={() =>
                  void copyText(agentPrompt(saved.reportId!)).then(
                    () => toast('Prompt copied — paste it into your agent'),
                    (err) => toast(errorMessage(err), 'error'),
                  )
                }
              >
                <IconCopy /> Copy agent prompt
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => onOpenReport(saved.reportId!)}>
                View report
              </button>
            </div>
          ) : (
            <p className="muted small">It uploads as soon as the Open Loop server is reachable.</p>
          )}
        </section>
      )}

      <section>
        <div className="section-head">
          <h3>Annotations</h3>
          {state.drafts.length > 0 && (
            <button className="link danger" onClick={() => void run(() => callBackground({ type: 'clearDrafts', tabId }))}>
              Clear all
            </button>
          )}
        </div>
        {state.drafts.length === 0 ? (
          <div className="hint-card">
            <p>
              Pick a tool above, then click an element or drag a box on the page. Each note gets a numbered marker in the screenshot.
            </p>
            <p className="muted small">
              Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> · ↑ selects the parent element
            </p>
          </div>
        ) : (
          <ol className="drafts">
            {state.drafts.map((d) => (
              <DraftCard key={d.id} draft={d} tabId={tabId} onState={(s) => setState(s)} />
            ))}
          </ol>
        )}
      </section>

      <section className="form">
        <h3>Report</h3>
        <input
          className="input"
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={state.drafts[0]?.comment ? `Title (default: “${state.drafts[0].comment.slice(0, 40)}”)` : 'Title (optional)'}
        />
        <textarea
          className="input"
          rows={2}
          value={description}
          maxLength={10_000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Steps to reproduce, expected vs actual (optional)"
        />
        <div className="seg" role="radiogroup" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button key={p} role="radio" aria-checked={priority === p} className={`seg-btn ${priority === p ? `on tone-${PRIORITY_META[p].tone}` : ''}`} onClick={() => setPriority(p)}>
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
        <div className="checks">
          {(['console', 'network', 'actions'] as const).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={include[k]} onChange={(e) => setIncludeKey(k, e.target.checked)} />
              {k === 'console' ? 'Console' : k === 'network' ? 'Network' : 'User actions'}
            </label>
          ))}
        </div>
        <button className="btn btn-primary btn-block" disabled={saving || (state.drafts.length === 0 && !title.trim())} onClick={() => void submit()}>
          {saving ? <Spinner /> : <IconSend />}
          {saving ? 'Capturing…' : 'Capture & save report'}
        </button>
        <p className="muted small center-text">Captures the visible part of the page. Errors are always included.</p>
      </section>
    </div>
  );
};

const Counter = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
  <span className={`counter ${tone ? `tone-${tone}` : ''}`}>
    <b>{value}</b> {label}
  </span>
);

const DraftCard = ({ draft, tabId, onState }: { draft: Draft; tabId: number; onState: (s: TabState) => void }) => {
  const [comment, setComment] = useState(draft.comment);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setComment(draft.comment);
  }, [draft.comment]);

  const save = (patch: { comment?: string; category?: AnnotationCategory }) =>
    callBackground({ type: 'updateDraft', tabId, draftId: draft.id, patch })
      .then(onState)
      .catch((err) => toast(errorMessage(err), 'error'));

  const onComment = (v: string) => {
    setComment(v);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      void save({ comment: v });
    }, 400);
  };

  const meta = CATEGORY_META[draft.category];
  return (
    <li className="draft" style={{ ['--c' as string]: meta.color }}>
      <div className="draft-head">
        <button className="pin" title="Show on page" onClick={() => void callBackground({ type: 'focusDraft', tabId, draftId: draft.id }).catch(() => {})}>
          {draft.index}
        </button>
        <span className="draft-label" title={draft.element?.selector ?? draft.label}>
          {draft.label}
        </span>
        <select className="cat-select" value={draft.category} onChange={(e) => void save({ category: e.target.value as AnnotationCategory })} aria-label="Category">
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          aria-label="Delete annotation"
          onClick={() =>
            void callBackground({ type: 'removeDraft', tabId, draftId: draft.id })
              .then(onState)
              .catch((err) => toast(errorMessage(err), 'error'))
          }
        >
          <IconTrash />
        </button>
      </div>
      <textarea className="input draft-text" rows={2} value={comment} maxLength={5000} placeholder="Add a comment…" onChange={(e) => onComment(e.target.value)} />
      {draft.element?.components[0] && (
        <div className="draft-meta">
          {draft.element.components
            .slice(0, 3)
            .map((c) => c.name)
            .join(' ‹ ')}
        </div>
      )}
    </li>
  );
};
