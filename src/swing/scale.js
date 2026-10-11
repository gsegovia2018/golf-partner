// Pixel -> cm (plan 4.6). Body-segment scale, not frame height, because the golfer is
// tilted at address: pxPerCm = legPx / (0.49 x heightCm), legPx = hip->knee + knee->ankle
// of the camera-nearer leg (the trail leg in a down-the-line view), median over the
// address window. Expected error +-8-10 %.

import { LM, dist, pt } from './geometry';
import { median } from './smoothing';

export const LEG_FRACTION = 0.49; // hip joint to ankle / body height
export const BALL_CM = 4.27;
export const SHAFT_CM = 105;
const DEFAULT_HEIGHT_CM = { male: 176, female: 163 };

/** Height used when the golfer has not told us theirs; always `approx`. */
export const defaultHeightCm = (gender) => DEFAULT_HEIGHT_CM[gender === 'female' ? 'female' : 'male'];

/**
 * @param {number[][][]} frames  landmark sets (33 x [x, y, vis], px) from the address window
 * @param {string} handedness
 * @param {number} heightCm
 * @param {boolean} [approx]  true when heightCm is the default, not the golfer's
 */
export function legScale(frames, handedness, heightCm, approx = false) {
  const [hip, knee, ank] = handedness === 'left' ? [LM.lHip, LM.lKnee, LM.lAnk] : [LM.rHip, LM.rKnee, LM.rAnk];
  const legPx = median(frames.map((lm) => dist(pt(lm[hip]), pt(lm[knee])) + dist(pt(lm[knee]), pt(lm[ank]))));
  return { legPx, pxPerCm: legPx / (LEG_FRACTION * heightCm), heightCm, approx };
}

/** legScale over the samples of `idx` inside [from, to] (nearest sample when none is inside). */
export function scaleFromWindow(idx, L, [from, to], handedness, heightCm, approx = false) {
  let picked = L.filter((_, k) => idx[k] >= from && idx[k] <= to);
  if (!picked.length) {
    const mid = (from + to) / 2;
    const k = idx.reduce((best, v, i) => (Math.abs(v - mid) < Math.abs(idx[best] - mid) ? i : best), 0);
    picked = [L[k]];
  }
  return legScale(picked, handedness, heightCm, approx);
}

export const expectedShaftPx = (pxPerCm) => SHAFT_CM * pxPerCm;
export const ballDiameterPx = (pxPerCm) => BALL_CM * pxPerCm;
