// Club marks (plan 5.3, D16). v1 proposes the clubhead only at address and impact
// (native seeds them from the ball and the hands); everywhere else the user places it in
// Edit marks or marks it hidden, and club-dependent checks stay 'unknown' until then.
// Points are {x, y} in pixels.

export const CANDIDATE_MIN_CONF = 0.35;
// Checkpoints where native proposes a clubhead (D16).
export const SEEDED_CHECKPOINTS = ['address', 'impact'];
const PRIOR_CONF = 0.1;

const asPoint = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p || null);

/**
 * @param {string} key  checkpoint key
 * @param {{x:number,y:number}} hands  the smoothed grip estimate at the checkpoint
 * @param {object|null} candidate  native shaft result for this frame:
 *   { head: [x, y] | null, hidden, conf, source: 'edge'|'prior' }
 * @param {object|null} userMark  { hands?: {x,y}, head: {x,y}|null, hidden } from Edit marks
 * @param {{x:number,y:number}|null} ball
 * @returns {{hands, head: {x,y}|null, hidden: boolean, source: 'user'|'edge'|'prior', conf: number, priorHead?: {x,y}}}
 *   `priorHead` (address and impact only) is where the UI draws the dashed ring to drag; it is
 *   never used by a check.
 */
export function resolveClub(key, hands, candidate, userMark, ball = null) {
  if (userMark) {
    const hidden = !!userMark.hidden || !userMark.head;
    return {
      hands: asPoint(userMark.hands) || hands,
      head: hidden ? null : asPoint(userMark.head),
      hidden,
      source: 'user',
      conf: 1,
    };
  }
  if (candidate && (candidate.conf ?? 0) >= CANDIDATE_MIN_CONF && candidate.source !== 'prior') {
    const head = candidate.hidden ? null : asPoint(candidate.head);
    return { hands, head, hidden: !head, source: 'edge', conf: candidate.conf };
  }
  const prior = { hands, head: null, hidden: false, source: 'prior', conf: PRIOR_CONF };
  if (SEEDED_CHECKPOINTS.includes(key) && ball) prior.priorHead = { x: ball.x, y: ball.y };
  return prior;
}
