import { useEffect, useState } from 'react';
import { createLogger, errorMessage } from '../lib/logger';
import { callBackground } from '../lib/rpc';
import { CaptureView } from './CaptureView';
import { IssuesView } from './IssuesView';
import { SettingsView } from './SettingsView';
import { useStatus } from './hooks';
import { IconInbox, IconLayers, IconLogo, IconSettings } from './icons';
import { ErrorBoundary, Switch, useToast } from './ui';

const log = createLogger('sidepanel');
type TabId = 'capture' | 'issues' | 'settings';
const TAB_KEY = 'ol:panelTab';

export const App = () => {
  const { status, refresh } = useStatus();
  const toast = useToast();
  const [tab, setTab] = useState<TabId>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as TabId | null) ?? 'capture';
    } catch {
      return 'capture';
    }
  });
  const [openReport, setOpenReport] = useState<string>();

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* storage blocked */
    }
  }, [tab]);

  const toggle = async (enabled: boolean) => {
    try {
      await callBackground({ type: 'setEnabled', enabled });
      refresh();
      toast(enabled ? 'Open Loop is on' : 'Open Loop is off — nothing is captured', enabled ? 'ok' : 'warn');
    } catch (err) {
      log.error('toggle failed', err);
      toast(errorMessage(err), 'error');
    }
  };

  const connected = status?.server.connected;
  const queued = status?.queue.filter((q) => !q.failed).length ?? 0;
  const pill = !status ? 'checking' : connected ? 'online' : 'offline';

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">
            <IconLogo width={15} height={15} />
          </span>
          <span className="brand-name">Open Loop</span>
        </div>
        <button
          className={`pill pill-${pill}`}
          title={connected ? `Connected to ${status?.server.store ?? 'server'}` : (status?.server.error ?? 'Checking…')}
          onClick={() => setTab('settings')}
        >
          <span className="dot" />
          {pill === 'checking' ? 'Checking' : connected ? 'Connected' : 'Offline'}
          {queued > 0 && <span className="pill-count">{queued} queued</span>}
        </button>
        <Switch checked={status?.enabled ?? true} onChange={(v) => void toggle(v)} label="Turn Open Loop on or off" />
      </header>

      <nav className="tabs" role="tablist">
        {(
          [
            ['capture', 'Capture', <IconLayers key="c" />],
            ['issues', 'Issues', <IconInbox key="i" />],
            ['settings', 'Settings', <IconSettings key="s" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => {
              setTab(id);
              if (id === 'issues') setOpenReport(undefined);
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>

      <main className="content">
        <ErrorBoundary key={tab}>
          {tab === 'capture' && (
            <CaptureView
              enabled={status?.enabled ?? true}
              onEnable={() => void toggle(true)}
              onOpenReport={(id) => {
                setOpenReport(id);
                setTab('issues');
              }}
            />
          )}
          {tab === 'issues' && <IssuesView openId={openReport} onOpen={setOpenReport} connected={!!connected} queue={status?.queue ?? []} />}
          {tab === 'settings' && <SettingsView status={status} onRefresh={refresh} />}
        </ErrorBoundary>
      </main>
    </div>
  );
};
