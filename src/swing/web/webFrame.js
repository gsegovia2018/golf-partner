// One decoded frame in DISPLAY orientation at the kept size (the web's YuvFrame): the decoder's
// image drawn rotated onto a canvas, then read back only where the analysis looks. Grey is the
// BT.601 luma of the browser's RGB, i.e. the lab's `cv2.cvtColor(BGR2GRAY)` (Android reads the Y
// plane, which is the same value up to rounding).

import { Gray } from './core/geom';

/** Long side above which frames are kept at half size (4K → 1080p class): memory and time. */
export const DECIMATE_ABOVE = 1920;

/** 1, or 2 for frames whose long side is over DECIMATE_ABOVE (Media.decimation). */
export const decimation = (w, h) => (Math.max(w, h) > DECIMATE_ABOVE ? 2 : 1);

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function context2d(canvas, read) {
  return canvas.getContext('2d', read ? { willReadFrequently: true } : undefined);
}

/**
 * Draws a coded-orientation image rotated by `rotation` (0/90/180/270, clockwise for display)
 * into `ctx` at `outW` × `outH` (display orientation). `src` is a rectangle of the DISPLAY image at
 * that scale to show from (default: all of it).
 */
export function drawRotated(ctx, image, codedW, codedH, rotation, outW, outH, smooth = true) {
  const swap = rotation === 90 || rotation === 270;
  const dw = swap ? outH : outW; // the coded image's size once scaled
  const dh = swap ? outW : outH;
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = 'high';
  if (rotation === 90) { ctx.translate(outW, 0); ctx.rotate(Math.PI / 2); }
  else if (rotation === 180) { ctx.translate(outW, outH); ctx.rotate(Math.PI); }
  else if (rotation === 270) { ctx.translate(0, outH); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(image, 0, 0, codedW, codedH, 0, 0, dw, dh);
  ctx.restore();
}

/** Luma (0–255, rounded) of RGBA pixels into a Uint8Array. */
export function lumaOf(rgba, n) {
  const out = new Uint8Array(n);
  for (let i = 0, k = 0; i < n; i += 1, k += 4) {
    out[i] = (rgba[k] * 299 + rgba[k + 1] * 587 + rgba[k + 2] * 114 + 500) / 1000;
  }
  return out;
}

/**
 * Wraps one decoded image. `width`/`height` are the kept frame's display size (decimated);
 * `codedW`/`codedH` the image's own size. The full-size canvas is drawn lazily, once.
 */
export class WebFrame {
  constructor(decoded, track) {
    this.frame = decoded.frame;
    this.ptsUs = decoded.ptsUs;
    this.image = decoded.image;
    // a <video> element applies the container rotation itself
    this.rotation = decoded.element ? 0 : track.rotation;
    this.codedW = decoded.width || track.codedWidth;
    this.codedH = decoded.height || track.codedHeight;
    const swap = this.rotation === 90 || this.rotation === 270;
    const fullW = swap ? this.codedH : this.codedW;
    const fullH = swap ? this.codedW : this.codedH;
    const d = decimation(fullW, fullH);
    this.dispW = Math.trunc(fullW / d);
    this.dispH = Math.trunc(fullH / d);
    this.canvas = null;
  }

  /** The frame at its kept size, display orientation (drawn once). */
  full() {
    if (!this.canvas) {
      this.canvas = makeCanvas(this.dispW, this.dispH);
      drawRotated(context2d(this.canvas, true), this.image, this.codedW, this.codedH, this.rotation, this.dispW, this.dispH);
    }
    return this.canvas;
  }

  /** Grey of the frame-px rectangle [x0, x1) × [y0, y1), clamped to the frame (row-major, w × h). */
  grayRegion(x0, y0, x1, y1) {
    const cx0 = Math.max(0, Math.min(this.dispW - 1, x0));
    const cy0 = Math.max(0, Math.min(this.dispH - 1, y0));
    const cx1 = Math.max(cx0 + 1, Math.min(this.dispW, x1));
    const cy1 = Math.max(cy0 + 1, Math.min(this.dispH, y1));
    const w = cx1 - cx0;
    const h = cy1 - cy0;
    const data = context2d(this.full(), true).getImageData(cx0, cy0, w, h).data;
    return {
      x0: cx0, y0: cy0, w, h, px: lumaOf(data, w * h),
    };
  }

  /**
   * Grey patch of the working image over `r` (work px, a Rect). `step` = frame px per work px: 2
   * averages 2 × 2 pixels with rounding (cv2.resize INTER_AREA at an exact factor 2), 1 is the
   * pixel itself. Coordinates past the frame clamp to its edge (YuvFrame.grayStrip).
   */
  grayStrip(r, step) {
    const reg = this.grayRegion(r.x0 * step, r.y0 * step, r.x1 * step + 1, r.y1 * step + 1);
    const at = (dx, dy) => {
      const x = Math.min(Math.max(dx, reg.x0), reg.x0 + reg.w - 1) - reg.x0;
      const y = Math.min(Math.max(dy, reg.y0), reg.y0 + reg.h - 1) - reg.y0;
      return reg.px[y * reg.w + x];
    };
    const out = new Uint8Array(Math.max(0, r.w * r.h));
    let k = 0;
    for (let wy = r.y0; wy < r.y1; wy += 1) {
      for (let wx = r.x0; wx < r.x1; wx += 1) {
        if (step === 2) {
          const dx = Math.min(2 * wx, this.dispW - 2);
          const dy = Math.min(2 * wy, this.dispH - 2);
          out[k] = (at(dx, dy) + at(dx + 1, dy) + at(dx, dy + 1) + at(dx + 1, dy + 1) + 2) >> 2;
        } else {
          out[k] = at(Math.min(wx, this.dispW - 1), Math.min(wy, this.dispH - 1));
        }
        k += 1;
      }
    }
    return new Gray(r.x0, r.y0, r.w, r.h, out);
  }

  /** Grey of every `step`-th pixel of `r` (frame px), as `Gray(0, 0, nx, ny)` (YuvFrame.graySampled). */
  graySampled(r, step) {
    const nx = Math.trunc((r.w + step - 1) / step);
    const ny = Math.trunc((r.h + step - 1) / step);
    const reg = this.grayRegion(r.x0, r.y0, r.x1, r.y1);
    const out = new Uint8Array(nx * ny);
    let k = 0;
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = Math.min(Math.min(r.x0 + i * step, this.dispW - 1), reg.x0 + reg.w - 1) - reg.x0;
        const y = Math.min(Math.min(r.y0 + j * step, this.dispH - 1), reg.y0 + reg.h - 1) - reg.y0;
        out[k] = reg.px[Math.max(0, y) * reg.w + Math.max(0, x)];
        k += 1;
      }
    }
    return new Gray(0, 0, nx, ny, out);
  }

  /** The frame drawn at `outW` × `outH` (display orientation) onto `canvas` (reused by the caller). */
  drawTo(canvas, outW, outH, smooth = true) {
    if (canvas.width !== outW) canvas.width = outW;
    if (canvas.height !== outH) canvas.height = outH;
    drawRotated(context2d(canvas, false), this.image, this.codedW, this.codedH, this.rotation, outW, outH, smooth);
    return canvas;
  }

  /** RGB bytes (3 per pixel, packed rows) of the frame stretched to `w` × `h` (the club detector's input). */
  rgb(w, h, scratch) {
    const c = scratch ?? makeCanvas(w, h);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = context2d(c, true);
    drawRotated(ctx, this.image, this.codedW, this.codedH, this.rotation, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h * 3);
    for (let i = 0, k = 0; i < w * h; i += 1, k += 4) {
      out[3 * i] = d[k];
      out[3 * i + 1] = d[k + 1];
      out[3 * i + 2] = d[k + 2];
    }
    return out;
  }

  /** Quarter-size grey for the duplicate-frame check (mean of each 4 × 4 block, Media.quarterGray). */
  quarterGray(scratch) {
    const w = Math.max(1, Math.trunc(this.dispW / 4));
    const h = Math.max(1, Math.trunc(this.dispH / 4));
    const c = scratch ?? makeCanvas(w, h);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = context2d(c, true);
    drawRotated(ctx, this.image, this.codedW, this.codedH, this.rotation, w, h);
    return lumaOf(ctx.getImageData(0, 0, w, h).data, w * h);
  }
}

/** JPEG of a canvas (OffscreenCanvas or <canvas>) at quality 0–1. */
export async function canvasJpeg(canvas, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality);
  });
}
