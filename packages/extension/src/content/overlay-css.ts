import { ACCENT } from '../lib/ui';

export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer {
  --accent: ${ACCENT};
  --surface: rgba(17, 17, 22, 0.94);
  --surface-2: rgba(255, 255, 255, 0.07);
  --border: rgba(255, 255, 255, 0.12);
  --text: #F4F4F6;
  --muted: #A1A1AA;
  position: fixed; inset: 0; pointer-events: none;
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; }
svg { width: 16px; height: 16px; flex: none; }

.hover {
  position: fixed; left: 0; top: 0; display: none;
  border: 2px solid var(--accent); border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  transition: transform 60ms ease-out, width 60ms ease-out, height 60ms ease-out;
}
.hover-label {
  position: fixed; left: 0; top: 0; display: none; max-width: 320px;
  padding: 3px 8px; border-radius: 6px; background: var(--accent); color: #fff;
  font: 500 11.5px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 4px 14px rgba(0,0,0,.25);
}
.hover-label b { font-weight: 700; margin-right: 4px; }
.drag {
  position: fixed; left: 0; top: 0; display: none;
  border: 2px dashed var(--accent); border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.mark .outline {
  position: fixed; left: 0; top: 0;
  border: 2px solid var(--c); border-radius: 4px;
  background: color-mix(in srgb, var(--c) 9%, transparent);
  box-shadow: 0 0 0 1px rgba(255,255,255,.6) inset;
}
.mark .pin {
  position: fixed; left: 0; top: 0; pointer-events: auto;
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--c); color: #fff; font-weight: 700; font-size: 12px;
  display: grid; place-items: center;
  border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,.35);
  transition: scale 120ms ease;
}
.mark .pin:hover { scale: 1.12; }

.toolbar {
  position: fixed; left: 50%; bottom: 20px; translate: -50% 0;
  display: none; align-items: center; gap: 4px;
  padding: 6px; border-radius: 14px;
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: 0 12px 40px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.2);
  backdrop-filter: blur(12px) saturate(1.4);
  pointer-events: auto;
}
.annotating .toolbar { display: flex; animation: rise 180ms cubic-bezier(.2,.9,.3,1.2); }
@keyframes rise { from { opacity: 0; translate: -50% 10px; } to { opacity: 1; translate: -50% 0; } }
.toolbar .brand {
  width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
  background: linear-gradient(135deg, #6E6ADE, #4C46C8); color: #fff;
}
.toolbar .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
.toolbar .tool {
  display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border-radius: 9px;
  color: var(--muted); font-weight: 500;
}
.toolbar .tool:hover { background: var(--surface-2); color: var(--text); }
.toolbar[data-tool="element"] .tool[data-tool="element"],
.toolbar[data-tool="region"] .tool[data-tool="region"] { background: rgba(255,255,255,.12); color: #fff; }
.toolbar .count { color: var(--muted); padding: 0 8px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.toolbar .save {
  display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 9px;
  background: var(--accent); color: #fff; font-weight: 600;
}
.toolbar .save:hover { filter: brightness(1.1); }
.toolbar .save:disabled { opacity: .45; cursor: default; filter: none; }
.toolbar .icon { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; color: var(--muted); }
.toolbar .icon:hover { background: var(--surface-2); color: #fff; }

.hint {
  position: fixed; left: 50%; bottom: 72px; translate: -50% 0; display: none;
  padding: 5px 10px; border-radius: 8px; background: rgba(17,17,22,.78); color: #E4E4E7;
  font-size: 12px; white-space: nowrap;
}
.annotating .hint { display: block; }

.editor {
  position: fixed; left: 0; top: 0; width: 320px; pointer-events: auto;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.4);
  backdrop-filter: blur(14px) saturate(1.4);
  padding: 12px; display: flex; flex-direction: column; gap: 10px;
  animation: pop 140ms ease-out;
}
@keyframes pop { from { opacity: 0; scale: .97; } to { opacity: 1; scale: 1; } }
.ed-title { font: 500 11.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-text {
  width: 100%; resize: vertical; min-height: 64px; max-height: 240px;
  padding: 9px 10px; border-radius: 9px; border: 1px solid var(--border);
  background: rgba(0,0,0,.25); color: var(--text); font: inherit; outline: none;
}
.ed-text:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent); }
.ed-text::placeholder { color: #71717A; }
.ed-cats { display: flex; flex-wrap: wrap; gap: 6px; }
.cat {
  height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 500;
  color: var(--muted); border: 1px solid var(--border);
  display: inline-flex; align-items: center; gap: 6px;
}
.cat::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.cat.on { color: #fff; border-color: var(--c); background: color-mix(in srgb, var(--c) 22%, transparent); }
.ed-foot { display: flex; justify-content: space-between; align-items: center; }
.ed-actions { display: flex; gap: 6px; }
.ghost { height: 30px; padding: 0 10px; border-radius: 8px; color: var(--muted); font-weight: 500; }
.ghost:hover { background: var(--surface-2); color: #fff; }
.ghost.danger:hover { color: #FF8589; }
.primary {
  height: 30px; padding: 0 12px; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600;
  display: inline-flex; align-items: center; gap: 8px;
}
.primary:hover { filter: brightness(1.1); }
kbd { font: 500 10.5px ui-monospace, monospace; opacity: .7; }

.toast {
  position: fixed; right: 20px; top: 20px; max-width: 360px;
  padding: 10px 14px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  box-shadow: 0 12px 40px rgba(0,0,0,.35);
  opacity: 0; translate: 0 -8px; transition: opacity 160ms, translate 160ms;
  border-left: 3px solid #30A46C;
}
.toast[data-tone="warn"] { border-left-color: #F5A524; }
.toast[data-tone="error"] { border-left-color: #E5484D; }
.toast.show { opacity: 1; translate: 0 0; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;
