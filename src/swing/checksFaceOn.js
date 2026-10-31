// The face-on check rows (plan 2026-10-30-swing-face-on §4): five positions (address, top,
// shaftDown = downswing, impact, finish) and the extras, after swingcheck.org's face-on rule set
// (2026-10-31): nothing reads the clubhead face-on, impact reads the hands against the ball. Same
// row shape as checks.js: `position`
// or `extra: true`, the `fault` it points at, a `severity` in yellow-band units.
//
// Everything is turned so +x points at the target, whatever the golfer's hand or a flipped video:
// the direction comes from the pose (the hands go back, away from the target, at the top), the
// profile's handedness only breaks a tie. Lead / trail landmarks are picked by that direction
// (the one nearer the target), not by MediaPipe's left / right labels, which swap face-on.
// Coordinates are pixels, y down; values are cm through the leg scale.
// PROVISIONAL: the limits are coaching norms until the lab table (plan §8) reads them off the
// face-on reference clips and the owner's swings.

import { LM, mid, spineTiltDeg } from './geometry';
import { headTrusted } from './club';
import { normClub } from './checks';
import { SWING_STRINGS as T } from './strings';
import { t } from '../i18n';

const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);
const has = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const band = (v, g, y) => (v <= g ? 'green' : v <= y ? 'yellow' : 'red');
const FINISH_QUIET_S = 0.4;
const FINISH_BALANCE_H = 0.08; // as checks.js: mid-hip x within 0.08 H of the lead ankle x
const MIN_HANDS_MOVE_H = 0.05; // the hands must travel this share of the height for the direction to count
// A ball this far outside the stance (in stance widths past either foot) is not the golfer's ball:
// a proposal that latched onto something else. The rows that read it say "no ball" instead.
const BALL_OUTSIDE_STANCE = 0.5;
// Shoulder width (joint to joint, MediaPipe's landmarks) as a share of the height. The stance is read
// against it rather than the shoulders on screen, which narrow as soon as the chest turns.
const SHOULDER_H = 0.23;
const HIPS_SHIFT_CM = 5; // the pelvis moves this far toward the target from the top to the downswing

const sevOf = (m, g, y, status) => {
  if (status === 'green') return 0;
  return round((status === 'red' ? m - y : m - g) / ((y - g) || 1), 2);
};
const judge = (m, [g, y]) => {
  const status = band(m, g, y);
  return { status, severity: sevOf(m, g, y, status) };
};
const judgeRange = (v, { green: [gLo, gHi], yellow: [yLo, yHi] }) => {
  if (v >= gLo && v <= gHi) return { status: 'green', severity: 0, side: null };
  const low = v < gLo;
  const m = low ? gLo - v : v - gHi;
  const span = low ? gLo - yLo : yHi - gHi;
  const status = m <= span ? 'yellow' : 'red';
  return { status, severity: sevOf(m, 0, span, status), side: low ? 'low' : 'high' };
};

const SHARED = {
  sway: [3, 7], // cm, trail hip past the trail ankle (away from the target) at the top
  hipsShift: [0, 3], // cm short of a 5 cm shift toward the target, top -> downswing (5+ green, 2+ yellow;
  // tour swings of S0 read 2-16, most 4-16)
  headBack: [5, 12], // cm, head past its address x toward the target at the downswing (tour S0: -4-12)
  slide: [6, 10], // cm, lead hip past the lead ankle toward the target at impact (a tour bump reads 5-7)
  hipsImpact: [0, 4], // cm short of a 6 cm shift toward the target, address -> impact (6+ green, 2+ yellow)
  headBehind: [0, 4], // cm, head in front of the ball (toward the target) at impact
};

