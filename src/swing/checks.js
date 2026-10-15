// The 15 check rows (plan 5.4; 14 ids, clubhead_vs_plane is evaluated at pre-impact and at
// impact), ported from the swing lab's editor/checks.js that the owner reviewed in a UI.
//
// Everything is mirrored internally so the golfer is right-handed with the ball on the +x
// side; left-handers are mirrored around ball.x (R10). Coordinates are pixels, y down.
// A check never fails the swing for a clubhead nobody has placed: it returns 'unknown'.

import {
  LM, angleAboveHorizontal, angleBetween, sideOfLine, extendToY, spineTiltDeg, mid, trailShoulder,
} from './geometry';
import { SWING_STRINGS as T } from './strings';
import { t } from '../i18n';

const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);
const has = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const band = (v, g, y) => (v <= g ? 'green' : v <= y ? 'yellow' : 'red');
const FINISH_QUIET_S = 0.4;

// Per-club limits (plan 5.4, D19). Exactly two clubs; 'iron' is the default and the reading
// for every swing saved before the picker existed. Iron values are the owner-reviewed ones.
// PROVISIONAL: the driver values are starting points set on 2026-10-12, to be calibrated on
// real driver swings. Each `band: [green, yellow]` is "<= green is green, <= yellow is yellow,
// else red". Every check not listed here is the same for both clubs.
export const CLUBS = ['iron', 'driver'];
// The setup and top-position checks (D21). PROVISIONAL 2026-10-12: the same values for both
// clubs until real swings say otherwise.
const SETUP_TOP = {
  handsUnderShoulders: [4, 8], // cm, |grip x - shoulder-midpoint x|
  waistBend: { green: [125, 145], yellow: [115, 155] }, // degrees at the hip, torso vs thigh
  backLine: [10, 20], // degrees between ear->shoulder and shoulder->hip
  handGap: { green: [10, 20], yellow: [6, 25] }, // cm, grip to the lead thigh line
  handsOverHeels: [6, 12], // cm, |grip x - trail heel x| at the top
  leadArmPlane: [10, 20], // degrees between the lead arm and the address shoulder plane
};
export const DEFAULT_CLUB = 'iron';
export const THRESHOLDS = {
  iron: {
    posture: { green: [25, 40], yellow: [20, 45] }, // spine tilt from vertical, degrees
    handsHeight: [5, 8], // cm
    shaftAngle: [6, 10], // degrees
    spineLoss: [3, 6], // degrees
    clubheadPlane: { green: 4, yellow: 8 }, // cm; yellow also below -green
    buttYellowCm: 15,
    headDrift: [5, 10], // cm
    shaftThroughYellowCm: 15, // D23, PROVISIONAL: P8 shaft line beyond the ball, yellow up to this
    ...SETUP_TOP,
  },
  driver: {
    posture: { green: [20, 35], yellow: [15, 40] },
    handsHeight: [8, 12],
    shaftAngle: [8, 12],
    spineLoss: [4, 7],
    clubheadPlane: { green: 6, yellow: 10 },
    buttYellowCm: 20,
    headDrift: [6, 12],
    shaftThroughYellowCm: 15, // D23: the iron value until driver swings say otherwise
    ...SETUP_TOP,
  },
};

/** 'iron' | 'driver'; anything else (null, undefined, an old 'wood') reads as the default. */
export const normClub = (club) => (CLUBS.includes(club) ? club : DEFAULT_CLUB);
const FINISH_BALANCE_H = 0.08; // mid-hip x within 0.08 H of the lead ankle x

