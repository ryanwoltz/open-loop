import { Component, createContext, useCallback, useContext, useState, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '../lib/logger';
import { IconAlert, IconCheck } from './icons';

const log = createLogger('sidepanel');

// ---------- toasts ----------

type Tone = 'ok' | 'warn' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}
const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
    if (tone === 'error') log.warn(message);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'ok' ? <IconCheck /> : <IconAlert />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

// ---------- error boundary ----------

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('side panel crashed', { message: error.message, stack: error.stack, component: info.componentStack });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <IconAlert width={28} height={28} />
        <h2>Something went wrong</h2>
        <p className="muted">{this.state.error.message}</p>
        <p className="muted small">The error was written to Settings → Diagnostics.</p>
        <button className="btn btn-primary" onClick={() => this.setState({ error: undefined })}>
          Try again
        </button>
      </div>
    );
  }
}

// ---------- small primitives ----------

export const Badge = ({ tone, children }: { tone: string; children: ReactNode }) => <span className={`badge badge-${tone}`}>{children}</span>;

export const Switch = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
    <span className="knob" />
  </button>
);

export const Empty = ({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) => (
  <div className="empty">
    <div className="empty-icon">{icon}</div>
    <h3>{title}</h3>
    {children}
  </div>
);

export const Spinner = () => <span className="spinner" aria-label="Loading" />;

export const copyText = async (text: string): Promise<void> => {
  await navigator.clipboard.writeText(text);
};