export const THRESHOLDS_FO = {
  iron: {
    stance: { green: [1.0, 1.4], yellow: [0.85, 1.6] }, // ankle span / shoulder width (0.23 x height)
    ballPos: { green: [0.45, 0.6], yellow: [0.4, 0.7] }, // 0 = trail ankle, 1 = lead ankle
    setupTilt: { green: [0, 10], yellow: [-3, 14] }, // degrees, spine away from the target
    headTop: [5, 10], // cm sideways, address -> top
    headDip: [5, 10], // cm, head lower than at address at impact
    finishWeight: [0.8, 0.15], // the pelvis this share of the stance toward the lead foot; band below it
    finishHead: [12, 25], // cm, head behind the lead ankle at the finish (tour irons read -6-21)
    handsAhead: { green: [3, 15], yellow: [-2, 22] }, // cm, hands past the ball toward the target at impact
    ...SHARED,
  },
  driver: {
    stance: { green: [1.2, 1.7], yellow: [1.0, 1.9] },
    ballPos: { green: [0.75, 0.95], yellow: [0.7, 1.0] },
    setupTilt: { green: [4, 15], yellow: [0, 18] },
    headTop: [7, 12],
    headDip: [7, 12], // tour drivers drop the head 5-10 cm
    finishWeight: [0.65, 0.15], // a driver finishes with the hips less far over (tour 60-88 %)
    finishHead: [25, 40], // tour drivers finish with the head 9-35 cm behind the lead foot
    handsAhead: { green: [-15, 5], yellow: [-25, 10] }, // the ball sits forward: the hands meet it level or behind
    ...SHARED,
  },
};

// Checks whose value depends on the impact frame inherit `approximate` from the fps model.
const IMPACT_DEPENDENT = new Set(['fo_hands_ahead', 'fo_hips_impact', 'fo_slide', 'fo_head_behind', 'fo_head_dip', 'tempo']);

/**
 * +1 when the target is to the right of the picture, -1 to the left: at the top the hands sit on
 * the side away from the target, measured from the middle of the feet (they do not move, so a
 * misplaced address frame cannot flip it; the address hands stand in without the ankles). Falls
 * back to the handedness (a right-hander filmed face-on hits to the right of the picture) when the
 * hands barely moved or a frame is missing.
 */
export function targetDir(pose, cps, handedness = 'right', heightPx = 0) {
  const fallback = handedness === 'left' ? -1 : 1;
  const tp = cps.top?.hands;
  const lm = cps.address ? pose?.(cps.address.frame) : null;
  const ank = lm && [lm[LM.lAnk], lm[LM.rAnk]].every((p) => p && Number.isFinite(p[0])) ? (lm[LM.lAnk][0] + lm[LM.rAnk][0]) / 2 : null;
  const from = ank ?? cps.address?.hands?.x;
  if (!has(tp) || !Number.isFinite(from)) return fallback;
  const dx = from - tp.x;
  if (Math.abs(dx) < MIN_HANDS_MOVE_H * heightPx) return fallback;
  return dx > 0 ? 1 : -1;
}

/**
 * @param {object} input  as runChecks (checks.js): checkpoints, ball, pose, handedness, club,
 *   pxPerCm, heightCm, motionStart, finishQuietS, approximate
 * @returns {{checks: object[], dir: 1|-1}}
 */
