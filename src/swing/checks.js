// The check rows (swing checks v2, spec 2026-10-18 §4): the seven positions (address, takeaway,
// leadArm = halfway back, top, shaftDown = downswing, impact, trailArm = follow-through), then the
// extras. Every row carries `position` (one of the seven) or `extra: true`, the `fault` it points
// at and a `severity` (spec §6: how far past its limit, in units of its yellow band). `spine_hold`
// and `knee_hold` are one id each, evaluated at several positions (`cp`).
//
// Everything is mirrored internally so the golfer is right-handed with the ball on the +x
// side; left-handers are mirrored around ball.x (R10). Coordinates are pixels, y down.
// A check never fails the swing for a clubhead nobody can see: it returns 'unknown'. A model
// clubhead below CHECK_MIN_CONF counts as unplaced (spec §5), never as a reading.

import {
  LM, angleAboveHorizontal, angleBetween, sideOfLine, extendToY, spineTiltDeg, mid, trailShoulder, kneeFlexDeg,
} from './geometry';
import { headTrusted } from './club';
import { SWING_STRINGS as T } from './strings';
import { t } from '../i18n';

const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);
const has = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const band = (v, g, y) => (v <= g ? 'green' : v <= y ? 'yellow' : 'red');
const FINISH_QUIET_S = 0.4;

/** Severity (spec §6): red = past the yellow limit, yellow = past the green one, in yellow-band units. */
const sevOf = (m, g, y, status) => {
  if (status === 'green') return 0;
  return round((status === 'red' ? m - y : m - g) / ((y - g) || 1), 2);
};
/** A one-sided magnitude m against [green, yellow] limits. */
const judge = (m, [g, y]) => {
  const status = band(m, g, y);
  return { status, severity: sevOf(m, g, y, status) };
};
/** A value against a range; the nearer edge sets the severity. side: 'low' | 'high' | null. */
const judgeRange = (v, { green: [gLo, gHi], yellow: [yLo, yHi] }) => {
  if (v >= gLo && v <= gHi) return { status: 'green', severity: 0, side: null };
  const low = v < gLo;
  const m = low ? gLo - v : v - gHi;
  const span = low ? gLo - yLo : yHi - gHi;
  const status = m <= span ? 'yellow' : 'red';
  return { status, severity: sevOf(m, 0, span, status), side: low ? 'low' : 'high' };
};

// Per-club limits (plan 5.4, D19). Exactly two clubs; 'iron' is the default and the reading
// for every swing saved before the picker existed. Each `[green, yellow]` pair is "<= green is
// green, <= yellow is yellow, else red" on the size of the reading; a `{ green, yellow }` range is
// judged on the value itself.
// PROVISIONAL: every limit of the v2 rows (spec §4) is a starting point until the lab table
// (plan L1) calibrates it on the owner's marked clips; iron and driver share them unless listed.
export const CLUBS = ['iron', 'driver'];
const SHARED = {
  handsUnderShoulders: [8, 12], // cm, |grip x - shoulder-midpoint x|; 4 cm was ~4 deg of arm lean, inside landmark noise
  // degrees between ear->shoulder and shoulder->hip. Looking down at the ball bends the neck,
  // so a dropped head gets that room (the owner's straight back reads 33-38); a lifted one does not.
  backLine: { dropped: [40, 50], up: [10, 20] },
  kneeFlex: { green: [15, 30], yellow: [10, 35] }, // degrees of trail-knee flex at address
  shaftPlane: [10, 18], // cm, address shaft line at the body front vs the belt height
  takeawayPlane: [8, 15], // cm, clubhead off the address plane at P2
  // 2026-10-18 lab table (owner-approved): 7-10 deg of straightening going back is common while the
  // leg keeps its flex at the top; red only when it nears straight.
  kneeHold: [10, 15], // degrees of trail-knee flex gained or lost since address
  leadArmSpine: [10, 20], // degrees off perpendicular to the spine at the top
  handsOverHeels: [6, 18], // cm, |grip x - trail heel x| at the top; owner's ~15 cm is a "watch", not a "fix"
  downPlane: { above: [4, 10], under: [12, 20] }, // cm, clubhead above / under the address plane at P6
  downVsTakeaway: [0, 10], // cm, P6 clubhead minus P2 clubhead vs the plane (+ = steeper coming down)
  throughVsHalfway: [10, 20], // cm, P9 shaft landing minus P3 shaft landing
  hipDrift: [3, 6], // cm
  handsOut: [4, 8], // cm
};
export const DEFAULT_CLUB = 'iron';
export const THRESHOLDS = {
  iron: {
    posture: { green: [25, 40], yellow: [20, 45] }, // spine tilt from vertical, degrees
    handsHeight: [5, 8], // cm
    shaftAngle: [6, 10], // degrees
    spineLoss: [3, 6], // degrees
    spineHold: [3, 6], // degrees of tilt lost (or gained) since address, P2-P6
    buttYellowCm: 15,
    headDrift: [5, 10], // cm
    ...SHARED,
  },
  driver: {
    posture: { green: [20, 35], yellow: [15, 40] },
    handsHeight: [8, 12],
    shaftAngle: [8, 12],
    spineLoss: [4, 7],
    spineHold: [4, 7],
    buttYellowCm: 20,
    headDrift: [6, 12],
    ...SHARED,
  },
};

