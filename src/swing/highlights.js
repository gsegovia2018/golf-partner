// The drawing that goes with a selected check (design B: "the still leads"). Pure: it turns a
// check row into a few primitives in normalised frame coordinates, which SwingOverlay renders.
//
// Primitives: { t: 'line', a, b, dash? } { t: 'circle', c, r, dash? } (r as a fraction of the
// frame width) { t: 'rect', c, half, dash? } { t: 'dot', c } { t: 'poly', pts, dash? }
// { t: 'label', at, text }. Points are [x, y] normalised to the decoded frame.

import { LM } from './geometry';
import { homeOf } from './checkpointChecks';

/** "10 cm", "7°", "1.8:1", "0.12 H": a check's value as it is shown (D14: in ink). */
export function valueText(check) {
  if (check.value == null) return '';
  switch (check.unit) {
    case '°': return `${check.value}°`;
    case 'cm': return `${check.value} cm`;
    case ':1': return `${check.value}:1`;
    case 'H': return `${check.value} H`;
    case 'of 2': return `${check.value} of 2`;
    default: return `${check.value}${check.unit ? ` ${check.unit}` : ''}`;
  }
}

const signed = (check) => (check.value > 0 ? `+${valueText(check)}` : valueText(check));
const midOf = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const ok = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * @param {object} check  a row of analysis.checks
 * @param {object} ctx  { analysis, poseAt(frame) -> 33 x [x, y, vis] | null, frameOf(key) -> number }
 * @returns {object[]} primitives (possibly empty)
 */
