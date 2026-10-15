import type { AnnotationCategory, Rect } from '@open-loop/shared';
import { truncate } from '@open-loop/shared/core';
import type { Draft } from '../lib/types';
import { ACCENT, CATEGORY_META, CATEGORY_ORDER } from '../lib/ui';
import { elementAt, shortLabel } from './dom';
import { OVERLAY_CSS } from './overlay-css';

export type Tool = 'element' | 'region';

export interface PendingAnnotation {
  kind: 'element' | 'region';
  element?: Element;
  /** Region: viewport rect at creation. */
  rect?: Rect;
}

export interface OverlayHost {
  /** Current viewport rect of a draft, or null when it can't be located. */
  rectOf(draft: Draft): Rect | null;
  componentName(el: Element): Promise<string | undefined>;
  create(pending: PendingAnnotation, comment: string, category: AnnotationCategory): void;
  update(id: string, patch: { comment?: string; category?: AnnotationCategory }): void;
  remove(id: string): void;
  modeChanged(mode: Tool | false): void;
  submit(): void;
}

const DRAG_THRESHOLD = 6;
const ICON = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M17.6 6.4a8 8 0 1 0 2.3 6.1"/><path d="M20 4v4.5h-4.5"/></svg>',
  element: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7 17 2.5-7.5L21 11z"/></svg>',
  region: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 3"><rect x="3.5" y="5" width="17" height="14" rx="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
};

const place = (node: HTMLElement, r: Rect): void => {
  node.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
  node.style.width = `${Math.max(0, Math.round(r.width))}px`;
  node.style.height = `${Math.max(0, Math.round(r.height))}px`;
};

interface EditorState {
  draftId?: string;
  pending?: PendingAnnotation;
  anchor: Rect;
  category: AnnotationCategory;
}

/**
 * The in-page annotation layer. Lives in a closed-off shadow root under one
 * host element so page CSS can't restyle it and its CSS can't leak out.
 * While a tool is active it intercepts pointer events in the capture phase,
 * so clicks annotate instead of activating the page.
 */
export class Overlay {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly layer: HTMLDivElement;
  private readonly hoverBox: HTMLDivElement;
  private readonly hoverLabel: HTMLDivElement;
  private readonly dragBox: HTMLDivElement;
  private readonly pinsLayer: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly cursorStyle: HTMLStyleElement;
  private mode: Tool | false = false;
  private drafts: Draft[] = [];
  private hovered: Element | null = null;
  private childTrail: Element[] = [];
  private drag: { x: number; y: number; active: boolean } | null = null;
  private editor: { node: HTMLDivElement; state: EditorState } | null = null;
  private hidden = false;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverSeq = 0;

  constructor(private readonly hostApi: OverlayHost) {
    this.host = document.createElement('open-loop-overlay');
    this.host.setAttribute(
      'style',
      'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;',
    );
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = OVERLAY_CSS;
    this.layer = el('div', 'layer');
    this.hoverBox = el('div', 'hover');
    this.hoverLabel = el('div', 'hover-label');
    this.dragBox = el('div', 'drag');
    this.pinsLayer = el('div', 'pins');
    this.hint = el('div', 'hint');
    this.toastEl = el('div', 'toast');
    this.toolbar = this.buildToolbar();
    this.layer.append(this.pinsLayer, this.hoverBox, this.hoverLabel, this.dragBox, this.hint, this.toolbar, this.toastEl);
    this.root.append(style, this.layer);
    this.cursorStyle = el('style');
    this.cursorStyle.textContent = 'html, html * { cursor: crosshair !important; user-select: none !important; }';
  }

