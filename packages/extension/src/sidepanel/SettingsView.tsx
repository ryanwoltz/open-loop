import { useEffect, useState } from 'react';
import { DEFAULT_SERVER_URL } from '@open-loop/shared/core';
import { type LogEntry, clearLogs, errorMessage, readLogs } from '../lib/logger';
import { saveSettings } from '../lib/settings';
import type { Settings } from '../lib/types';
import { clockTime } from './format';
import { type AppStatus, useSettings } from './hooks';
import { IconCopy, IconDownload, IconRefresh, IconTerminal } from './icons';
import { Switch, copyText, useToast } from './ui';

const MCP_COMMAND = 'claude mcp add open-loop -- node /path/to/open-loop/packages/server/dist/cli.js mcp';

export const SettingsView = ({ status, onRefresh }: { status?: AppStatus; onRefresh: () => void }) => {
  const settings = useSettings();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>();
  const [level, setLevel] = useState<'all' | 'warn'>('all');

  useEffect(() => {
    if (settings) setUrl(settings.serverUrl);
  }, [settings?.serverUrl]);

  const loadLogs = () => void readLogs().then(setLogs).catch((err) => toast(errorMessage(err), 'error'));
  useEffect(loadLogs, []);

  if (!settings) return null;

  const update = async (patch: Partial<Settings>, message = 'Saved') => {
    try {
      await saveSettings(patch);
      toast(message);
      onRefresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const shown = (logs ?? []).filter((l) => level === 'all' || l.level === 'warn' || l.level === 'error').slice(-200).reverse();

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify({ version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), logs }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `open-loop-diagnostics-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>Server</h3>
        <p className="muted small">Reports are saved by the local Open Loop server, which your agent reads over MCP.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void update({ serverUrl: url }, 'Server URL saved');
          }}
        >
          <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_SERVER_URL} />
          <button className="btn btn-sm" type="submit" disabled={url === settings.serverUrl}>
            Save
          </button>
        </form>
        <div className={`status-line ${status?.server.connected ? 'tone-green' : 'tone-red'}`}>
          <span className="dot" />
          {status?.server.connected ? `Connected · v${status.server.version}` : (status?.server.error ?? 'Checking…')}
          <button className="icon-btn" aria-label="Check again" onClick={onRefresh}>
            <IconRefresh />
          </button>
        </div>
        {status?.server.store && <p className="muted small mono">Data: {status.server.store}</p>}
      </section>

      <section className="card">
        <h3>
          <IconTerminal /> Connect your agent
        </h3>
        <p className="muted small">Add the MCP server to Claude Code (it also serves the extension API while your agent runs):</p>
        <pre className="code">{MCP_COMMAND}</pre>
        <button className="btn btn-sm" onClick={() => void copyText(MCP_COMMAND).then(() => toast('Copied'))}>
          <IconCopy /> Copy
        </button>
        <p className="muted small">
          Or run <code>open-loop serve</code> to keep the API up on its own. Tools: list_reports, get_report, get_screenshot, get_annotation_crop, get_logs,
          update_annotation_status, update_report_status, add_note.
        </p>
      </section>

      <section className="card">
        <h3>Capture</h3>
        {(
          [
            ['captureConsole', 'Console output', 'log, info, warn, error, debug'],
            ['captureNetwork', 'Network requests', 'fetch and XHR: method, URL, status, timing'],
            ['captureFailedBodies', 'Bodies of failed requests', 'redacted: passwords, tokens and card fields are masked'],
            ['captureActions', 'User actions', 'clicks, navigation, typing (never the text typed)'],
          ] as const
        ).map(([key, label, hint]) => (
          <div key={key} className="setting">
            <div>
              <div>{label}</div>
              <div className="muted small">{hint}</div>
            </div>
            <Switch checked={settings[key]} onChange={(v) => void update({ [key]: v } as Partial<Settings>)} label={label} />
          </div>
        ))}
        <p className="muted small">Uncaught errors are always recorded. Query-string secrets are redacted from every URL.</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h3>Diagnostics</h3>
          <span className="row gap-sm">
            <select className="mini-select" value={level} onChange={(e) => setLevel(e.target.value as 'all' | 'warn')} aria-label="Log level">
              <option value="all">All</option>
              <option value="warn">Warnings+</option>
            </select>
            <button className="icon-btn" aria-label="Reload logs" onClick={loadLogs}>
              <IconRefresh />
            </button>
            <button className="icon-btn" aria-label="Export logs" onClick={exportLogs}>
              <IconDownload />
            </button>
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="muted small">No log entries.</p>
        ) : (
          <ul className="logs logs-tall">
            {shown.map((l, i) => (
              <li key={i} className={`log log-${l.level}`} title={l.data}>
                <span className="log-time">{clockTime(l.at)}</span>
                <span className="log-msg">
                  <b>{l.scope}</b> {l.message}
                  {l.data ? <span className="muted"> {l.data.slice(0, 160)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          className="link danger"
          onClick={() =>
            void clearLogs()
              .then(loadLogs)
              .then(() => toast('Logs cleared'))
          }
        >
          Clear logs
        </button>
      </section>

      <p className="muted small center-text">Open Loop v{chrome.runtime.getManifest().version}</p>
    </div>
  );
};