export function highlightFor(check, ctx) {
  const { analysis, poseAt, frameOf } = ctx;
  if (!check || !analysis) return [];
  const club = analysis.clubMarks || {};
  const lm = (key, i) => {
    const row = poseAt(frameOf(key))?.[i];
    return row && ok(row) ? [row[0], row[1]] : null;
  };
  const midLm = (key, a, b) => {
    const p = lm(key, a);
    const q = lm(key, b);
    return p && q ? midOf(p, q) : null;
  };
  const trailHip = analysis.handedness === 'left' ? LM.lHip : LM.rHip;
  const leadAnkle = analysis.handedness === 'left' ? LM.rAnk : LM.lAnk;
  const left = analysis.handedness === 'left';
  const [leadHip, leadKnee, leadSh, leadWr, trailHeel] = left
    ? [LM.rHip, LM.rKnee, LM.rSh, LM.rWr, LM.lHeel]
    : [LM.lHip, LM.lKnee, LM.lSh, LM.lWr, LM.rHeel];
  const hands = (k) => (club[k] && ok(club[k].hands) ? club[k].hands : null);
  const head = (k) => (club[k] && ok(club[k].head) ? club[k].head : null);
  const text = (at, t) => (ok(at) && t ? [{ t: 'label', at: [at[0] + 0.03, at[1]], text: t }] : []);
  const out = [];

  switch (check.id) {
    case 'posture_address':
    case 'spine_loss': {
      const cp = check.id === 'posture_address' ? 'address' : 'impact';
      const hip = midLm(cp, LM.lHip, LM.rHip);
      const sh = midLm(cp, LM.lSh, LM.rSh);
      if (!hip || !sh) return [];
      out.push({ t: 'line', a: hip, b: [hip[0], Math.max(0, hip[1] - 0.3)], dash: true });
      out.push({ t: 'line', a: hip, b: sh });
      if (cp === 'impact') {
        const ah = midLm('address', LM.lHip, LM.rHip);
        const as = midLm('address', LM.lSh, LM.rSh);
        if (ah && as) out.push({ t: 'line', a: hip, b: [hip[0] + as[0] - ah[0], hip[1] + as[1] - ah[1]], dash: true });
      }
      return out.concat(text(sh, check.id === 'spine_loss' ? `${check.value}° lost` : valueText(check)));
    }
    case 'hands_under_shoulders': {
      const sh = midLm('address', LM.lSh, LM.rSh);
      const g = hands('address');
      if (!sh || !g) return [];
      return [
        { t: 'line', a: sh, b: [sh[0], g[1]], dash: true },
        { t: 'line', a: [sh[0], g[1]], b: g },
        ...text(g, signed(check)),
      ];
    }
    case 'waist_bend': {
      const sh = midLm('address', LM.lSh, LM.rSh);
      const hip = midLm('address', LM.lHip, LM.rHip);
      const knee = midLm('address', LM.lKnee, LM.rKnee);
      return sh && hip && knee ? [{ t: 'poly', pts: [sh, hip, knee] }, ...text(hip, valueText(check))] : [];
    }
    case 'back_line': {
      const ear = midLm('address', LM.lEar, LM.rEar);
      const sh = midLm('address', LM.lSh, LM.rSh);
      const hip = midLm('address', LM.lHip, LM.rHip);
      if (!ear || !sh || !hip) return [];
      const ext = [sh[0] + (sh[0] - hip[0]) * 0.6, sh[1] + (sh[1] - hip[1]) * 0.6];
      return [{ t: 'line', a: sh, b: ext, dash: true }, { t: 'poly', pts: [hip, sh, ear] }, ...text(ear, valueText(check))];
    }
    case 'hand_gap': {
      const hip = lm('address', leadHip);
      const knee = lm('address', leadKnee);
      const g = hands('address');
      if (!hip || !knee || !g || knee[1] === hip[1]) return [];
      const x = hip[0] + ((knee[0] - hip[0]) * (g[1] - hip[1])) / (knee[1] - hip[1]);
      return [{ t: 'line', a: hip, b: [x, g[1]], dash: true }, { t: 'line', a: [x, g[1]], b: g }, ...text(g, valueText(check))];
    }
    case 'hands_over_heels': {
      const heel = lm('top', trailHeel);
      const g = hands('top');
      if (!heel || !g) return [];
      return [{ t: 'line', a: heel, b: [heel[0], g[1]], dash: true }, { t: 'rect', c: g, half: 0.018 }, ...text(g, signed(check))];
    }
    case 'lead_arm_shoulder_plane': {
      const ball = analysis.reference?.ball;
      const ts = analysis.reference?.trailShoulder;
      const sh = lm('top', leadSh);
      const wr = lm('top', leadWr);
      if (!ball || !ts || !sh || !wr) return [];
      return [{ t: 'line', a: ball, b: ts, dash: true }, { t: 'line', a: sh, b: wr }, ...text(wr, signed(check))];
    }
    case 'hands_height_impact': {
      const a = hands('address');
      const i = hands('impact');
      if (!a || !i) return [];
      return [
        { t: 'rect', c: [i[0], a[1]], half: 0.018, dash: true },
        { t: 'line', a: [i[0] + 0.04, a[1]], b: [i[0] + 0.04, i[1]] },
        ...text([i[0] + 0.04, (a[1] + i[1]) / 2], signed(check)),
      ];
    }
    case 'hands_out_impact': {
      const a = hands('address');
      const i = hands('impact');
      if (!a || !i) return [];
      return [
        { t: 'line', a: [a[0], i[1]], b: i },
        { t: 'dot', c: [a[0], i[1]] },
        ...text(midOf([a[0], i[1]], i), signed(check)),
      ];
    }
    case 'head_drift': {
      const n = lm('address', LM.nose);
      return n ? [{ t: 'circle', c: n, r: 0.04, dash: true }, ...text([n[0] + 0.03, n[1] - 0.04], valueText(check))] : [];
    }
    case 'hip_drift': {
      const a = lm('address', trailHip);
      const i = lm('impact', trailHip);
      if (!a || !i) return [];
      return [
        { t: 'line', a: [a[0], a[1] - 0.12], b: [a[0], a[1] + 0.12], dash: true },
        { t: 'line', a: [a[0], i[1]], b: i },
        ...text(i, valueText(check)),
      ];
    }
    case 'shaft_angle_impact': {
      const ah = hands('address');
      const ac = head('address');
      const ih = hands('impact');
      if (!ah || !ac || !ih) return [];
      return [
        { t: 'line', a: ih, b: [ih[0] + ac[0] - ah[0], ih[1] + ac[1] - ah[1]], dash: true },
        ...text([ih[0] - 0.3, ih[1] + 0.06], `${signed(check)} vs address`),
      ];
    }
    case 'clubhead_vs_plane': {
      const h = head(check.cp);
      return h ? [{ t: 'circle', c: h, r: 0.03 }, ...text(h, signed(check))] : [];
    }
    case 'butt_extension': {
      const h = head('leadArm');
      const g = hands('leadArm');
      const ball = analysis.reference?.ball;
      if (!h || !g || !ball || g[1] === h[1]) return [];
      const t = (ball[1] - h[1]) / (g[1] - h[1]);
      const hit = [h[0] + (g[0] - h[0]) * t, ball[1]];
      return [{ t: 'line', a: h, b: hit, dash: true }, { t: 'dot', c: hit }, ...text([hit[0] - 0.3, hit[1] + 0.04], signed(check))];
    }
    case 'top_direction': {
      const h = hands('top');
      const c = head('top');
      if (!h || !c) return [];
      return [{ t: 'line', a: h, b: c }, ...text(h, check.dir === 'across' ? 'crossed' : check.dir === 'laid_off' ? 'laid off' : 'on line')];
    }
    case 'downswing_path': {
      const pts = ['address', 'takeaway', 'leadArm', 'top'].map(hands).filter(Boolean);
      const sd = hands('shaftDown');
      return pts.length > 1 ? [{ t: 'poly', pts, dash: true }, ...(sd ? text(sd, signed(check)) : [])] : [];
    }
    case 'finish_balance': {
      const a = lm('finish', leadAnkle);
      return a ? [{ t: 'line', a: [a[0], Math.max(0, a[1] - 0.4)], b: a, dash: true }] : [];
    }
    default: {
      const h = hands(homeOf(check));
      return h ? text(h, valueText(check)) : [];
    }
  }
}