// Checks whose value depends on the impact frame inherit `approximate` from the fps model.
const IMPACT_DEPENDENT = new Set([
  'clubhead_vs_plane', 'hands_height_impact', 'hands_out_impact', 'shaft_angle_impact', 'spine_loss',
  'hip_drift', 'head_drift', 'tempo',
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
 * @param {Object<string,{frame:number,hands:{x,y},head:{x,y}|null,hidden:boolean,source?:string}>} input.checkpoints
 *   the thirteen checkpoints, keyed address ... finish plus lateBackswing / preImpact / postImpact
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

  const cp = (k) => {
    const c = cps[k];
    if (!c || !has(c.hands)) return null;
    return {
      frame: c.frame, hands: mp(c.hands), head: c.hidden || !has(c.head) ? null : mp(c.head), hidden: !!c.hidden, unplaced: c.source === 'prior',
    };
  };
  const C = Object.fromEntries(Object.keys(cps).map((k) => [k, cp(k)]));
  const lm = (k, i) => {
    const c = cps[k];
    const f = c && pose?.(c.frame);
    const p = f?.[i];
    return p && Number.isFinite(p[0]) ? { x: mx(p[0]), y: p[1] } : null;
  };
  const hipIdx = handedness === 'left' ? LM.lHip : LM.rHip;
  const leadAnkIdx = handedness === 'left' ? LM.rAnk : LM.lAnk;
  const planes = getPlanes(input);
  const rows = [];
  const M = (id, phase, cpsList, extra = {}) => ({ id, label: T.checkLabel[id], phase, cps: cpsList, ...extra });
  const unknown = (m, reason, text) => ({ ...m, status: 'unknown', value: null, unit: null, reason, text });
  const at = (name) => t(`misc.swing.at.${name}`);
  const why = (name, params) => T.reason.nodata(t(`misc.swing.why.${name}`, params));
  const headMissing = (c, where) => (c.unplaced ? T.reason.unplaced(where) : T.reason.hidden(where));
  const push = (m, status, value, unit, text, extra = {}) => rows.push({ ...m, status, value, unit, text, ...extra });
  const tiltOf = (k) => {
    const a = [lm(k, LM.lSh), lm(k, LM.rSh), lm(k, LM.lHip), lm(k, LM.rHip)];
    return a.some((p) => !p) ? null : spineTiltDeg(mid(a[2], a[3]), mid(a[0], a[1]));
  };

  // posture_address
  {
    const m = M('posture_address', 'setup', ['address']);
    const t = tiltOf('address');
    if (t === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const { green: [gLo, gHi], yellow: [yLo, yHi] } = TH.posture;
      const s = t >= gLo && t <= gHi ? 'green' : t >= yLo && t <= yHi ? 'yellow' : 'red';
      push(m, s, round(t, 0), '°', T.checkText.posture_address(t, gLo, gHi));
    }
  }

  // Setup (D21): four pose readings at address, all in mirrored px (ball on +x).
  const midLm = (k, a, b) => {
    const p = lm(k, a);
    const q = lm(k, b);
    return p && q ? mid(p, q) : null;
  };
  const sym = (v, [g, y]) => band(Math.abs(v), g, y);
  const range = (v, { green: [gLo, gHi], yellow: [yLo, yHi] }) => (v >= gLo && v <= gHi ? 'green' : v >= yLo && v <= yHi ? 'yellow' : 'red');
  const leadHipIdx = handedness === 'left' ? LM.rHip : LM.lHip;
  const leadKneeIdx = handedness === 'left' ? LM.rKnee : LM.lKnee;
  const trailHeelIdx = handedness === 'left' ? LM.lHeel : LM.rHeel;
  const trailShIdx = handedness === 'left' ? LM.lSh : LM.rSh;
  const leadShIdx = handedness === 'left' ? LM.rSh : LM.lSh;
  const leadWrIdx = handedness === 'left' ? LM.rWr : LM.lWr;

  // hands_under_shoulders: grip vs the shoulder midpoint along the target-line normal (+ = out toward the ball)
  {
    const m = M('hands_under_shoulders', 'setup', ['address']);
    const sh = midLm('address', LM.lSh, LM.rSh);
    const a = C.address;
    if (!sh || !a) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const d = (a.hands.x - sh.x) * cm;
      const s = sym(d, TH.handsUnderShoulders);
      push(m, s, round(d, 0), 'cm', s === 'green' ? T.checkText.hands_under_shoulders_ok : d > 0 ? T.checkText.hands_under_shoulders_out(d) : T.checkText.hands_under_shoulders_in(-d),
        { dir: d > 0 ? 'out' : 'in' });
    }
  }

  // waist_bend: the angle at the hip between the torso (hip -> shoulder) and the thigh (hip -> knee)
  {
    const m = M('waist_bend', 'setup', ['address']);
    const hip = midLm('address', LM.lHip, LM.rHip);
    const sh = midLm('address', LM.lSh, LM.rSh);
    const knee = midLm('address', LM.lKnee, LM.rKnee);
    const ang = hip && sh && knee ? angleBetween({ x: sh.x - hip.x, y: sh.y - hip.y }, { x: knee.x - hip.x, y: knee.y - hip.y }) : null;
    if (ang === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const s = range(ang, TH.waistBend);
      // A smaller angle is more bend: 'over' = bent over too far, 'tall' = too upright.
      const dir = s === 'green' ? null : ang < (TH.waistBend.green[0] + TH.waistBend.green[1]) / 2 ? 'over' : 'tall';
      push(m, s, round(ang, 0), '°', T.checkText.waist_bend(ang, dir), { dir });
    }
  }

  // back_line: ear -> shoulder against shoulder -> hip; 0 = one straight line from the hips to the head
  {
    const m = M('back_line', 'setup', ['address']);
    const ear = midLm('address', LM.lEar, LM.rEar);
    const sh = midLm('address', LM.lSh, LM.rSh);
    const hip = midLm('address', LM.lHip, LM.rHip);
    if (!ear || !sh || !hip) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const ang = angleBetween({ x: sh.x - hip.x, y: sh.y - hip.y }, { x: ear.x - sh.x, y: ear.y - sh.y });
      // Which side of the hip -> shoulder line the ear sits: + = toward the ball / down (head dropped).
      const side = (sh.x - hip.x) * (ear.y - sh.y) - (sh.y - hip.y) * (ear.x - sh.x);
      const dir = side > 0 ? 'dropped' : 'up';
      const s = band(ang, ...TH.backLine);
      push(m, s, round(ang, 0), '°', s === 'green' ? T.checkText.back_line_ok : T.checkText.back_line(ang, dir), { dir });
    }
  }

  // hand_gap: grip to the lead thigh line (hip -> knee, extended to the grip's height), toward the ball
  {
    const m = M('hand_gap', 'setup', ['address']);
    const hip = lm('address', leadHipIdx);
    const knee = lm('address', leadKneeIdx);
    const a = C.address;
    const x = a && hip && knee ? extendToY(hip, knee, a.hands.y) : null;
    if (x === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('address'))));
    else {
      const d = (a.hands.x - x) * cm;
      const s = range(d, TH.handGap);
      const close = d < (TH.handGap.green[0] + TH.handGap.green[1]) / 2;
      push(m, s, round(d, 0), 'cm', s === 'green' ? T.checkText.hand_gap_ok(d) : close ? T.checkText.hand_gap_close(d) : T.checkText.hand_gap_far(d),
        { dir: s === 'green' ? null : close ? 'close' : 'far' });
    }
  }

  // hands_between_planes (worst of leadArm, top)
  {
    const m = M('hands_between_planes', 'backswing', ['leadArm', 'top']);
    if (!planes.shaft || !planes.shoulder) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressShoulder'))));
    else {
      let worst = null;
      ['leadArm', 'top'].forEach((k) => {
        const c = C[k];
        if (!c) return;
        const dShaft = sideOfLine(c.hands, planes.shaft.a, planes.shaft.b) * cm; // + = outside the shaft plane
        const dSh = sideOfLine(c.hands, planes.shoulder.a, planes.shoulder.b) * cm; // + = outside the shoulder plane
        const ex = Math.max(dSh, -dShaft);
        if (!worst || ex > worst.ex) worst = { ex, k, dir: dSh >= -dShaft ? 'steep' : 'flat' };
      });
      if (!worst) rows.push(unknown(m, 'nodata', why('noLeadArmTop')));
      else {
        const s = worst.ex <= 0 ? 'green' : worst.ex <= 4 ? 'yellow' : 'red';
        push(m, s, round(Math.max(0, worst.ex), 0), 'cm',
          s === 'green' ? T.checkText.hands_between_planes_ok : T.checkText.hands_between_planes(worst.ex, worst.dir, T.checkpoint[worst.k].toLowerCase()),
          { dir: worst.dir, at: worst.k });
      }
    }
  }

  // Mid-toe x at address (mirrored), or null.
  const toesX = () => {
    const toeL = lm('address', LM.lToe);
    const toeR = lm('address', LM.rToe);
    return toeL && toeR ? (toeL.x + toeR.x) / 2 : toeL?.x ?? toeR?.x ?? null;
  };

  // butt_extension (leadArm): halfway back, the first leg of steep -> shallow -> steep (D23)
  {
    const m = M('butt_extension', 'backswing', ['leadArm']);
    const c = C.leadArm;
    if (!c) rows.push(unknown(m, 'nodata', why('noLeadArm')));
    else if (!c.head || !ball) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, at('leadArmParallel'))));
    else {
      const x = extendToY(c.head, c.hands, ball.y);
      if (x === null) rows.push(unknown(m, 'nodata', why('shaftHorizontal')));
      else {
        const toes = toesX();
        const span = toes !== null && toes < ball.x ? bx - toes : 0;
        const margin = 0.1 * span;
        const beyond = (x - bx - margin) * cm; // + = beyond the ball (flat)
        const inside = toes !== null && span ? (toes + margin - x) * cm : -Infinity; // + = inside the toes (steep)
        let s = 'green';
        let dir = null;
        let text = T.checkText.butt_extension_ok;
        if (beyond > 0) {
          dir = 'flat';
          s = beyond <= TH.buttYellowCm ? 'yellow' : 'red';
          text = T.checkText.butt_extension_flat(beyond);
        } else if (inside > 0) {
          dir = 'steep';
          s = inside <= TH.buttYellowCm ? 'yellow' : 'red';
          text = T.checkText.butt_extension_steep(inside);
        }
        push(m, s, round((x - bx) * cm, 0), 'cm', text, { dir });
      }
    }
  }

  // top_direction (never red)
  {
    const m = M('top_direction', 'backswing', ['top']);
    const c = C.top;
    if (!c) rows.push(unknown(m, 'nodata', why('noTop')));
    else if (!c.head) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, at('top'))));
    else {
      const dx = (c.head.x - c.hands.x) / H;
      const s = Math.abs(dx) <= 0.08 ? 'green' : 'yellow';
      push(m, s, round(dx, 2), 'H',
        s === 'green' ? T.checkText.top_direction_ok : dx > 0 ? T.checkText.top_direction_across : T.checkText.top_direction_laid_off,
        { dir: dx > 0 ? 'across' : 'laid_off' });
    }
  }

  // hands_over_heels (D21): grip x vs the trail heel at the top (+ = toward the ball)
  {
    const m = M('hands_over_heels', 'backswing', ['top']);
    const c = C.top;
    const heel = lm('top', trailHeelIdx);
    if (!c) rows.push(unknown(m, 'nodata', why('noTop')));
    else if (!heel) rows.push(unknown(m, 'nopose', T.reason.nopose(at('top'))));
    else {
      const d = (c.hands.x - heel.x) * cm;
      const s = sym(d, TH.handsOverHeels);
      push(m, s, round(d, 0), 'cm', s === 'green' ? T.checkText.hands_over_heels_ok : d < 0 ? T.checkText.hands_over_heels_deep(-d) : T.checkText.hands_over_heels_shallow(d),
        { dir: d < 0 ? 'deep' : 'shallow' });
    }
  }

  // lead_arm_shoulder_plane (D21): the lead arm (shoulder -> wrist) at the top against the
  // address shoulder plane (ball -> trail shoulder), both as lines in the 2D down-the-line image.
  {
    const m = M('lead_arm_shoulder_plane', 'backswing', ['top']);
    const sh = lm('top', leadShIdx);
    const wr = lm('top', leadWrIdx);
    const trail = lm('address', trailShIdx);
    if (!ball || !trail) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressShoulder'))));
    else if (!sh || !wr) rows.push(unknown(m, 'nopose', T.reason.nopose(at('top'))));
    else {
      // Angles of the two lines measured from the -x axis (away from the ball), counter-clockwise
      // in the image (y up), so "more" means a more upright line.
      const up = (p, q) => (Math.atan2(-(q.y - p.y), -(q.x - p.x)) * 180) / Math.PI;
      const plane = up({ x: mx(ball.x), y: ball.y }, trail);
      const arm = up(sh, wr);
      const d = arm - plane; // + = above the plane (more upright)
      const s = sym(d, TH.leadArmPlane);
      push(m, s, round(d, 0), '°', s === 'green' ? T.checkText.lead_arm_shoulder_plane_ok : d > 0 ? T.checkText.lead_arm_shoulder_plane_above(d) : T.checkText.lead_arm_shoulder_plane_below(-d),
        { dir: d > 0 ? 'above' : 'below' });
    }
  }

  // downswing_path: shaftDown hands vs the backswing hand path at the same height
  {
    const m = M('downswing_path', 'transition', ['shaftDown']);
    const c = C.shaftDown;
    const path = ['address', 'takeaway', 'leadArm', 'top'].map((k) => C[k]?.hands).filter(Boolean);
    if (!c) rows.push(unknown(m, 'nodata', why('noShaftDown')));
    else {
      let bxAt = null;
      for (let i = 0; i < path.length - 1; i++) {
        const p = path[i];
        const q = path[i + 1];
        if (c.hands.y >= Math.min(p.y, q.y) && c.hands.y <= Math.max(p.y, q.y) && p.y !== q.y) {
          bxAt = p.x + ((q.x - p.x) * (c.hands.y - p.y)) / (q.y - p.y);
          break;
        }
      }
      if (bxAt === null) rows.push(unknown(m, 'nodata', why('handsOutOfRange')));
      else {
        const outCm = (c.hands.x - bxAt) * cm; // + = outside / toward the ball
        const s = outCm <= 3 ? 'green' : outCm <= 6 ? 'yellow' : 'red';
        push(m, s, round(outCm, 0), 'cm', s === 'green' ? T.checkText.downswing_path_ok : T.checkText.downswing_path(outCm));
      }
    }
  }

  // The shaft line (grip -> clubhead) extended to ball height (D23): where it lands against the
  // ball and the toes. Returns null with an 'unknown' row pushed when it cannot be read.
  const shaftLanding = (m, k, where) => {
    const c = C[k];
    if (!c) rows.push(unknown(m, 'nodata', why('noMark', { what: where })));
    else if (!c.head || !ball) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, where)));
    else {
      const x = extendToY(c.hands, c.head, ball.y);
      const toes = toesX();
      if (x === null || toes === null || toes >= bx) rows.push(unknown(m, 'nodata', why('shaftHorizontal')));
      else return { x, toes, cmFromBall: (x - bx) * cm };
    }
    return null;
  };

  // shaft_down_shallow (shaftDown, P6): beyond the ball = shallow; toes..ball = watch; inside the toes = steep (over the top)
  {
    const m = M('shaft_down_shallow', 'transition', ['shaftDown']);
    const r = shaftLanding(m, 'shaftDown', T.checkpoint.shaftDown.toLowerCase());
    if (r) {
      const where = r.x > bx ? 'shallow' : r.x >= r.toes ? 'between' : 'steep';
      const s = where === 'shallow' ? 'green' : where === 'between' ? 'yellow' : 'red';
      push(m, s, round(r.cmFromBall, 0), 'cm', T.checkText.shaft_down_shallow[where](r.cmFromBall), { dir: where === 'shallow' ? 'shallow' : 'steep' });
    }
  }

  // shaft_through_steep (shaftThrough, P8): between the toes and the ball, or a little inside = steep again (good);
  // beyond the ball = flat through impact (a flip)
  {
    const m = M('shaft_through_steep', 'impact', ['shaftThrough']);
    const r = shaftLanding(m, 'shaftThrough', T.checkpoint.shaftThrough.toLowerCase());
    if (r) {
      const beyond = r.cmFromBall;
      const s = beyond <= 0 ? 'green' : beyond <= TH.shaftThroughYellowCm ? 'yellow' : 'red';
      push(m, s, round(beyond, 0), 'cm', s === 'green' ? T.checkText.shaft_through_steep_ok(-beyond) : T.checkText.shaft_through_steep_flat(beyond),
        { dir: s === 'green' ? 'steep' : 'flat' });
    }
  }

  // clubhead_vs_plane at pre-impact and at impact
  ['preImpact', 'impact'].forEach((k) => {
    const m = M('clubhead_vs_plane', 'impact', [k], { cp: k });
    const c = C[k];
    if (!c) rows.push(unknown(m, 'nodata', why('noMark', { what: T.checkpoint[k].toLowerCase() })));
    else if (!c.head) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, T.checkpoint[k].toLowerCase())));
    else if (!planes.shaft) rows.push(unknown(m, 'nodata', why('noAddressPlane')));
    else {
      const d = sideOfLine(c.head, planes.shaft.a, planes.shaft.b) * cm;
      const { green: g, yellow: y } = TH.clubheadPlane;
      const s = Math.abs(d) <= g ? 'green' : d > g && d <= y ? 'yellow' : d < -g ? 'yellow' : 'red';
      push(m, s, round(d, 0), 'cm',
        s === 'green' ? T.checkText.clubhead_vs_plane_ok : d > 0 ? T.checkText.clubhead_vs_plane_steep(d) : T.checkText.clubhead_vs_plane_under(-d),
        { dir: d > 0 ? 'steep' : 'under' });
    }
  });

  // hands_height_impact
  {
    const m = M('hands_height_impact', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', why('needsAddressImpact')));
    else {
      const d = (a.hands.y - i.hands.y) * cm;
      push(m, band(d, ...TH.handsHeight), round(d, 0), 'cm', d > 0 ? T.checkText.hands_height_impact_up(d) : T.checkText.hands_height_impact_down(-d));
    }
  }

  // hands_out_impact (D11)
  {
    const m = M('hands_out_impact', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', why('needsAddressImpact')));
    else {
      const d = (i.hands.x - a.hands.x) * cm;
      push(m, band(d, 4, 8), round(d, 0), 'cm', d > 0 ? T.checkText.hands_out_impact_in(d) : T.checkText.hands_out_impact_out(-d));
    }
  }

  // shaft_angle_impact
  {
    const m = M('shaft_angle_impact', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', why('needsAddressImpact')));
    else if (!a.head || !i.head) {
      rows.push(unknown(m, a.unplaced || i.unplaced ? 'unplaced' : 'hidden', headMissing(a.head ? i : a, a.head ? at('impact') : at('address'))));
    } else {
      const d = angleAboveHorizontal(i.head, i.hands) - angleAboveHorizontal(a.head, a.hands);
      push(m, band(d, ...TH.shaftAngle), round(d, 0), '°', d >= 0 ? T.checkText.shaft_angle_impact_up(d) : T.checkText.shaft_angle_impact_down(-d));
    }
  }

  // spine_loss
  {
    const m = M('spine_loss', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const ta = tiltOf('address');
    const ti = tiltOf('impact');
    if (ta === null || ti === null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressImpact'))));
    else {
      const loss = ta - ti;
      push(m, band(loss, ...TH.spineLoss), round(loss, 0), '°', T.checkText.spine_loss(ta, ti, loss));
    }
  }

  // hip_drift
  {
    const m = M('hip_drift', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = lm('address', hipIdx);
    const i = lm('impact', hipIdx);
    if (!a || !i) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressImpact'))));
    else {
      const d = (i.x - a.x) * cm;
      push(m, band(d, 3, 6), round(d, 0), 'cm', T.checkText.hip_drift(d));
    }
  }

  // head_drift
  {
    const m = M('head_drift', 'impact', ['address', 'impact']);
    const a = lm('address', LM.nose);
    const i = lm('impact', LM.nose);
    if (!a || !i) rows.push(unknown(m, 'nopose', T.reason.nopose(at('addressImpact'))));
    else {
      const d = Math.hypot(i.x - a.x, i.y - a.y) * cm;
      push(m, band(d, ...TH.headDrift), round(d, 0), 'cm', T.checkText.head_drift(d));
    }
  }

  // tempo: backswing (motionStart -> top) : downswing (top -> impact), D9 and D10
  {
    const m = M('tempo', 'transition', ['top', 'impact']);
    const start = input.motionStart ?? cps.takeaway?.frame;
    const tp = cps.top?.frame;
    const im = cps.impact?.frame;
    if (start == null || tp == null || im == null || im <= tp || tp <= start) rows.push(unknown(m, 'nodata', why('needsOrder')));
    else {
      const r = round((tp - start) / (im - tp), 1); // judged at the precision shown
      let s;
      let dir = null;
      if (r >= 2.5 && r <= 3.5) s = 'green';
      else if (r < 2.5) {
        s = r < 1.6 ? 'red' : 'yellow';
        dir = 'fast';
      } else {
        s = r <= 4.5 ? 'yellow' : 'red';
        dir = 'slow';
      }
      push(m, s, r, ':1', T.checkText.tempo(tp - start, im - tp, r), { dir });
    }
  }

  // finish_balance: still for 0.4 s and the mid-hip over the lead ankle
  {
    const m = M('finish_balance', 'finish', ['finish']);
    const hl = lm('finish', LM.lHip);
    const hr = lm('finish', LM.rHip);
    const ank = lm('finish', leadAnkIdx);
    if (!hl || !hr || !ank || input.finishQuietS == null) rows.push(unknown(m, 'nopose', T.reason.nopose(at('finish'))));
    else {
      const quiet = input.finishQuietS >= FINISH_QUIET_S;
      const balanced = Math.abs(mid(hl, hr).x - ank.x) <= FINISH_BALANCE_H * H;
      const s = quiet && balanced ? 'green' : quiet || balanced ? 'yellow' : 'red';
      push(m, s, (quiet ? 1 : 0) + (balanced ? 1 : 0), 'of 2', T.checkText.finish_balance(quiet, balanced));
    }
  }

  rows.forEach((r) => {
    r.approximate = approximate && IMPACT_DEPENDENT.has(r.id);
  });
  return { checks: rows, planes };
}

