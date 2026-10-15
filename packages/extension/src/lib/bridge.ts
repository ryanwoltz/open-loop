import type { ActionEntry, ComponentFrame, ConsoleEntry, ErrorEntry, NetworkEntry } from '@open-loop/shared';

/**
 * window.postMessage protocol between the MAIN-world hooks (which can see the
 * page's console, fetch and framework internals) and the isolated content
 * script (which can talk to the extension).
 */
export const BRIDGE = '__open_loop_bridge_v1';
/** Attribute the content script sets on an element so the main world can find it. */
export const PROBE_ATTR = 'data-open-loop-probe';

export type MainToContent =
  | { bridge: typeof BRIDGE; dir: 'up'; kind: 'console'; entry: ConsoleEntry }
  | { bridge: typeof BRIDGE; dir: 'up'; kind: 'network'; entry: NetworkEntry }
  | { bridge: typeof BRIDGE; dir: 'up'; kind: 'error'; entry: ErrorEntry }
  | { bridge: typeof BRIDGE; dir: 'up'; kind: 'action'; entry: ActionEntry }
  | { bridge: typeof BRIDGE; dir: 'up'; kind: 'components'; nonce: string; components: ComponentFrame[] }
  | { bridge: typeof BRIDGE; dir: 'up'; kind: 'ready' };

export type ContentToMain =
  | {
      bridge: typeof BRIDGE;
      dir: 'down';
      kind: 'config';
      enabled: boolean;
      console: boolean;
      network: boolean;
      failedBodies: boolean;
    }
  | { bridge: typeof BRIDGE; dir: 'down'; kind: 'probe'; nonce: string };

export const isBridgeMessage = (data: unknown, dir: 'up' | 'down'): boolean =>
  typeof data === 'object' &&
  data !== null &&
  (data as { bridge?: unknown }).bridge === BRIDGE &&
  (data as { dir?: unknown }).dir === dir;
