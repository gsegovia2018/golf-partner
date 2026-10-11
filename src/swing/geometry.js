// Swing geometry (plan 5.2), ported from the prototype's plane.py and the swing
// lab's editor/checks.js. Pure functions on points {x, y} in pixels (y down).
// A landmark row is [x, y, visibility]; `pt(lm[i])` turns it into a point.

// MediaPipe Pose landmark indices.
export const LM = {
  nose: 0,
  lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
  lToe: 31, rToe: 32,
};

const rad2deg = (r) => (r * 180) / Math.PI;

export const pt = (row) => (row ? { x: row[0], y: row[1] } : null);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle of the segment p->q above the horizontal, degrees (left/right agnostic). */
export function angleAboveHorizontal(p, q) {
  return rad2deg(Math.atan2(-(q.y - p.y), Math.abs(q.x - p.x)));
}

/**
 * Signed perpendicular distance (px) of `p` from the line a->b, positive on the
 * ball side (above / outside for a line running up and away from the ball).
 * The caller converts to cm.
 */
export function sideOfLine(p, a, b) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  if (dy > 0) {
    dx = -dx;
    dy = -dy;
  }
  return (p.x - a.x) * -dy + (p.y - a.y) * dx;
}

/** x where the line p->q crosses height y (the butt-end extension); null when horizontal. */
export function extendToY(p, q, y) {
  if (q.y === p.y) return null;
  return p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y);
}

/** Spine tilt from vertical, degrees: mid-hip -> mid-shoulder. */
export function spineTiltDeg(hips, shoulders) {
  return rad2deg(Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y));
}

/**
 * The shoulder nearer the camera in a down-the-line view: the smaller x for a
 * right-hander (the prototype's rule), the larger x for a left-hander (D6).
 */
export function trailShoulder(lm, handedness = 'right') {
  const l = pt(lm[LM.lSh]);
  const r = pt(lm[LM.rSh]);
  const leftIsTrail = handedness === 'left' ? l.x > r.x : l.x < r.x;
  return leftIsTrail ? l : r;
}

/** Mirror x around the ball so a left-hander reads like a right-hander (R10). */
export const mirrorX = (x, ballX, handedness = 'right') =>
  handedness === 'left' ? ballX - (x - ballX) : x;

/**
 * Address reference planes through the ball: the shaft plane (ball -> hands)
 * and the shoulder plane (ball -> trail shoulder), as angles above the ground.
 */
export function planeAngles(ball, handsAddress, trailSh) {
  return {
    shaftPlaneDeg: angleAboveHorizontal(ball, handsAddress),
    shoulderPlaneDeg: angleAboveHorizontal(ball, trailSh),
  };
}
