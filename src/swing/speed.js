// Face-on ball and clubhead speed (plan 2026-10-30 §5, design A: Extras rows, "≈", no status dot).
// Pure: pass 2's pixels (native BallFlight / web core/ballFlight, display px per captured frame) +
// the capture fps + the leg scale + the address ankles -> m/s, smash factor and launch angle, with
// the gates that drop a misread. Stored in m/s; the row formats in the player's units (highlights).

import { SWING_STRINGS } from './strings';

export const BALL_CM = 4.27;
/** Below this the ball moves too far between frames to time (one frame at 60 fps is ±25 %). */
export const MIN_FPS = 120;
/**
 * The ball's own scale ÷ the leg scale: nearer the camera than the legs, so bigger (1.2 at 3 m, 1.5 on
 * the web's iPhone clip, filmed closer), never much smaller; the leg scale itself is ±10 % and leans
 * on the height. Outside it the ball's size was misread (a shoe, a tee box marker).
 */
export const SCALE_RATIO = [0.9, 2.0];
export const MPH = 2.23694;
/** Plausible speeds, m/s (ball 40-210 mph, club 30-140 mph); outside them a misread. */
export const BALL_MS = [40 / MPH, 210 / MPH];
export const CLUB_MS = [30 / MPH, 140 / MPH];
/** Ball ÷ club outside this: the club reading is the worse one, and is dropped. */
export const SMASH = [1.15, 1.55];
export const LAUNCH_DEG = [-5, 45];

const T = SWING_STRINGS.checkText;
const L = SWING_STRINGS.checkLabel;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, n = 0) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * { ballMs, clubMs, smash, launchDeg, reason } from pass 2's raw speed (null fields when not read).
 * `reason`: null | 'unsupported' | 'fps' | 'no_ball' | 'scale' | 'no_flight'.
 * @param {object|null|undefined} raw  pass2.speed: { x, y, d, ball: { vx, vy, kept }, club } display px / frame,
 *   or { unsupported: true } when the binary cannot measure it
 * @param {{ fps:number, pxPerCm:number, dir:1|-1, ankles?:{lead:number[], trail:number[]}|null }} ctx
 */
export function speedOf(raw, { fps, pxPerCm, dir = 1, ankles = null }) {
  const none = (reason) => ({ ballMs: null, clubMs: null, smash: null, launchDeg: null, reason });
  if (raw?.unsupported) return none('unsupported');
  if (!finite(fps) || fps < MIN_FPS) return none('fps');
  if (!raw || !finite(raw.d) || raw.d <= 0) return none('no_ball');
  const ownPxPerCm = raw.d / BALL_CM;
  if (finite(pxPerCm) && pxPerCm > 0) {
    const r = ownPxPerCm / pxPerCm;
    if (r < SCALE_RATIO[0] || r > SCALE_RATIO[1]) return none('scale');
  }
  const toMs = (pxPerFrame) => (pxPerFrame * fps) / ownPxPerCm / 100;
  const b = raw.ball;
  let ballMs = b && finite(b.vx) && finite(b.vy) ? toMs(Math.hypot(b.vx, b.vy)) : null;
  if (ballMs != null && (ballMs < BALL_MS[0] || ballMs > BALL_MS[1])) ballMs = null;
  let launchDeg = null;
  if (ballMs != null) {
    // the launch against the ground line (the ankles at address), not the picture's horizontal
    const up = Math.atan2(-b.vy, b.vx * dir);
    const g = ankles && ankles.lead && ankles.trail
      ? Math.atan2(-(ankles.lead[1] - ankles.trail[1]), (ankles.lead[0] - ankles.trail[0]) * dir)
      : 0;
    launchDeg = ((up - g) * 180) / Math.PI;
    if (launchDeg < LAUNCH_DEG[0] || launchDeg > LAUNCH_DEG[1]) launchDeg = null;
  }
  let clubMs = finite(raw.club) ? toMs(raw.club) : null;
  if (clubMs != null && (clubMs < CLUB_MS[0] || clubMs > CLUB_MS[1])) clubMs = null;
  let smash = ballMs != null && clubMs != null ? ballMs / clubMs : null;
  if (smash != null && (smash < SMASH[0] || smash > SMASH[1])) {
    clubMs = null;
    smash = null;
  }
  return { ballMs, clubMs, smash, launchDeg, reason: ballMs == null && clubMs == null ? 'no_flight' : null };
}

/**
 * The Extras rows: ball speed, club speed, smash factor, launch, each an estimate (status 'unknown',
 * `info`: no dot, no rank). One row saying why when nothing was measured; none when pass 2 was not
 * asked (`raw` undefined: an older analysis).
 */
export function speedRows(raw, ctx) {
  if (raw === undefined) return [];
  const s = speedOf(raw, ctx);
  const row = (id, value, unit, text) => ({
    id, label: L[id], position: null, cps: ['impact'], extra: true, info: true, status: 'unknown', value, unit, text,
  });
  if (s.reason) return [row('speed_ball', null, null, T.speed_none(s.reason))];
  const out = [];
  out.push(s.ballMs != null ? row('speed_ball', round(s.ballMs, 1), 'speed', T.speed_ball) : row('speed_ball', null, null, T.speed_none('no_flight')));
  if (s.clubMs != null) out.push(row('speed_club', round(s.clubMs, 1), 'speed', T.speed_club));
  if (s.smash != null) out.push(row('speed_smash', round(s.smash, 2), 'smash', T.speed_smash));
  if (s.launchDeg != null) out.push(row('speed_launch', round(s.launchDeg, 0), 'launch', T.speed_launch));
  return out;
}
