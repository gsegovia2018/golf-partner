// The 15 check rows (plan 5.4; 14 ids, clubhead_vs_plane is evaluated at pre-impact and at
// impact), ported from the swing lab's editor/checks.js that the owner reviewed in a UI.
//
// Everything is mirrored internally so the golfer is right-handed with the ball on the +x
// side; left-handers are mirrored around ball.x (R10). Coordinates are pixels, y down.
// A check never fails the swing for a clubhead nobody has placed: it returns 'unknown'.

import {
  LM, angleAboveHorizontal, sideOfLine, extendToY, spineTiltDeg, mid, trailShoulder,
} from './geometry';
import { SWING_STRINGS as T } from './strings';

const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);
const has = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const band = (v, g, y) => (v <= g ? 'green' : v <= y ? 'yellow' : 'red');
const FINISH_QUIET_S = 0.4;
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
 *   the twelve checkpoints, keyed address ... finish plus lateBackswing / preImpact / postImpact
 * @param {{x:number,y:number}|null} input.ball
 * @param {(frame:number)=>number[][]|null} input.pose  raw landmarks (33 x [x, y, vis], px) at a frame
 * @param {'right'|'left'} [input.handedness]
 * @param {number} input.pxPerCm
 * @param {number} input.heightCm
 * @param {number} [input.motionStart]  frame; tempo's backswing starts here (D10), takeaway if absent
 * @param {number} [input.finishQuietS]  seconds the golfer stays still after the finish
 * @param {boolean} [input.approximate]  effective fps < 100 or interpolated slow-mo
 * @returns {{checks: object[], planes: object}}
 */
