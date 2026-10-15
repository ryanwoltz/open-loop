import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createLogger } from '../lib/logger';
import { App } from './App';
import { ErrorBoundary, ToastProvider } from './ui';
import './styles.css';

const log = createLogger('sidepanel');
window.addEventListener('error', (ev) => log.error('uncaught error', ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => log.error('unhandled rejection', ev.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
