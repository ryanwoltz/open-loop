import type { Rect } from '@open-loop/shared';

/** Scales a CSS-pixel viewport rect into screenshot pixels and clips it to the image. */
export const toImageRect = (r: Rect, scale: number, imgW: number, imgH: number): Rect | null => {
  const x1 = Math.max(0, r.x * scale);
  const y1 = Math.max(0, r.y * scale);
  const x2 = Math.min(imgW, (r.x + r.width) * scale);
  const y2 = Math.min(imgH, (r.y + r.height) * scale);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/** Crop region around an annotation: padded, clipped, and at least `min` px on each side. */
export const cropRect = (r: Rect, scale: number, imgW: number, imgH: number, pad = 32, min = 160): Rect | null => {
  const inner = toImageRect(r, scale, imgW, imgH);
  if (!inner) return null;
  const p = pad * scale;
  let x1 = inner.x - p;
  let y1 = inner.y - p;
  let x2 = inner.x + inner.width + p;
  let y2 = inner.y + inner.height + p;
  const minPx = min * scale;
  if (x2 - x1 < minPx) {
    const grow = (minPx - (x2 - x1)) / 2;
    x1 -= grow;
    x2 += grow;
  }
  if (y2 - y1 < minPx) {
    const grow = (minPx - (y2 - y1)) / 2;
    y1 -= grow;
    y2 += grow;
  }
  // Slide the window back inside the image before clipping, so a crop near an edge keeps its size.
  if (x1 < 0) [x1, x2] = [0, x2 - x1];
  if (x2 > imgW) [x1, x2] = [x1 - (x2 - imgW), imgW];
  if (y1 < 0) [y1, y2] = [0, y2 - y1];
  if (y2 > imgH) [y1, y2] = [y1 - (y2 - imgH), imgH];
  x1 = Math.max(0, Math.floor(x1));
  y1 = Math.max(0, Math.floor(y1));
  x2 = Math.min(imgW, Math.ceil(x2));
  y2 = Math.min(imgH, Math.ceil(y2));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/** Pin centre for an annotation: its top-left corner, kept fully inside the image. */
export const pinCenter = (r: Rect, radius: number, imgW: number, imgH: number): { x: number; y: number } => ({
  x: Math.min(Math.max(r.x, radius + 2), imgW - radius - 2),
  y: Math.min(Math.max(r.y, radius + 2), imgH - radius - 2),
});

/** Fit within maxEdge on the longest side, never upscaling. */
export const fitWithin = (w: number, h: number, maxEdge: number): { width: number; height: number } => {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
};