/** 'iron' | 'driver'; anything else (null, undefined, an old 'wood') reads as the default. */
export const normClub = (club) => (CLUBS.includes(club) ? club : DEFAULT_CLUB);
const FINISH_BALANCE_H = 0.08; // mid-hip x within 0.08 H of the lead ankle x
const BODY_FRONT_H = 0.05; // shaft_plane: the body front, this share of the height in front of the mid-hip
// shaft_plane: the belt sits above the hip-joint landmarks; read from the owner's lab swings, where
// the shaft visibly points at the belt and the joint-height reading said 13-20 cm "upright".
const BELT_ABOVE_HIP_H = 0.06;
// A shaft close to horizontal carried to ball height lands absurdly far (a 122 cm reading on a lab
// swing); past this the landing only says "far", the number stops growing.
const LANDING_CAP_CM = 50;

// Checks whose value depends on the impact frame inherit `approximate` from the fps model.
const IMPACT_DEPENDENT = new Set([
  'hands_height_impact', 'hands_out_impact', 'shaft_angle_impact', 'spine_loss', 'hip_drift', 'head_drift', 'tempo',
]);

/**
 * Reference lines at address: the shaft plane (ball -> hands) and the shoulder plane
 * (ball -> trail shoulder), in mirrored coordinates.
 */
export function getPlanes({ checkpoints = {}, ball, pose, handedness = 'right' }) {
  const out = { shaft: null, shoulder: null };
  const addr = checkpoints.address;
  if (!ball || !has(addr?.hands)) return out;
  const sgn = handedness === 'left' ? -1 : 1;
  const mx = (x) => ball.x + sgn * (x - ball.x);
  out.shaft = { a: { x: ball.x, y: ball.y }, b: { x: mx(addr.hands.x), y: addr.hands.y } };
  const lm = pose?.(addr.frame);
  if (lm) {
    const s = trailShoulder(lm, handedness);
    out.shoulder = { a: { x: ball.x, y: ball.y }, b: { x: mx(s.x), y: s.y } };
  }
  return out;
}

/**
 * @param {object} input
 * @param {Object<string,{frame:number,hands:{x,y},head:{x,y}|null,hidden:boolean,source?:string,conf?:number}>} input.checkpoints
 *   the club checkpoints, keyed address ... finish (analyze.js CLUB_KEYS)
 * @param {{x:number,y:number}|null} input.ball
 * @param {(frame:number)=>number[][]|null} input.pose  raw landmarks (33 x [x, y, vis], px) at a frame
 * @param {'right'|'left'} [input.handedness]
 * @param {number} input.pxPerCm
 * @param {number} input.heightCm
 * @param {number} [input.motionStart]  frame; tempo's backswing starts here (D10), takeaway if absent
 * @param {number} [input.finishQuietS]  seconds the golfer stays still after the finish
 * @param {boolean} [input.approximate]  effective fps < 100 or interpolated slow-mo
 * @param {'iron'|'driver'|null} [input.club]  selects the THRESHOLDS column; default iron
 * @returns {{checks: object[], planes: object}}
 */