export function runFaceOnChecks(input) {
  const { checkpoints: cps = {}, ball, pose, handedness = 'right', pxPerCm, heightCm } = input;
  const approximate = !!input.approximate;
  const TH = THRESHOLDS_FO[normClub(input.club)];
  const cm = 1 / pxPerCm;
  const H = heightCm * pxPerCm;
  const dir = targetDir(pose, cps, handedness, H);
  const X = (p) => (has(p) ? { x: dir * p.x, y: p.y } : null); // +x = toward the target

  const raw = (k) => {
    const f = cps[k] ? pose?.(cps[k].frame) : null;
    return f ?? null;
  };
  const lm = (k, i) => {
    const p = raw(k)?.[i];
    return p && Number.isFinite(p[0]) ? { x: dir * p[0], y: p[1] } : null;
  };
  // the lead / trail one of a left-right pair: the lead is the one nearer the target
  const pair = (k, a, b) => {
    const p = lm(k, a);
    const q = lm(k, b);
    if (!p || !q) return null;
    return p.x >= q.x ? { lead: p, trail: q } : { lead: q, trail: p };
  };
  const hips = (k) => pair(k, LM.lHip, LM.rHip);
  // The head: the ears' middle. Face-on the nose swings sideways as soon as the face turns to the ball
  // (S0: 11-13 cm 'head toward the target' on tour downswings); the nose stands in without both ears.
  const head = (k) => {
    const a = lm(k, LM.lEar);
    const b = lm(k, LM.rEar);
    return a && b ? mid(a, b) : lm(k, LM.nose);
  };
  const ankles = (k) => pair(k, LM.lAnk, LM.rAnk);
  const pelvis = (k) => {
    const h = hips(k);
    return h ? mid(h.lead, h.trail) : null;
  };
  const feetAt = ankles('address');
  const stanceOf = (f) => (f ? f.lead.x - f.trail.x : 0);
  const ballIn = (b) => {
    if (!b || !feetAt || stanceOf(feetAt) <= 0) return b;
    const r = (b.x - feetAt.trail.x) / stanceOf(feetAt);
    return r >= -BALL_OUTSIDE_STANCE && r <= 1 + BALL_OUTSIDE_STANCE ? b : null;
  };
  const B = ballIn(X(ball));
  const club = (k) => {
    const c = cps[k];
    if (!c || !has(c.hands)) return null;
    const seen = !c.hidden && has(c.head);
    const trusted = seen && headTrusted(c.source, c.conf);
    return { hands: X(c.hands), head: trusted ? X(c.head) : null, unplaced: c.source === 'prior' || (seen && !trusted) };
  };

  const rows = [];
  const M = (id, position, cpsList, extra = {}) => ({ id, label: T.checkLabel[id], position, cps: cpsList, ...extra });
  const XR = (id, cpsList, extra = {}) => M(id, null, cpsList, { extra: true, ...extra });
  const unknown = (m, reason, text) => ({ ...m, status: 'unknown', value: null, unit: null, reason, text });
  const at = (name) => t(`misc.swing.at.${name}`);
  const why = (name, params) => T.reason.nodata(t(`misc.swing.why.${name}`, params));
  const push = (m, j, value, unit, text, extra = {}) => rows.push({
    ...m, status: j.status, severity: j.severity, value, unit, text, ...extra,
  });
  const nopose = (m, where) => rows.push(unknown(m, 'nopose', T.reason.nopose(at(where))));
  const feet = ankles('address'); // the feet stay put: every "past the foot" reads the address ankles

  // --- Address ----------------------------------------------------------------------------

  // fo_stance: the ankles' span against a shoulder width (SHOULDER_H of the height)
  {
    const m = M('fo_stance', 'address', ['address'], { fault: 'stance_width' });
    if (!feet) nopose(m, 'address');
    else {
      const r = round((feet.lead.x - feet.trail.x) / (SHOULDER_H * H), 2);
      const j = judgeRange(r, TH.stance);
      push(m, j, r, '×', T.checkText.fo_stance(r, j.side), { dir: j.side === 'low' ? 'narrow' : j.side === 'high' ? 'wide' : null });
    }
  }

  // fo_ball_pos: where the ball sits between the feet (0 = trail ankle, 1 = lead ankle)
  {
    const m = M('fo_ball_pos', 'address', ['address'], { fault: 'ball_position' });
    if (!feet) nopose(m, 'address');
    else if (!B) rows.push(unknown(m, 'nodata', why('noBall')));
    else {
      const span = feet.lead.x - feet.trail.x;
      if (span <= 0) nopose(m, 'address');
      else {
        const r = round((B.x - feet.trail.x) / span, 2);
        const j = judgeRange(r, TH.ballPos);
        push(m, j, Math.round(r * 100), '%', T.checkText.fo_ball_pos(j.side), { dir: j.side === 'low' ? 'back' : j.side === 'high' ? 'forward' : null });
      }
    }
  }

  // fo_setup_tilt: the spine leaning away from the target (shoulders behind the hips), degrees
  {
    const m = M('fo_setup_tilt', 'address', ['address'], { fault: 'posture' });
    const p = pelvis('address');
    const sh = pair('address', LM.lSh, LM.rSh);
    if (!p || !sh) nopose(m, 'address');
    else {
      const s = mid(sh.lead, sh.trail);
      const deg = round(-spineTiltDeg(p, s), 0); // + = shoulders behind the hips
      const j = judgeRange(deg, TH.setupTilt);
      push(m, j, deg, '°', T.checkText.fo_setup_tilt(deg), { dir: j.side === 'low' ? 'upright' : j.side === 'high' ? 'much' : null });
    }
  }

  // --- Top ----------------------------------------------------------------------------------

  // fo_sway: the trail hip pushed out past the trail ankle (away from the target)
  {
    const m = M('fo_sway', 'top', ['address', 'top'], { fault: 'sway' });
    const h = hips('top');
    if (!feet || !h) nopose(m, 'top');
    else {
      const d = (feet.trail.x - h.trail.x) * cm;
      push(m, judge(Math.max(d, 0), TH.sway), round(d, 0), 'cm', T.checkText.fo_sway(d));
    }
  }

  // fo_head_top: the head (ears' middle) moved sideways from address to the top
  {
    const m = M('fo_head_top', 'top', ['address', 'top'], { fault: 'head_sway' });
    const a = head('address');
    const tp = head('top');
    if (!a || !tp) nopose(m, 'addressTop');
    else {
      const d = (tp.x - a.x) * cm;
      push(m, judge(Math.abs(d), TH.headTop), round(Math.abs(d), 0), 'cm', T.checkText.fo_head_move(d));
    }
  }

  // --- Downswing ----------------------------------------------------------------------------

  // fo_hips_shift: the pelvis moved toward the target from the top to the downswing
  {
    const m = M('fo_hips_shift', 'shaftDown', ['top', 'shaftDown'], { fault: 'hanging_back' });
    const tp = pelvis('top');
    const dn = pelvis('shaftDown');
    if (!tp || !dn) nopose(m, 'topDown');
    else {
      const d = (dn.x - tp.x) * cm;
      push(m, judge(Math.max(HIPS_SHIFT_CM - d, 0), TH.hipsShift), round(d, 0), 'cm', T.checkText.fo_hips_shift(d));
    }
  }

  // fo_head_back: the head stays behind its address spot on the way down
  {
    const m = M('fo_head_back', 'shaftDown', ['address', 'shaftDown'], { fault: 'head_sway' });
    const a = head('address');
    const dn = head('shaftDown');
    if (!a || !dn) nopose(m, 'addressDown');
    else {
      const d = (dn.x - a.x) * cm;
      push(m, judge(Math.max(d, 0), TH.headBack), round(d, 0), 'cm', T.checkText.fo_head_move(d));
    }
  }

  // --- Impact -------------------------------------------------------------------------------

  // fo_hands_ahead: the hands past the ball toward the target, cm (the shaft leans forward)
  {
    const m = M('fo_hands_ahead', 'impact', ['impact'], { fault: null });
    const c = club('impact');
    if (!c) rows.push(unknown(m, 'nodata', why('noMark', { what: T.checkpoint.impact.toLowerCase() })));
    else if (!B) rows.push(unknown(m, 'nodata', why('noBall')));
    else {
      const d = round((c.hands.x - B.x) * cm, 0);
      const j = judgeRange(d, TH.handsAhead);
      const fault = j.side === 'low' ? 'scoop' : j.side === 'high' ? 'excess_lean' : null;
      push(m, j, d, 'cm', T.checkText.fo_hands_ahead(d), { fault, dir: j.side === 'low' ? 'back' : j.side === 'high' ? 'forward' : null });
    }
  }

  // fo_hips_impact: the pelvis moved toward the target from address to impact
  {
    const m = M('fo_hips_impact', 'impact', ['address', 'impact'], { fault: 'hanging_back' });
    const a = pelvis('address');
    const i = pelvis('impact');
    if (!a || !i) nopose(m, 'addressImpact');
    else {
      const d = (i.x - a.x) * cm;
      push(m, judge(Math.max(6 - d, 0), TH.hipsImpact), round(d, 0), 'cm', T.checkText.fo_hips_impact(d));
    }
  }

  // fo_slide: the lead hip slid past the lead ankle toward the target
  {
    const m = M('fo_slide', 'impact', ['address', 'impact'], { fault: 'slide' });
    const h = hips('impact');
    if (!feet || !h) nopose(m, 'impact');
    else {
      const d = (h.lead.x - feet.lead.x) * cm;
      push(m, judge(Math.max(d, 0), TH.slide), round(d, 0), 'cm', T.checkText.fo_slide(d));
    }
  }

  // fo_head_behind: the head behind the ball at impact
  {
    const m = M('fo_head_behind', 'impact', ['impact'], { fault: 'head_sway' });
    const n = head('impact');
    if (!n) nopose(m, 'impact');
    else if (!B) rows.push(unknown(m, 'nodata', why('noBall')));
    else {
      const behind = (B.x - n.x) * cm;
      push(m, judge(Math.max(-behind, 0), TH.headBehind), round(behind, 0), 'cm', T.checkText.fo_head_behind(behind));
    }
  }

  // fo_head_dip: the head dropped from address to impact
  {
    const m = M('fo_head_dip', 'impact', ['address', 'impact'], { fault: 'head_dip' });
    const a = head('address');
    const i = head('impact');
    if (!a || !i) nopose(m, 'addressImpact');
    else {
      const d = (i.y - a.y) * cm;
      push(m, judge(Math.max(d, 0), TH.headDip), round(d, 0), 'cm', T.checkText.fo_head_dip(d));
    }
  }

  // --- Finish -------------------------------------------------------------------------------

  // fo_finish_weight: the pelvis over the lead foot (share of the stance from the trail ankle)
  {
    const m = M('fo_finish_weight', 'finish', ['address', 'finish'], { fault: 'hanging_back' });
    const p = pelvis('finish');
    const span = feet ? feet.lead.x - feet.trail.x : 0;
    if (!feet || !p || span <= 0) nopose(m, 'finish');
    else {
      const share = (p.x - feet.trail.x) / span;
      const [target, bandW] = TH.finishWeight;
      push(m, judge(Math.max(target - share, 0), [0, bandW]), Math.round(share * 100), '%', T.checkText.fo_finish_weight(share));
    }
  }

  // fo_finish_head: the head over the lead foot at the finish (not left behind it)
  {
    const m = M('fo_finish_head', 'finish', ['address', 'finish'], { fault: 'hanging_back' });
    const n = head('finish');
    if (!feet || !n) nopose(m, 'finish');
    else {
      const behind = (feet.lead.x - n.x) * cm;
      push(m, judge(Math.max(behind, 0), TH.finishHead), round(behind, 0), 'cm', T.checkText.fo_finish_head(behind));
    }
  }

  // --- Extras (do not colour a position) ----------------------------------------------------

  // tempo: as checks.js (view-independent)
  {
    const m = XR('tempo', ['top', 'impact']);
    const start = input.motionStart ?? cps.address?.frame;
    const tp = cps.top?.frame;
    const im = cps.impact?.frame;
    if (start == null || tp == null || im == null || im <= tp || tp <= start) rows.push(unknown(m, 'nodata', why('needsOrder')));
    else {
      const r = round((tp - start) / (im - tp), 1);
      const j = judgeRange(r, { green: [2.5, 3.5], yellow: [1.6, 4.5] });
      const d = j.side === 'low' ? 'fast' : j.side === 'high' ? 'slow' : null;
      push(m, j, r, ':1', T.checkText.tempo(tp - start, im - tp, r), { dir: d, fault: d ? `tempo_${d}` : null });
    }
  }

  // finish_balance: still for 0.4 s and the mid-hip over the lead ankle (as checks.js, face-on sides)
  {
    const m = XR('finish_balance', ['finish'], { fault: 'balance' });
    const p = pelvis('finish');
    if (!p || !feet || input.finishQuietS == null) nopose(m, 'finish');
    else {
      const quiet = input.finishQuietS >= FINISH_QUIET_S;
      const balanced = Math.abs(p.x - feet.lead.x) <= FINISH_BALANCE_H * H;
      const held = (quiet ? 1 : 0) + (balanced ? 1 : 0);
      push(m, judge(2 - held, [0, 1]), held, 'of 2', T.checkText.finish_balance(quiet, balanced));
    }
  }

  rows.forEach((r) => {
    r.approximate = approximate && IMPACT_DEPENDENT.has(r.id);
  });
  return { checks: rows, dir };
}
