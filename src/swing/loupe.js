// The drag loupe of Edit marks (plan D20): a circular magnifier that shows the still around the
// mark being moved, so the fingertip never hides what it is placing. Pure geometry, no React.
//
// Coordinates. The touch layer sits exactly on the picture, so a touch is in "rect px":
// (0, 0) is the picture's top-left corner and (rect.w, rect.h) its bottom-right, with any
// letterbox bars already outside it (SwingOverlay's `fitRect`). A mark is normalised (0-1 of
// the decoded frame), the same unit the draft stores; view px = norm * rect size is the
// conversion the screen already uses for hit testing and dragging.

export const LOUPE_SIZE = 120; // diameter, px
export const LOUPE_ZOOM = 3;
export const LOUPE_OFFSET = 80; // finger to loupe centre, px: clear of the fingertip
export const LOUPE_FLASH_MS = 600; // an arrow nudge keeps the loupe up this long

// 'worklet': the loupe is placed on the UI thread while dragging (DragLoupe), never through React.
function clamp(v, lo, hi) {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Where the loupe sits, as its top-left corner inside the picture (rect px).
 * Above the finger by LOUPE_OFFSET; if that would poke out of the top of the picture it flips
 * below the finger. Always clamped horizontally (and vertically as a last resort) so the whole
 * circle stays inside the still.
 *
 * @param {[number, number]} finger  the touch, rect px
 * @param {{w:number, h:number}} rect  the picture
 * @returns {{ left:number, top:number, cx:number, cy:number, placement:'above'|'below' }}
 */
export function loupePlacement(finger, rect, size = LOUPE_SIZE, offset = LOUPE_OFFSET) {
  'worklet';
  const r = size / 2;
  const fits = (cy) => cy - r >= 0 && cy + r <= rect.h;
  const above = finger[1] - offset;
  const below = finger[1] + offset;
  const placement = above - r >= 0 ? 'above' : 'below';
  const wanted = placement === 'above' ? above : below;
  const cy = fits(wanted) ? wanted : clamp(wanted, r, Math.max(r, rect.h - r));
  const cx = clamp(finger[0], r, Math.max(r, rect.w - r));
  return { left: cx - r, top: cy - r, cx, cy, placement };
}

/**
 * The still inside the loupe: the whole picture scaled by `zoom`, shifted so the marked pixel
 * is exactly at the centre of the circle (where the crosshair is drawn).
 *
 * @param {[number, number]} mark  normalised (0-1) position of the mark
 * @param {{w:number, h:number}} rect  the picture (contain-fit rect of the still)
 * @returns {{ width:number, height:number, left:number, top:number }}  style of the image,
 *   absolutely positioned inside the circle
 */
export function loupeImage(mark, rect, size = LOUPE_SIZE, zoom = LOUPE_ZOOM) {
  'worklet';
  const width = rect.w * zoom;
  const height = rect.h * zoom;
  return { width, height, left: size / 2 - mark[0] * width, top: size / 2 - mark[1] * height };
}

// --- D28: the loupe in the corner opposite the mark ---------------------------------------------
// On the marking canvas the loupe no longer rides above the finger: it sits in a right-hand corner
// of the picture (the dock is on the left, the ball bottom-left), the one away from the mark, and
// stays there for the whole drag unless the mark itself comes near it.

export const LOUPE_MARGIN = 8; // px from the picture's edges
export const LOUPE_TAG_CLEAR = 36; // px kept free at the bottom for the frame tag (VIDEO · n)
export const LOUPE_CLEAR = 24; // px: the mark this close to the ring's edge sends it to the other corner

/** Top-left of the loupe in corner `side` (0 = top-right, 1 = bottom-right), rect px. */
export function loupeCorner(side, rect, size = LOUPE_SIZE, margin = LOUPE_MARGIN) {
  'worklet';
  return {
    left: Math.max(0, rect.w - size - margin),
    top: side === 1 ? Math.max(0, rect.h - size - margin - LOUPE_TAG_CLEAR) : Math.min(margin, Math.max(0, rect.h - size)),
  };
}

/**
 * The corner for a mark at `mark` (rect px): the one away from it (a mark in the top half gets the
 * bottom-right corner, and the other way round); with `prev` (the corner already in use) it stays
 * put until the mark comes within LOUPE_CLEAR of the ring.
 */
export function loupeSide(mark, rect, size = LOUPE_SIZE, prev = -1) {
  'worklet';
  const want = mark[1] < rect.h / 2 ? 1 : 0;
  if (prev !== 0 && prev !== 1) return want;
  const at = loupeCorner(prev, rect, size);
  const d = Math.hypot(mark[0] - (at.left + size / 2), mark[1] - (at.top + size / 2));
  return d < size / 2 + LOUPE_CLEAR ? 1 - prev : prev;
}