export function runChecks(input) {
  const { checkpoints: cps = {}, ball, pose, handedness = 'right', pxPerCm, heightCm } = input;
  const approximate = !!input.approximate;
  const TH = THRESHOLDS[normClub(input.club)];
  const sgn = handedness === 'left' ? -1 : 1;
  const cm = 1 / pxPerCm; // cm per px
  const H = heightCm * pxPerCm; // golfer height in px
  const bx = ball?.x ?? 0;
  const mx = (x) => bx + sgn * (x - bx);
  const mp = (p) => (has(p) ? { x: mx(p.x), y: p.y } : null);

  // A clubhead is read only when the golfer placed it, or a detection clears the gate (spec §5).
  const cp = (k) => {
    const c = cps[k];
    if (!c || !has(c.hands)) return null;
    const seen = !c.hidden && has(c.head);
    const trusted = seen && headTrusted(c.source, c.conf);
    return {
      frame: c.frame, hands: mp(c.hands), head: trusted ? mp(c.head) : null, hidden: !!c.hidden, unplaced: c.source === 'prior' || (seen && !trusted),
    };
  };
  const C = Object.fromEntries(Object.keys(cps).map((k) => [k, cp(k)]));
  const lm = (k, i) => {
    const c = cps[k];
    const f = c && pose?.(c.frame);
    const p = f?.[i];
    return p && Number.isFinite(p[0]) ? { x: mx(p[0]), y: p[1] } : null;
  };
  const midLm = (k, a, b) => {
    const p = lm(k, a);
    const q = lm(k, b);
    return p && q ? mid(p, q) : null;
  };
  const left = handedness === 'left';
  const [trailHipIdx, trailKneeIdx, trailAnkIdx, trailHeelIdx] = left
    ? [LM.lHip, LM.lKnee, LM.lAnk, LM.lHeel] : [LM.rHip, LM.rKnee, LM.rAnk, LM.rHeel];
  const [leadShIdx, leadWrIdx, leadAnkIdx] = left ? [LM.rSh, LM.rWr, LM.rAnk] : [LM.lSh, LM.lWr, LM.lAnk];
  const planes = getPlanes(input);
  const rows = [];
  const M = (id, position, cpsList, extra = {}) => ({
    id, label: T.checkLabel[id], position, cps: cpsList, ...extra,
  });
  const X = (id, cpsList, extra = {}) => M(id, null, cpsList, { extra: true, ...extra });
  const unknown = (m, reason, text) => ({ ...m, status: 'unknown', value: null, unit: null, reason, text });
  const at = (name) => t(`misc.swing.at.${name}`);
  const cpName = (k) => T.checkpoint[k].toLowerCase();
  const why = (name, params) => T.reason.nodata(t(`misc.swing.why.${name}`, params));
  const headMissing = (c, where) => (c.unplaced ? T.reason.unplaced : T.reason.hidden(where));
  const push = (m, j, value, unit, text, extra = {}) => rows.push({
    ...m, status: j.status, severity: j.severity, value, unit, text, ...extra,
  });
  const tiltOf = (k) => {
    const sh = midLm(k, LM.lSh, LM.rSh);
    const hip = midLm(k, LM.lHip, LM.rHip);
    return sh && hip ? spineTiltDeg(hip, sh) : null;
  };
  const flexOf = (k) => {
    const hip = lm(k, trailHipIdx);
    const knee = lm(k, trailKneeIdx);
    const ank = lm(k, trailAnkIdx);
    return hip && knee && ank ? kneeFlexDeg(hip, knee, ank) : null;
  };
  const sym = (v, limits) => judge(Math.abs(v), limits);
  // Mid-toe x at address (mirrored), or null.
  const toesX = () => {
    const toeL = lm('address', LM.lToe);
    const toeR = lm('address', LM.rToe);
    return toeL && toeR ? (toeL.x + toeR.x) / 2 : toeL?.x ?? toeR?.x ?? null;
  };
  // The clubhead's side of the address plane at a position, cm (+ = above / outside), or why not.
  const planeSide = (k) => {
    const c = C[k];
    if (!c) return { reason: 'nodata', text: why('noMark', { what: cpName(k) }) };
    if (!c.head) return { reason: c.unplaced ? 'unplaced' : 'hidden', text: headMissing(c, cpName(k)) };
    if (!planes.shaft) return { reason: 'nodata', text: why('noAddressPlane') };
    return { d: sideOfLine(c.head, planes.shaft.a, planes.shaft.b) * cm };
  };
  // The shaft line (clubhead -> grip) carried to ball height (D23), against the ball and the toes.
  // `miss` (cm) is how far it lands outside the good zone (toes .. ball, with the 10 % margin), 0 inside it.
  const landing = (k) => {
    const c = C[k];
    if (!c) return { reason: 'nodata', text: why('noMark', { what: cpName(k) }) };
    if (!c.head || !ball) return { reason: c.unplaced ? 'unplaced' : 'hidden', text: headMissing(c, cpName(k)) };
    const raw = extendToY(c.head, c.hands, ball.y);
    if (raw === null) return { reason: 'nodata', text: why('shaftHorizontal') };
    const toes = toesX();
    // The cap bounds the distance outside the zone, so a reading never crosses into it.
    const cap = LANDING_CAP_CM / cm; // px
    const x = Math.max((toes !== null && toes < bx ? toes : bx) - cap, Math.min(bx + cap, raw));
    const span = toes !== null && toes < ball.x ? bx - toes : 0;
    const margin = 0.1 * span;
    const beyond = (x - bx - margin) * cm; // + = beyond the ball
    const inside = toes !== null && span ? (toes + margin - x) * cm : -Infinity; // + = inside the toes
    return {
      x, fromBall: (x - bx) * cm, beyond, inside, miss: Math.max(0, beyond, inside), capped: x !== raw,
    };
  };

  // --- 1 Address (P1) ---------------------------------------------------------------------

  // posture_address: spine tilt from vertical
  {
    const m = M('posture_address', 'address', ['address'], { fault: 'posture' });
    const v = tiltOf('address');
    if (v === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const j = judgeRange(v, TH.posture);
      push(m, j, round(v, 0), '°', T.checkText.posture_address(v, ...TH.posture.green), j.side ? { dir: j.side === 'low' ? 'tall' : 'over' } : {});
    }
  }

  // hands_under_shoulders: grip vs the shoulder midpoint along the target-line normal (+ = out toward the ball)
  {
    const m = M('hands_under_shoulders', 'address', ['address'], { fault: 'posture' });
    const sh = midLm('address', LM.lSh, LM.rSh);
    const a = C.address;
    if (!sh || !a) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const d = (a.hands.x - sh.x) * cm;
      const j = sym(d, TH.handsUnderShoulders);
      push(m, j, round(d, 0), 'cm', j.status === 'green' ? T.checkText.hands_under_shoulders_ok : d > 0 ? T.checkText.hands_under_shoulders_out(d) : T.checkText.hands_under_shoulders_in(-d),
        { dir: d > 0 ? 'out' : 'in' });
    }
  }

  // back_line: ear -> shoulder against shoulder -> hip; 0 = one straight line from the hips to the head
  {
    const m = M('back_line', 'address', ['address'], { fault: 'posture' });
    const ear = midLm('address', LM.lEar, LM.rEar);
    const sh = midLm('address', LM.lSh, LM.rSh);
    const hip = midLm('address', LM.lHip, LM.rHip);
    if (!ear || !sh || !hip) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const ang = angleBetween({ x: sh.x - hip.x, y: sh.y - hip.y }, { x: ear.x - sh.x, y: ear.y - sh.y });
      // Which side of the hip -> shoulder line the ear sits: + = toward the ball / down (head dropped).
      const side = (sh.x - hip.x) * (ear.y - sh.y) - (sh.y - hip.y) * (ear.x - sh.x);
      const dir = side > 0 ? 'dropped' : 'up';
      const j = judge(ang, TH.backLine[dir]);
      push(m, j, round(ang, 0), '°', j.status === 'green' ? T.checkText.back_line_ok : T.checkText.back_line(ang, dir), { dir });
    }
  }

  // knee_flex: trail knee flex (180 - the angle at the knee); too little = stiff, too much = squat
  {
    const m = M('knee_flex', 'address', ['address'], { fault: 'posture' });
    const v = flexOf('address');
    if (v === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const j = judgeRange(v, TH.kneeFlex);
      const dir = j.side === 'low' ? 'stiff' : j.side === 'high' ? 'squat' : null;
      push(m, j, round(v, 0), '°', T.checkText.knee_flex(v, dir), { dir });
    }
  }

  // shaft_plane: the address shaft (head -> hands) carried back to the body front (mid-hip x +
  // 0.05 H toward the ball); where it crosses, against the belt (mid-hip y raised by 0.06 H; + =
  // above, toward the chest: an upright shaft). The shaft angle is shown, not graded.
  {
    const m = M('shaft_plane', 'address', ['address'], { fault: 'posture' });
    const c = C.address;
    const hip = midLm('address', LM.lHip, LM.rHip);
    if (!c) rows.push(unknown(m, 'nodata', why('noMark', { what: cpName('address') })));
    else if (!c.head) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, at('address'))));
    else if (!hip) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else if (c.hands.x === c.head.x) rows.push(unknown(m, 'nodata', why('shaftVertical')));
    else {
      const xf = hip.x + BODY_FRONT_H * H;
      const y = c.head.y + ((c.hands.y - c.head.y) * (xf - c.head.x)) / (c.hands.x - c.head.x);
      const d = (hip.y - BELT_ABOVE_HIP_H * H - y) * cm;
      const deg = angleAboveHorizontal(c.head, c.hands);
      const j = sym(d, TH.shaftPlane);
      const dir = d > 0 ? 'upright' : 'flat';
      push(m, j, round(d, 0), 'cm', j.status === 'green' ? T.checkText.shaft_plane_ok(deg) : T.checkText.shaft_plane(d, dir, deg),
        { dir, shaftDeg: round(deg, 0) });
    }
  }

  // --- 2 Takeaway (P2) --------------------------------------------------------------------

  // clubhead_plane_takeaway: the clubhead against the address plane (+ = above / outside)
  {
    const m = M('clubhead_plane_takeaway', 'takeaway', ['takeaway']);
    const r = planeSide('takeaway');
    if (r.reason) rows.push(unknown(m, r.reason, r.text));
    else {
      const j = sym(r.d, TH.takeawayPlane);
      const dir = r.d > 0 ? 'steep' : 'flat';
      push(m, j, round(r.d, 0), 'cm', j.status === 'green' ? T.checkText.clubhead_plane_takeaway_ok : T.checkText.clubhead_plane_takeaway(r.d, dir),
        { dir, fault: dir === 'steep' ? 'steep_backswing' : 'flat_backswing' });
    }
  }

  // spine_hold and knee_hold at one position: the address reading minus this one's
  const spineHold = (k) => {
    const m = M('spine_hold', k, ['address', k], { cp: k, fault: k === 'shaftDown' ? 'early_extension' : 'posture_loss' });
    const ta = tiltOf('address');
    const tk = tiltOf(k);
    if (ta === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else if (tk === null) rows.push(unknown(m, 'nopose', T.reason.nopose(cpName(k))));
    else {
      const v = ta - tk; // + = standing up
      const dir = v >= 0 ? 'up' : 'down';
      push(m, sym(v, TH.spineHold), round(v, 0), '°', T.checkText.spine_hold(ta, tk, v), { dir });
    }
  };
  const kneeHold = (k) => {
    const m = M('knee_hold', k, ['address', k], { cp: k, fault: 'posture_loss' });
    const fa = flexOf('address');
    const fk = flexOf(k);
    if (fa === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else if (fk === null) rows.push(unknown(m, 'nopose', T.reason.nopose(cpName(k))));
    else {
      const v = fk - fa; // - = straightening
      const dir = v < 0 ? 'straighten' : 'flex';
      push(m, sym(v, TH.kneeHold), round(v, 0), '°', T.checkText.knee_hold(fa, fk, v), { dir });
    }
  };
  spineHold('takeaway');
  kneeHold('takeaway');

  // --- 3 Halfway back (P3) ----------------------------------------------------------------

  // butt_extension: the shaft line lands just inside the ball, between it and the toes (D23)
  {
    const m = M('butt_extension', 'leadArm', ['leadArm']);
    const r = landing('leadArm');
    if (r.reason) rows.push(unknown(m, r.reason, r.text));
    else {
      let j = { status: 'green', severity: 0 };
      let dir = null;
      let text = T.checkText.butt_extension_ok;
      if (r.beyond > 0) {
        dir = 'flat';
        j = judge(r.beyond, [0, TH.buttYellowCm]);
        text = T.checkText.butt_extension_flat(r.beyond);
      } else if (r.inside > 0) {
        dir = 'steep';
        j = judge(r.inside, [0, TH.buttYellowCm]);
        text = T.checkText.butt_extension_steep(r.inside);
      }
      push(m, j, round(r.fromBall, 0), 'cm', text, {
        dir, miss: round(r.miss, 0), capped: r.capped, fault: dir === 'steep' ? 'steep_backswing' : dir === 'flat' ? 'flat_backswing' : null,
      });
    }
  }
  spineHold('leadArm');
  kneeHold('leadArm');

  // --- 4 Top (P4) -------------------------------------------------------------------------

  // lead_arm_spine: the lead arm against the perpendicular to the spine, + = upright. The spine is
  // read instead of the shoulder line: down the line the shoulders overlap at the top.
  {
    const m = M('lead_arm_spine', 'top', ['top'], { fault: 'top_position' });
    const sh = midLm('top', LM.lSh, LM.rSh);
    const hip = midLm('top', LM.lHip, LM.rHip);
    const lsh = lm('top', leadShIdx);
    const wr = lm('top', leadWrIdx);
    const ang = sh && hip && lsh && wr ? angleBetween({ x: sh.x - hip.x, y: sh.y - hip.y }, { x: wr.x - lsh.x, y: wr.y - lsh.y }) : null;
    if (ang === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('top'))));
    else {
      // The spine points up and toward the ball, so an arm pointing more vertically closes the
      // angle with it: 90 - angle is + for an upright arm (the angle from the spine taken downward, - 90).
      const d = 90 - ang;
      const j = sym(d, TH.leadArmSpine);
      const dir = d > 0 ? 'upright' : 'flat';
      push(m, j, round(d, 0), '°', j.status === 'green' ? T.checkText.lead_arm_spine_ok : T.checkText.lead_arm_spine(d, dir), { dir });
    }
  }

  // hands_over_heels (D21): grip x vs the trail heel at the top (+ = toward the ball)
  {
    const m = M('hands_over_heels', 'top', ['top'], { fault: 'top_position' });
    const c = C.top;
    const heel = lm('top', trailHeelIdx);
    if (!c) rows.push(unknown(m, 'nodata', why('noMark', { what: cpName('top') })));
    else if (!heel) rows.push(unknown(m, 'nopose', T.reason.nopose(at('top'))));
    else {
      const d = (c.hands.x - heel.x) * cm;
      const j = sym(d, TH.handsOverHeels);
      push(m, j, round(d, 0), 'cm', j.status === 'green' ? T.checkText.hands_over_heels_ok : d < 0 ? T.checkText.hands_over_heels_deep(-d) : T.checkText.hands_over_heels_shallow(d),
        { dir: d < 0 ? 'deep' : 'shallow' });
    }
  }
  spineHold('top');

  // --- 5 Downswing (P6) -------------------------------------------------------------------

  // clubhead_plane_down: the clubhead against the address plane; above = over the top, far under = stuck
  const down = planeSide('shaftDown');
  {
    const m = M('clubhead_plane_down', 'shaftDown', ['shaftDown']);
    if (down.reason) rows.push(unknown(m, down.reason, down.text));
    else {
      const above = down.d > 0;
      const j = above ? judge(down.d, TH.downPlane.above) : judge(-down.d, TH.downPlane.under);
      const dir = above ? 'steep' : 'under';
      push(m, j, round(down.d, 0), 'cm', j.status === 'green' ? T.checkText.clubhead_plane_down_ok : T.checkText.clubhead_plane_down(down.d, dir),
        { dir, fault: above ? 'over_the_top' : 'stuck' });
    }
  }

  // down_vs_takeaway: coming down against going back (+ = steeper coming down); needs both clubheads
  {
    const m = M('down_vs_takeaway', 'shaftDown', ['takeaway', 'shaftDown'], { fault: 'over_the_top' });
    const back = planeSide('takeaway');
    const miss = back.reason ? back : down.reason ? down : null;
    if (miss) rows.push(unknown(m, miss.reason, miss.text));
    else {
      const d = down.d - back.d;
      push(m, judge(d, TH.downVsTakeaway), round(d, 0), 'cm', T.checkText.down_vs_takeaway(d), { dir: d > 0 ? 'steeper' : 'shallower' });
    }
  }
  spineHold('shaftDown');

  // --- 6 Impact (P7) ----------------------------------------------------------------------

  // hip_drift: the trail hip toward the ball since address
  {
    const m = M('hip_drift', 'impact', ['address', 'impact'], { fault: 'early_extension' });
    const a = lm('address', trailHipIdx);
    const i = lm('impact', trailHipIdx);
    if (!a || !i) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressImpact'))));
    else {
      const d = (i.x - a.x) * cm;
      push(m, judge(d, TH.hipDrift), round(d, 0), 'cm', T.checkText.hip_drift(d));
    }
  }

  // spine_loss: spine tilt lost from address to impact
  {
    const m = M('spine_loss', 'impact', ['address', 'impact'], { fault: 'early_extension' });
    const ta = tiltOf('address');
    const ti = tiltOf('impact');
    if (ta === null || ti === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressImpact'))));
    else {
      const loss = ta - ti;
      push(m, judge(loss, TH.spineLoss), round(loss, 0), '°', T.checkText.spine_loss(ta, ti, loss));
    }
  }

  // --- 7 Follow-through (P9) --------------------------------------------------------------

  // shaft_through_ball: the mirror of halfway back; beyond the ball = a flip, inside the toes = out-to-in
  const through = landing('trailArm');
  {
    const m = M('shaft_through_ball', 'trailArm', ['trailArm']);
    if (through.reason) rows.push(unknown(m, through.reason, through.text));
    else {
      let j = { status: 'green', severity: 0 };
      let dir = null;
      if (through.beyond > 0) {
        dir = 'beyond';
        j = judge(through.beyond, [0, TH.buttYellowCm]);
      } else if (through.inside > 0) {
        dir = 'inside';
        j = judge(through.inside, [0, TH.buttYellowCm]);
      }
      const text = dir === 'beyond' ? T.checkText.shaft_through_ball_beyond(through.beyond)
        : dir === 'inside' ? T.checkText.shaft_through_ball_inside(through.inside) : T.checkText.shaft_through_ball_ok;
      push(m, j, round(through.fromBall, 0), 'cm', text, {
        dir, miss: round(through.miss, 0), capped: through.capped, fault: dir === 'inside' ? 'over_the_top' : dir === 'beyond' ? 'flip' : null,
      });
    }
  }

  // through_vs_halfway: the P9 shaft line against the P3 one (+ = lands further out)
  {
    const m = M('through_vs_halfway', 'trailArm', ['leadArm', 'trailArm'], { fault: 'flip' });
    const back = landing('leadArm');
    const miss = back.reason ? back : through.reason ? through : null;
    if (miss) rows.push(unknown(m, miss.reason, miss.text));
    else {
      const d = (through.x - back.x) * cm;
      const j = sym(d, TH.throughVsHalfway);
      push(m, j, round(d, 0), 'cm', j.status === 'green' ? T.checkText.through_vs_halfway_ok : T.checkText.through_vs_halfway(d), { dir: d > 0 ? 'beyond' : 'inside' });
    }
  }

  // --- Extras (do not colour a position) --------------------------------------------------

  // tempo: backswing (motionStart -> top) : downswing (top -> impact), D9 and D10
  {
    const m = X('tempo', ['top', 'impact']);
    const start = input.motionStart ?? cps.takeaway?.frame;
    const tp = cps.top?.frame;
    const im = cps.impact?.frame;
    if (start == null || tp == null || im == null || im <= tp || tp <= start) rows.push(unknown(m, 'nodata', why('needsOrder')));
    else {
      const r = round((tp - start) / (im - tp), 1); // judged at the precision shown
      const j = judgeRange(r, { green: [2.5, 3.5], yellow: [1.6, 4.5] });
      const dir = j.side === 'low' ? 'fast' : j.side === 'high' ? 'slow' : null;
      push(m, j, r, ':1', T.checkText.tempo(tp - start, im - tp, r), { dir, fault: dir ? `tempo_${dir}` : null });
    }
  }

  // finish_balance: still for 0.4 s and the mid-hip over the lead ankle
  {
    const m = X('finish_balance', ['finish'], { fault: 'balance' });
    const hl = lm('finish', LM.lHip);
    const hr = lm('finish', LM.rHip);
    const ank = lm('finish', leadAnkIdx);
    if (!hl || !hr || !ank || input.finishQuietS == null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('finish'))));
    else {
      const quiet = input.finishQuietS >= FINISH_QUIET_S;
      const balanced = Math.abs(mid(hl, hr).x - ank.x) <= FINISH_BALANCE_H * H;
      const held = (quiet ? 1 : 0) + (balanced ? 1 : 0);
      push(m, judge(2 - held, [0, 1]), held, 'of 2', T.checkText.finish_balance(quiet, balanced));
    }
  }

  // head_drift: the nose from address to impact
  {
    const m = X('head_drift', ['address', 'impact'], { fault: 'head_sway' });
    const a = lm('address', LM.nose);
    const i = lm('impact', LM.nose);
    if (!a || !i) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressImpact'))));
    else {
      const d = Math.hypot(i.x - a.x, i.y - a.y) * cm;
      push(m, judge(d, TH.headDrift), round(d, 0), 'cm', T.checkText.head_drift(d));
    }
  }

  // hands_height_impact
  {
    const m = X('hands_height_impact', ['address', 'impact'], { fault: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', why('needsAddressImpact')));
    else {
      const d = (a.hands.y - i.hands.y) * cm;
      push(m, judge(d, TH.handsHeight), round(d, 0), 'cm', d > 0 ? T.checkText.hands_height_impact_up(d) : T.checkText.hands_height_impact_down(-d));
    }
  }

  // hands_out_impact (D11)
  {
    const m = X('hands_out_impact', ['address', 'impact'], { fault: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', why('needsAddressImpact')));
    else {
      const d = (i.hands.x - a.hands.x) * cm;
      push(m, judge(d, TH.handsOut), round(d, 0), 'cm', d > 0 ? T.checkText.hands_out_impact_in(d) : T.checkText.hands_out_impact_out(-d));
    }
  }

  // shaft_angle_impact
  {
    const m = X('shaft_angle_impact', ['address', 'impact'], { fault: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', why('needsAddressImpact')));
    else if (!a.head || !i.head) {
      const c = a.head ? i : a;
      rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, a.head ? at('impact') : at('address'))));
    } else {
      const d = angleAboveHorizontal(i.head, i.hands) - angleAboveHorizontal(a.head, a.hands);
      push(m, judge(d, TH.shaftAngle), round(d, 0), '°', d >= 0 ? T.checkText.shaft_angle_impact_up(d) : T.checkText.shaft_angle_impact_down(-d));
    }
  }

  rows.forEach((r) => {
    r.approximate = approximate && IMPACT_DEPENDENT.has(r.id);
  });
  return { checks: rows, planes };
}