export function runChecks(input) {
  const { checkpoints: cps = {}, ball, pose, handedness = 'right', pxPerCm, heightCm } = input;
  const approximate = !!input.approximate;
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
    if (t === null) rows.push(unknown(m, 'nopose', T.reason.nopose('the address frame')));
    else {
      const s = t >= 25 && t <= 40 ? 'green' : (t >= 20 && t < 25) || (t > 40 && t <= 45) ? 'yellow' : 'red';
      push(m, s, round(t, 0), '°', T.checkText.posture_address(t));
    }
  }

  // hands_between_planes (worst of leadArm, top)
  {
    const m = M('hands_between_planes', 'backswing', ['leadArm', 'top']);
    if (!planes.shaft || !planes.shoulder) rows.push(unknown(m, 'nopose', T.reason.nopose('the address frame (shoulder plane)')));
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
      if (!worst) rows.push(unknown(m, 'nodata', T.reason.nodata('No lead arm / top marks')));
      else {
        const s = worst.ex <= 0 ? 'green' : worst.ex <= 4 ? 'yellow' : 'red';
        push(m, s, round(Math.max(0, worst.ex), 0), 'cm',
          s === 'green' ? T.checkText.hands_between_planes_ok : T.checkText.hands_between_planes(worst.ex, worst.dir, T.checkpoint[worst.k].toLowerCase()),
          { dir: worst.dir });
      }
    }
  }

  // butt_extension (leadArm)
  {
    const m = M('butt_extension', 'backswing', ['leadArm']);
    const c = C.leadArm;
    if (!c) rows.push(unknown(m, 'nodata', T.reason.nodata('No lead arm mark')));
    else if (!c.head || !ball) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, 'lead arm parallel')));
    else {
      const x = extendToY(c.head, c.hands, ball.y);
      if (x === null) rows.push(unknown(m, 'nodata', T.reason.nodata('Shaft is horizontal')));
      else {
        const toeL = lm('address', LM.lToe);
        const toeR = lm('address', LM.rToe);
        const toes = toeL && toeR ? (toeL.x + toeR.x) / 2 : toeL?.x ?? toeR?.x ?? null;
        const span = toes !== null && toes < ball.x ? bx - toes : 0;
        const margin = 0.1 * span;
        const beyond = (x - bx - margin) * cm; // + = beyond the ball (flat)
        const inside = toes !== null && span ? (toes + margin - x) * cm : -Infinity; // + = inside the toes (steep)
        let s = 'green';
        let dir = null;
        let text = T.checkText.butt_extension_ok;
        if (beyond > 0) {
          dir = 'flat';
          s = beyond <= 15 ? 'yellow' : 'red';
          text = T.checkText.butt_extension_flat(beyond);
        } else if (inside > 0) {
          dir = 'steep';
          s = inside <= 15 ? 'yellow' : 'red';
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
    if (!c) rows.push(unknown(m, 'nodata', T.reason.nodata('No top mark')));
    else if (!c.head) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, 'the top')));
    else {
      const dx = (c.head.x - c.hands.x) / H;
      const s = Math.abs(dx) <= 0.08 ? 'green' : 'yellow';
      push(m, s, round(dx, 2), 'H',
        s === 'green' ? T.checkText.top_direction_ok : dx > 0 ? T.checkText.top_direction_across : T.checkText.top_direction_laid_off,
        { dir: dx > 0 ? 'across' : 'laid_off' });
    }
  }

  // downswing_path: shaftDown hands vs the backswing hand path at the same height
  {
    const m = M('downswing_path', 'transition', ['shaftDown']);
    const c = C.shaftDown;
    const path = ['address', 'takeaway', 'leadArm', 'top'].map((k) => C[k]?.hands).filter(Boolean);
    if (!c) rows.push(unknown(m, 'nodata', T.reason.nodata('No shaft-down mark')));
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
      if (bxAt === null) rows.push(unknown(m, 'nodata', T.reason.nodata('Hands outside the backswing height range')));
      else {
        const outCm = (c.hands.x - bxAt) * cm; // + = outside / toward the ball
        const s = outCm <= 3 ? 'green' : outCm <= 6 ? 'yellow' : 'red';
        push(m, s, round(outCm, 0), 'cm', s === 'green' ? T.checkText.downswing_path_ok : T.checkText.downswing_path(outCm));
      }
    }
  }

  // clubhead_vs_plane at pre-impact and at impact
  ['preImpact', 'impact'].forEach((k) => {
    const m = M('clubhead_vs_plane', 'impact', [k], { cp: k });
    const c = C[k];
    if (!c) rows.push(unknown(m, 'nodata', T.reason.nodata(`No ${T.checkpoint[k].toLowerCase()} mark`)));
    else if (!c.head) rows.push(unknown(m, c.unplaced ? 'unplaced' : 'hidden', headMissing(c, T.checkpoint[k].toLowerCase())));
    else if (!planes.shaft) rows.push(unknown(m, 'nodata', T.reason.nodata('No address plane')));
    else {
      const d = sideOfLine(c.head, planes.shaft.a, planes.shaft.b) * cm;
      const s = Math.abs(d) <= 4 ? 'green' : d > 4 && d <= 8 ? 'yellow' : d < -4 ? 'yellow' : 'red';
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
    if (!a || !i) rows.push(unknown(m, 'nodata', T.reason.nodata('Needs address and impact')));
    else {
      const d = (a.hands.y - i.hands.y) * cm;
      push(m, band(d, 5, 8), round(d, 0), 'cm', d > 0 ? T.checkText.hands_height_impact_up(d) : T.checkText.hands_height_impact_down(-d));
    }
  }

  // hands_out_impact (D11)
  {
    const m = M('hands_out_impact', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address;
    const i = C.impact;
    if (!a || !i) rows.push(unknown(m, 'nodata', T.reason.nodata('Needs address and impact')));
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
    if (!a || !i) rows.push(unknown(m, 'nodata', T.reason.nodata('Needs address and impact')));
    else if (!a.head || !i.head) {
      rows.push(unknown(m, a.unplaced || i.unplaced ? 'unplaced' : 'hidden', headMissing(a.head ? i : a, a.head ? 'impact' : 'address')));
    } else {
      const d = angleAboveHorizontal(i.head, i.hands) - angleAboveHorizontal(a.head, a.hands);
      push(m, band(d, 6, 10), round(d, 0), '°', d >= 0 ? T.checkText.shaft_angle_impact_up(d) : T.checkText.shaft_angle_impact_down(-d));
    }
  }

  // spine_loss
  {
    const m = M('spine_loss', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const ta = tiltOf('address');
    const ti = tiltOf('impact');
    if (ta === null || ti === null) rows.push(unknown(m, 'nopose', T.reason.nopose('address and impact')));
    else {
      const loss = ta - ti;
      push(m, band(loss, 3, 6), round(loss, 0), '°', T.checkText.spine_loss(ta, ti, loss));
    }
  }

  // hip_drift
  {
    const m = M('hip_drift', 'impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = lm('address', hipIdx);
    const i = lm('impact', hipIdx);
    if (!a || !i) rows.push(unknown(m, 'nopose', T.reason.nopose('address and impact')));
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
    if (!a || !i) rows.push(unknown(m, 'nopose', T.reason.nopose('address and impact')));
    else {
      const d = Math.hypot(i.x - a.x, i.y - a.y) * cm;
      push(m, band(d, 5, 10), round(d, 0), 'cm', T.checkText.head_drift(d));
    }
  }

  // tempo: backswing (motionStart -> top) : downswing (top -> impact), D9 and D10
  {
    const m = M('tempo', 'transition', ['top', 'impact']);
    const start = input.motionStart ?? cps.takeaway?.frame;
    const tp = cps.top?.frame;
    const im = cps.impact?.frame;
    if (start == null || tp == null || im == null || im <= tp || tp <= start) rows.push(unknown(m, 'nodata', T.reason.nodata('Needs the start of the swing, top and impact in order')));
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
    if (!hl || !hr || !ank || input.finishQuietS == null) rows.push(unknown(m, 'nopose', T.reason.nopose('the finish frame')));
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

