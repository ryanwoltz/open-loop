import { truncate } from '@open-loop/shared/core';
import { cropRect, fitWithin, pinCenter, toImageRect } from '../lib/geometry';
import type { PageSnapshot } from '../lib/types';
import { CATEGORY_META } from '../lib/ui';
import { createLogger } from '../lib/logger';

const log = createLogger('compose');

/** Claude reads images best at ≤ 1568 px on the long edge; previews are sized for agents. */
const PREVIEW_EDGE = 1568;

export interface ComposedImages {
  original: string;
  annotated: string;
  originalPreview: string;
  annotatedPreview: string;
  width: number;
  height: number;
  crops: Map<string, string>;
}

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${blob.type};base64,${btoa(binary)}`;
};

/** Decodes in place: fetch(data:) is blocked by the extension CSP's connect-src. */
const dataUrlToBlob = (dataUrl: string): Blob => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Screenshot is not a base64 data URL');
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const roundRect = (ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/** Draws outlines, numbered pins and comment labels the same way the in-page overlay shows them. */
const drawAnnotations = (ctx: OffscreenCanvasRenderingContext2D, snap: PageSnapshot, scale: number, w: number, h: number) => {
  const s = scale;
  for (const a of snap.annotations) {
    if (!a.inViewport) continue;
    const r = toImageRect(a.rect, s, w, h);
    if (!r) continue;
    const color = CATEGORY_META[a.category].color;

    ctx.save();
    ctx.fillStyle = `${color}1A`;
    roundRect(ctx, r.x, r.y, r.width, r.height, 4 * s);
    ctx.fill();
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  for (const a of snap.annotations) {
    if (!a.inViewport) continue;
    const r = toImageRect(a.rect, s, w, h);
    if (!r) continue;
    const color = CATEGORY_META[a.category].color;
    const radius = 13 * s;
    const c = pinCenter(r, radius, w, h);

    // Comment label beside the pin.
    const label = truncate(a.comment.replace(/\s+/g, ' ').trim() || CATEGORY_META[a.category].label, 60);
    ctx.font = `600 ${12 * s}px ${FONT}`;
    const tw = ctx.measureText(label).width;
    const lh = 22 * s;
    let lx = c.x + radius + 4 * s;
    const ly = c.y - lh / 2;
    if (lx + tw + 16 * s > w) lx = Math.max(0, c.x - radius - 4 * s - tw - 16 * s);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 6 * s;
    ctx.fillStyle = 'rgba(17,17,22,0.88)';
    roundRect(ctx, lx, ly, tw + 16 * s, lh, 6 * s);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 8 * s, c.y + 0.5 * s);

    // Pin.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6 * s;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${12 * s}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(a.index), c.x, c.y + 0.5 * s);
    ctx.textAlign = 'start';
  }
};

const encode = async (canvas: OffscreenCanvas, type: 'image/png' | 'image/jpeg', quality?: number) =>
  blobToDataUrl(await canvas.convertToBlob({ type, quality }));

const resized = (bitmap: ImageBitmap | OffscreenCanvas, w: number, h: number): OffscreenCanvas => {
  const size = fitWithin(w, h, PREVIEW_EDGE);
  const c = new OffscreenCanvas(size.width, size.height);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return c;
};

/** Builds the original/annotated pair, agent-sized previews and one crop per visible annotation. */
export const compose = async (screenshotDataUrl: string, snap: PageSnapshot): Promise<ComposedImages> => {
  const bitmap = await createImageBitmap(dataUrlToBlob(screenshotDataUrl));
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = w / snap.viewport.width;
  if (Math.abs(h / scale - snap.viewport.height) > 4) {
    // Page zoom or a resize between snapshot and capture: markers may be offset.
    log.warn('screenshot size does not match the page viewport', { image: [w, h], viewport: [snap.viewport.width, snap.viewport.height] });
  }

  const annotated = new OffscreenCanvas(w, h);
  const actx = annotated.getContext('2d');
  if (!actx) throw new Error('Canvas 2D context unavailable');
  actx.drawImage(bitmap, 0, 0);
  drawAnnotations(actx, snap, scale, w, h);

  const crops = new Map<string, string>();
  for (const a of snap.annotations) {
    if (!a.inViewport) continue;
    const r = cropRect(a.rect, scale, w, h);
    if (!r || r.width < 2 || r.height < 2) continue;
    const c = new OffscreenCanvas(r.width, r.height);
    c.getContext('2d')!.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    crops.set(a.id, await encode(c, 'image/png'));
  }

  const [annotatedPng, originalPreview, annotatedPreview] = await Promise.all([
    encode(annotated, 'image/png'),
    encode(resized(bitmap, w, h), 'image/jpeg', 0.86),
    encode(resized(annotated, w, h), 'image/jpeg', 0.86),
  ]);
  bitmap.close();

  return {
    original: screenshotDataUrl,
    annotated: annotatedPng,
    originalPreview,
    annotatedPreview,
    width: w,
    height: h,
    crops,
  };
};