  mount(): void {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  get active(): Tool | false {
    return this.mode;
  }

  // ---------- public API ----------

  start(tool: Tool): void {
    this.mount();
    const was = this.mode;
    this.mode = tool;
    this.layer.classList.add('annotating');
    this.toolbar.dataset.tool = tool;
    this.hint.textContent =
      tool === 'element' ? 'Click an element to comment · drag to mark an area · ↑ selects the parent · Esc to finish' : 'Drag to mark an area · Esc to finish';
    if (!was) {
      window.addEventListener('pointermove', this.onPointerMove, true);
      window.addEventListener('pointerdown', this.onPointerDown, true);
      window.addEventListener('pointerup', this.onPointerUp, true);
      for (const t of ['click', 'mousedown', 'mouseup', 'dblclick', 'auxclick'] as const) window.addEventListener(t, this.swallow, true);
      window.addEventListener('keydown', this.onKeyDown, true);
      (document.head ?? document.documentElement).append(this.cursorStyle);
    }
    this.startTicker();
    this.hostApi.modeChanged(tool);
  }

  stop(): void {
    if (!this.mode) return;
    this.mode = false;
    this.closeEditor(false);
    this.layer.classList.remove('annotating');
    this.hoverBox.style.display = 'none';
    this.hoverLabel.style.display = 'none';
    this.dragBox.style.display = 'none';
    this.hovered = null;
    this.drag = null;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    for (const t of ['click', 'mousedown', 'mouseup', 'dblclick', 'auxclick'] as const) window.removeEventListener(t, this.swallow, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.cursorStyle.remove();
    if (this.drafts.length === 0) this.stopTicker();
    this.hostApi.modeChanged(false);
  }

  setDrafts(drafts: Draft[]): void {
    this.drafts = drafts;
    if (drafts.length > 0) {
      this.mount();
      this.startTicker();
    } else if (!this.mode) {
      this.stopTicker();
    }
    const count = this.toolbar.querySelector('.count');
    if (count) count.textContent = `${drafts.length} ${drafts.length === 1 ? 'note' : 'notes'}`;
    this.toolbar.querySelector<HTMLButtonElement>('.save')!.disabled = drafts.length === 0;
    this.renderPins();
  }

  /** Hide everything for a clean screenshot. */
  hide(): void {
    this.hidden = true;
    this.host.style.setProperty('display', 'none', 'important');
    this.cursorStyle.remove();
  }

  show(): void {
    this.hidden = false;
    this.host.style.setProperty('display', 'block', 'important');
    if (this.mode) (document.head ?? document.documentElement).append(this.cursorStyle);
    this.renderPins();
  }

  focusDraft(id: string): void {
    const d = this.drafts.find((x) => x.id === id);
    if (!d) return;
    const r = this.hostApi.rectOf(d);
    if (r && (r.y < 0 || r.y + r.height > window.innerHeight)) {
      window.scrollBy({ top: r.y - window.innerHeight / 3, behavior: 'instant' as ScrollBehavior });
    }
    requestAnimationFrame(() => {
      const now = this.hostApi.rectOf(d);
      if (now) this.openEditor({ draftId: d.id, anchor: now, category: d.category }, d.comment);
    });
  }

  toast(message: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
    this.mount();
    this.toastEl.textContent = message;
    this.toastEl.dataset.tone = tone;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 3800);
  }

  destroy(): void {
    this.stop();
    this.stopTicker();
    this.cursorStyle.remove();
    this.host.remove();
  }

  // ---------- rendering ----------

  private buildToolbar(): HTMLDivElement {
    const bar = el('div', 'toolbar');
    bar.innerHTML = `
      <span class="brand" title="Open Loop">${ICON.logo}</span>
      <span class="sep"></span>
      <button class="tool" data-tool="element" title="Select element (E)">${ICON.element}<span>Element</span></button>
      <button class="tool" data-tool="region" title="Draw region (R)">${ICON.region}<span>Region</span></button>
      <span class="sep"></span>
      <span class="count">0 notes</span>
      <button class="save" disabled title="Capture and save report">${ICON.send}<span>Save report</span></button>
      <button class="icon close" title="Done (Esc)">${ICON.close}</button>`;
    bar.addEventListener('click', (ev) => {
      const btn = (ev.target as Element).closest('button');
      if (!btn) return;
      if (btn.classList.contains('tool')) this.start(btn.dataset.tool as Tool);
      else if (btn.classList.contains('save')) this.hostApi.submit();
      else if (btn.classList.contains('close')) this.stop();
    });
    return bar;
  }

  private renderPins(): void {
    if (this.hidden) return;
    const existing = new Map([...this.pinsLayer.children].map((n) => [(n as HTMLElement).dataset.id!, n as HTMLElement]));
    for (const d of this.drafts) {
      let group = existing.get(d.id);
      existing.delete(d.id);
      if (!group) {
        group = el('div', 'mark');
        group.dataset.id = d.id;
        const outline = el('div', 'outline');
        const pin = el('button', 'pin');
        pin.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const r = this.hostApi.rectOf(d);
          const current = this.drafts.find((x) => x.id === d.id);
          if (r && current) this.openEditor({ draftId: current.id, anchor: r, category: current.category }, current.comment);
        });
        group.append(outline, pin);
        this.pinsLayer.append(group);
      }
      const color = CATEGORY_META[d.category].color;
      group.style.setProperty('--c', color);
      const pin = group.querySelector<HTMLButtonElement>('.pin')!;
      pin.textContent = String(d.index);
      pin.title = truncate(d.comment || '(no comment)', 140);
      const r = this.hostApi.rectOf(d);
      group.style.display = r ? 'block' : 'none';
      if (r) {
        place(group.querySelector<HTMLDivElement>('.outline')!, r);
        const px = Math.min(Math.max(r.x - 11, 4), window.innerWidth - 28);
        const py = Math.min(Math.max(r.y - 11, 4), window.innerHeight - 28);
        pin.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
      }
    }
    for (const stale of existing.values()) stale.remove();
    if (this.editor) {
      const id = this.editor.state.draftId;
      const d = id ? this.drafts.find((x) => x.id === id) : undefined;
      if (id && !d) this.closeEditor(false);
      else if (d) {
        const r = this.hostApi.rectOf(d);
        if (r) this.positionEditor(this.editor.node, r);
      }
    }
  }

  private startTicker(): void {
    if (this.ticker) return;
    window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    this.ticker = setInterval(() => this.renderPins(), 500);
  }

  private stopTicker(): void {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = undefined;
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
  }

  private rafPending = false;
  private readonly onViewportChange = (): void => {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderPins();
      if (this.hovered) this.paintHover(this.hovered);
    });
  };

  private paintHover(target: Element): void {
    const r = target.getBoundingClientRect();
    this.hoverBox.style.display = 'block';
    place(this.hoverBox, r);
    const seq = ++this.hoverSeq;
    const base = `${shortLabel(target)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    this.hoverLabel.textContent = base;
    this.hoverLabel.style.display = 'block';
    const ly = r.y > 26 ? r.y - 24 : Math.min(r.y + r.height + 4, window.innerHeight - 24);
    const lx = Math.min(Math.max(r.x, 4), Math.max(4, window.innerWidth - 320));
    this.hoverLabel.style.transform = `translate(${Math.round(lx)}px, ${Math.round(ly)}px)`;
    void this.hostApi.componentName(target).then((name) => {
      if (name && seq === this.hoverSeq && this.hovered === target) this.hoverLabel.innerHTML = `<b>${escapeHtml(name)}</b> ${escapeHtml(base)}`;
    });
  }

  // ---------- editor popover ----------

  private openEditor(state: EditorState, comment = ''): void {
    this.closeEditor(false);
    const node = el('div', 'editor');
    const draft = state.draftId ? this.drafts.find((d) => d.id === state.draftId) : undefined;
    const title = draft
      ? `#${draft.index} · ${escapeHtml(draft.label)}`
      : state.pending?.element
        ? `New · ${escapeHtml(shortLabel(state.pending.element))}`
        : 'New · region';
    node.innerHTML = `
      <div class="ed-head"><span class="ed-title">${title}</span></div>
      <textarea class="ed-text" rows="3" maxlength="5000" placeholder="What should change here?"></textarea>
      <div class="ed-cats">${CATEGORY_ORDER.map(
        (c) => `<button class="cat" data-cat="${c}" style="--c:${CATEGORY_META[c].color}">${CATEGORY_META[c].label}</button>`,
      ).join('')}</div>
      <div class="ed-foot">
        ${draft ? '<button class="ghost danger del">Delete</button>' : '<span></span>'}
        <span class="ed-actions"><button class="ghost cancel">Cancel</button><button class="primary ok">${draft ? 'Update' : 'Add note'}<kbd>⌘↵</kbd></button></span>
      </div>`;
    const text = node.querySelector<HTMLTextAreaElement>('.ed-text')!;
    text.value = comment;
    const setCat = (c: AnnotationCategory) => {
      state.category = c;
      for (const b of node.querySelectorAll<HTMLButtonElement>('.cat')) b.classList.toggle('on', b.dataset.cat === c);
    };
    setCat(state.category);
    node.addEventListener('click', (ev) => {
      const b = (ev.target as Element).closest('button');
      if (!b) return;
      if (b.classList.contains('cat')) setCat(b.dataset.cat as AnnotationCategory);
      else if (b.classList.contains('ok')) this.commitEditor();
      else if (b.classList.contains('cancel')) this.closeEditor(false);
      else if (b.classList.contains('del') && state.draftId) {
        this.hostApi.remove(state.draftId);
        this.closeEditor(false);
      }
    });
    node.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeEditor(false);
      } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        this.commitEditor();
      }
    });
    // Keep the page from reacting to typing inside the popover.
    for (const t of ['keyup', 'keypress', 'input'] as const) node.addEventListener(t, (ev) => ev.stopPropagation());
    this.layer.append(node);
    this.editor = { node, state };
    this.positionEditor(node, state.anchor);
    this.hoverBox.style.display = 'none';
    this.hoverLabel.style.display = 'none';
    setTimeout(() => text.focus({ preventScroll: true }), 0);
  }

  private positionEditor(node: HTMLDivElement, anchor: Rect): void {
    const w = 320;
    const h = node.offsetHeight || 190;
    const gap = 10;
    let x = anchor.x;
    let y = anchor.y + anchor.height + gap;
    if (y + h > window.innerHeight - 70) y = anchor.y - h - gap;
    if (y < 8) y = Math.min(Math.max(8, anchor.y + 8), window.innerHeight - h - 70);
    x = Math.min(Math.max(8, x), window.innerWidth - w - 8);
    node.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, y))}px)`;
  }

  private commitEditor(): void {
    if (!this.editor) return;
    const { node, state } = this.editor;
    const comment = node.querySelector<HTMLTextAreaElement>('.ed-text')!.value.trim();
    if (state.draftId) {
      this.hostApi.update(state.draftId, { comment, category: state.category });
    } else if (state.pending) {
      this.hostApi.create(state.pending, comment, state.category);
    }
    this.closeEditor(true);
  }

  /** Clicking away saves a non-empty comment and drops an empty new one. */
  private closeEditor(committed: boolean): void {
    if (!this.editor) return;
    const { node } = this.editor;
    this.editor = null;
    node.remove();
    void committed;
  }

  private dismissEditorByClickAway(): void {
    if (!this.editor) return;
    const comment = this.editor.node.querySelector<HTMLTextAreaElement>('.ed-text')!.value.trim();
    if (comment || this.editor.state.draftId) this.commitEditor();
    else this.closeEditor(false);
  }

  // ---------- input handling (capture phase, page never sees these while annotating) ----------

  private fromOverlay(ev: Event): boolean {
    return ev.composedPath().includes(this.host);
  }

  private readonly swallow = (ev: Event): void => {
    if (this.fromOverlay(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (this.fromOverlay(ev) && !this.drag) return;
    if (this.drag) {
      const dx = ev.clientX - this.drag.x;
      const dy = ev.clientY - this.drag.y;
      if (!this.drag.active && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.drag.active = true;
        this.hoverBox.style.display = 'none';
        this.hoverLabel.style.display = 'none';
      }
      if (this.drag.active) {
        this.dragBox.style.display = 'block';
        place(this.dragBox, normRect(this.drag.x, this.drag.y, ev.clientX, ev.clientY));
      }
      return;
    }
    if (this.mode !== 'element' || this.editor) return;
    const target = elementAt(ev.clientX, ev.clientY, this.host);
    if (target && target !== this.hovered) {
      this.hovered = target;
      this.childTrail = [];
      this.paintHover(target);
    }
  };

  private readonly onPointerDown = (ev: PointerEvent): void => {
    if (this.fromOverlay(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.button !== 0) return;
    if (this.editor) {
      this.dismissEditorByClickAway();
      return;
    }
    this.drag = { x: ev.clientX, y: ev.clientY, active: false };
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    const drag = this.drag;
    this.drag = null;
    this.dragBox.style.display = 'none';
    if (!drag) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (drag.active) {
      const rect = normRect(drag.x, drag.y, ev.clientX, ev.clientY);
      if (rect.width >= DRAG_THRESHOLD && rect.height >= DRAG_THRESHOLD) {
        this.openEditor({ pending: { kind: 'region', rect }, anchor: rect, category: 'bug' });
      }
      return;
    }
    if (this.mode === 'element') {
      const target = this.hovered ?? elementAt(ev.clientX, ev.clientY, this.host);
      if (target) {
        this.openEditor({ pending: { kind: 'element', element: target }, anchor: target.getBoundingClientRect(), category: 'bug' });
      }
    }
  };

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (this.fromOverlay(ev)) return;
    const k = ev.key;
    const handled = (): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    if (k === 'Escape') {
      handled();
      if (this.editor) this.closeEditor(false);
      else this.stop();
    } else if (ev.metaKey || ev.ctrlKey || ev.altKey) {
      return;
    } else if (k === 'e' || k === 'E') {
      handled();
      this.start('element');
    } else if (k === 'r' || k === 'R') {
      handled();
      this.start('region');
    } else if (k === 'ArrowUp' && this.hovered && this.mode === 'element') {
      handled();
      const parent = this.hovered.parentElement ?? (this.hovered.getRootNode() as ShadowRoot).host ?? null;
      if (parent && parent !== document.documentElement) {
        this.childTrail.push(this.hovered);
        this.hovered = parent;
        this.paintHover(parent);
      }
    } else if (k === 'ArrowDown' && this.childTrail.length > 0 && this.mode === 'element') {
      handled();
      this.hovered = this.childTrail.pop()!;
      this.paintHover(this.hovered);
    } else if (k === 'Enter' && this.hovered && this.mode === 'element' && !this.editor) {
      handled();
      this.openEditor({ pending: { kind: 'element', element: this.hovered }, anchor: this.hovered.getBoundingClientRect(), category: 'bug' });
    }
  };
}

const normRect = (x1: number, y1: number, x2: number, y2: number): Rect => ({
  x: Math.min(x1, x2),
  y: Math.min(y1, y2),
  width: Math.abs(x2 - x1),
  height: Math.abs(y2 - y1),
});

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export { ACCENT };
