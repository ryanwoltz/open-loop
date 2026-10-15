import type { ActionEntry, ConsoleEntry, ErrorEntry, NetworkEntry } from '@open-loop/shared';

/** Fixed-size FIFO: the oldest entry drops when full. */
export class Ring<T> {
  private items: T[] = [];
  constructor(private readonly cap: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  toArray(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/** Per-tab capture buffers. Consecutive identical console lines collapse into one with a count. */
export class CaptureBuffers {
  readonly console = new Ring<ConsoleEntry>(500);
  readonly network = new Ring<NetworkEntry>(300);
  readonly errors = new Ring<ErrorEntry>(200);
  readonly actions = new Ring<ActionEntry>(300);

  addConsole(entry: ConsoleEntry): void {
    const last = this.console.last();
    if (last && last.level === entry.level && last.message === entry.message) {
      last.count = (last.count ?? 1) + 1;
      last.at = entry.at;
      return;
    }
    this.console.push(entry);
  }

  addNetwork(entry: NetworkEntry): void {
    this.network.push(entry);
  }

  addError(entry: ErrorEntry): void {
    this.errors.push(entry);
  }

  addAction(entry: ActionEntry): void {
    const last = this.actions.last();
    // Scrolls arrive in bursts; keep the latest of a run.
    if (entry.type === 'scroll' && last?.type === 'scroll' && entry.at - last.at < 1500) {
      Object.assign(last, entry);
      return;
    }
    this.actions.push(entry);
  }

  counts() {
    const consoleEntries = this.console.toArray();
    const net = this.network.toArray();
    return {
      console: consoleEntries.length,
      consoleErrors: consoleEntries.filter((c) => c.level === 'error').length,
      network: net.length,
      failedRequests: net.filter((n) => !n.ok).length,
      errors: this.errors.size,
      actions: this.actions.size,
    };
  }
}
