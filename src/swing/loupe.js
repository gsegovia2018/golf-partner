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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
  const width = rect.w * zoom;
  const height = rect.h * zoom;
  return { width, height, left: size / 2 - mark[0] * width, top: size / 2 - mark[1] * height };
}
