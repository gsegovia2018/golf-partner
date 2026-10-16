// The drawing that goes with a selected check (design B: "the still leads"). Pure: it turns a
// check row into a few primitives in normalised frame coordinates, which SwingOverlay renders.
//
// Primitives: { t: 'line', a, b, dash? } { t: 'circle', c, r, dash? } (r as a fraction of the
// frame width) { t: 'rect', c, half, dash? } { t: 'dot', c } { t: 'poly', pts, dash? }
// { t: 'label', at, text }. Points are [x, y] normalised to the decoded frame.
// `role: 'target'` marks the reference (where it should be); everything else is the golfer's own.

import { LM } from './geometry';
import { homeOf } from './checkpointChecks';
import { t } from '../i18n';

/** "10 cm", "7°", "1.8:1", "0.12 H": a check's value as it is shown (D14: in ink). */
export function valueText(check) {
  if (check.value == null) return '';
  switch (check.unit) {
    case '°': return `${check.value}°`;
    case 'cm': return `${check.value} cm`;
    case ':1': return `${check.value}:1`;
    case 'H': return `${check.value} H`;
    case 'of 2': return t('swing.value.ofTwo', { n: check.value });
    default: return `${check.value}${check.unit ? ` ${check.unit}` : ''}`;
  }
}

const signed = (check) => (check.value > 0 ? `+${valueText(check)}` : valueText(check));
const midOf = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const ok = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Where the ray a -> b leaves the frame (normalised), so a plane runs to the edge of the picture. */
export function extendToEdge(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = [
    dx < 0 ? (0 - a[0]) / dx : dx > 0 ? (1 - a[0]) / dx : Infinity,
    dy < 0 ? (0 - a[1]) / dy : dy > 0 ? (1 - a[1]) / dy : Infinity,
  ].reduce((m, v) => (v > 0 && v < m ? v : m), Infinity);
  return Number.isFinite(t) ? [a[0] + dx * t, a[1] + dy * t] : b;
}

// The helpers every drawing shares: the golfer's lines to the ground, and the references.
function toolkit(ctx) {
  const { analysis, poseAt, frameOf } = ctx;
  const club = analysis.clubMarks || {};
  const ref = analysis.reference;
  const lm = (key, i) => {
    const row = poseAt(frameOf(key))?.[i];
    return row && ok(row) ? [row[0], row[1]] : null;
  };
  const hands = (k) => (club[k] && ok(club[k].hands) ? club[k].hands : null);
  const head = (k) => (club[k] && ok(club[k].head) ? club[k].head : null);
  const plane = (to) => (ref?.ball && to ? { t: 'line', a: ref.ball, b: extendToEdge(ref.ball, to), dash: true, role: 'target' } : null);
  const shaftPlane = () => plane(ref?.handsAddress);
  const shoulderPlane = () => plane(ref?.trailShoulder);
  // Toes and ball as ticks on the ground, so the shaft line has something to land on.
  const ground = () => {
    const ball = ref?.ball;
    if (!ball) return [];
    const toes = [LM.lToe, LM.rToe].map((i) => lm('address', i)).filter(Boolean);
    const marks = [];
    if (toes.length) marks.push([toes.reduce((m, p) => m + p[0], 0) / toes.length, t('swing.overlay.toes')]);
    marks.push([ball[0], t('swing.overlay.ball')]);
    return marks.flatMap(([x, name]) => [
      { t: 'line', a: [x, ball[1] + 0.012], b: [x, ball[1] + 0.035], role: 'target' },
      { t: 'label', at: [x - 0.03, ball[1] + 0.06], text: name, role: 'target' },
    ]);
  };
  // Your shaft line carried down to ball height.
  const landing = (k) => {
    const h = head(k);
    const g = hands(k);
    const ball = ref?.ball;
    if (!h || !g || !ball || g[1] === h[1]) return [];
    const f = (ball[1] - h[1]) / (g[1] - h[1]);
    const hit = [h[0] + (g[0] - h[0]) * f, ball[1]];
    return [{ t: 'line', a: h, b: hit, dash: true }, { t: 'dot', c: hit }];
  };
  return { lm, hands, head, shaftPlane, shoulderPlane, ground, landing };
}

/**
 * What a checkpoint draws when no check is in focus (design B: each position has its own key lines).
 * @returns {{ shaft: boolean, shoulder: boolean, extra: object[] }}  which address planes to keep, plus
 *   the golfer's own lines for that position
 */
export function keyLinesAt(cp, ctx) {
  const none = { shaft: false, shoulder: false, extra: [] };
  if (!ctx?.analysis) return none;
  const { lm, ground, landing } = toolkit(ctx);
  // your shaft line to the ground, with the toes and the ball to land on (no ticks without a line)
  const down = (k) => {
    const mine = landing(k);
    return mine.length ? [...mine, ...ground()] : [];
  };
  switch (cp) {
    case 'address': return { shaft: true, shoulder: true, extra: [] };
    case 'takeaway':
    case 'transition':
    case 'impact': return { ...none, shaft: true };
    case 'leadArm': return { shaft: true, shoulder: true, extra: down('leadArm') };
    case 'top': {
      const left = ctx.analysis.handedness === 'left';
      const sh = lm('top', left ? LM.rSh : LM.lSh);
      const wr = lm('top', left ? LM.rWr : LM.lWr);
      return { ...none, shoulder: true, extra: sh && wr ? [{ t: 'line', a: sh, b: wr }] : [] };
    }
    case 'shaftDown': return { ...none, shaft: true, extra: down('shaftDown') };
    case 'shaftThrough': return { ...none, extra: down('shaftThrough') };
    default: return none;
  }
}

/**
 * @param {object} check  a row of analysis.checks
 * @param {object} ctx  { analysis, cp?, poseAt(frame) -> 33 x [x, y, vis] | null, frameOf(key) -> number }
 * @returns {object[]} primitives (possibly empty)
 */
export function highlightFor(check, ctx) {
  const { analysis, poseAt, frameOf } = ctx;
  if (!check || !analysis) return [];
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
  const { hands, head, shaftPlane, shoulderPlane, ground, landing } = toolkit(ctx);
  const text = (at, t) => (ok(at) && t ? [{ t: 'label', at: [at[0] + 0.03, at[1]], text: t }] : []);
  const out = [];

  switch (check.id) {
    case 'posture_address':
    case 'spine_loss': {
      const cp = check.id === 'posture_address' ? 'address' : 'impact';
      const hip = midLm(cp, LM.lHip, LM.rHip);
      const sh = midLm(cp, LM.lSh, LM.rSh);
      if (!hip || !sh) return [];
      out.push({ t: 'line', a: hip, b: [hip[0], Math.max(0, hip[1] - 0.3)], dash: true, role: 'target' });
      out.push({ t: 'line', a: hip, b: sh });
      if (cp === 'impact') {
        const ah = midLm('address', LM.lHip, LM.rHip);
        const as = midLm('address', LM.lSh, LM.rSh);
        if (ah && as) out.push({ t: 'line', a: hip, b: [hip[0] + as[0] - ah[0], hip[1] + as[1] - ah[1]], dash: true, role: 'target' });
      }
      return out.concat(text(sh, check.id === 'spine_loss' ? `${check.value}° lost` : valueText(check)));
    }
    case 'hands_under_shoulders': {
      const sh = midLm('address', LM.lSh, LM.rSh);
      const g = hands('address');
      if (!sh || !g) return [];
      return [
        { t: 'line', a: sh, b: [sh[0], g[1]], dash: true, role: 'target' },
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
      return [{ t: 'line', a: sh, b: ext, dash: true, role: 'target' }, { t: 'poly', pts: [hip, sh, ear] }, ...text(ear, valueText(check))];
    }
    case 'hand_gap': {
      const hip = lm('address', leadHip);
      const knee = lm('address', leadKnee);
      const g = hands('address');
      if (!hip || !knee || !g || knee[1] === hip[1]) return [];
      const x = hip[0] + ((knee[0] - hip[0]) * (g[1] - hip[1])) / (knee[1] - hip[1]);
      return [{ t: 'line', a: hip, b: [x, g[1]], dash: true, role: 'target' }, { t: 'line', a: [x, g[1]], b: g }, ...text(g, valueText(check))];
    }
    case 'hands_over_heels': {
      const heel = lm('top', trailHeel);
      const g = hands('top');
      if (!heel || !g) return [];
      return [{ t: 'line', a: heel, b: [heel[0], g[1]], dash: true, role: 'target' }, { t: 'rect', c: g, half: 0.018 }, ...text(g, signed(check))];
    }
    case 'lead_arm_shoulder_plane': {
      const ball = analysis.reference?.ball;
      const ts = analysis.reference?.trailShoulder;
      const sh = lm('top', leadSh);
      const wr = lm('top', leadWr);
      if (!ball || !ts || !sh || !wr) return [];
      return [{ t: 'line', a: ball, b: ts, dash: true, role: 'target' }, { t: 'line', a: sh, b: wr }, ...text(wr, signed(check))];
    }
    case 'hands_height_impact': {
      const a = hands('address');
      const i = hands('impact');
      if (!a || !i) return [];
      return [
        { t: 'rect', c: [i[0], a[1]], half: 0.018, dash: true, role: 'target' },
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
        { t: 'dot', c: [a[0], i[1]], role: 'target' },
        ...text(midOf([a[0], i[1]], i), signed(check)),
      ];
    }
    case 'head_drift': {
      const n = lm('address', LM.nose);
      return n ? [{ t: 'circle', c: n, r: 0.04, dash: true, role: 'target' }, ...text([n[0] + 0.03, n[1] - 0.04], valueText(check))] : [];
    }
    case 'hip_drift': {
      const a = lm('address', trailHip);
      const i = lm('impact', trailHip);
      if (!a || !i) return [];
      return [
        { t: 'line', a: [a[0], a[1] - 0.12], b: [a[0], a[1] + 0.12], dash: true, role: 'target' },
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
        { t: 'line', a: ih, b: [ih[0] + ac[0] - ah[0], ih[1] + ac[1] - ah[1]], dash: true, role: 'target' },
        ...text([ih[0] - 0.3, ih[1] + 0.06], `${signed(check)} vs address`),
      ];
    }
    case 'clubhead_vs_plane': {
      const h = head(check.cp);
      const plane = shaftPlane();
      return h ? [...(plane ? [plane] : []), { t: 'circle', c: h, r: 0.03 }, ...text(h, signed(check))] : [];
    }
    case 'butt_extension':
    case 'shaft_down_shallow':
    case 'shaft_through_steep': {
      const k = homeOf(check);
      const mine = landing(k);
      const plane = check.id === 'shaft_down_shallow' ? shaftPlane() : null;
      // without a clubhead there is no shaft line, but the references still draw
      const value = mine.length ? text([mine[1].c[0], mine[1].c[1] - 0.03], signed(check)) : [];
      return [...mine, ...value, ...(plane ? [plane] : []), ...ground()];
    }
    case 'top_direction': {
      const h = hands('top');
      const c = head('top');
      if (!h || !c) return [];
      return [{ t: 'line', a: h, b: c }, { t: 'line', a: h, b: [h[0], h[1] + (c[1] < h[1] ? -1 : 1) * Math.hypot(c[0] - h[0], c[1] - h[1])], dash: true, role: 'target' }, ...text(h, check.dir === 'across' ? 'crossed' : check.dir === 'laid_off' ? 'laid off' : 'on line')];
    }
    case 'downswing_path': {
      const pts = ['address', 'takeaway', 'leadArm', 'top'].map(hands).filter(Boolean);
      const sd = hands('shaftDown');
      return pts.length > 1 ? [{ t: 'poly', pts, dash: true, role: 'target' }, ...(sd ? [{ t: 'rect', c: sd, half: 0.018 }, ...text(sd, signed(check))] : [])] : [];
    }
    case 'hands_between_planes': {
      const planes = [shaftPlane(), shoulderPlane()].filter(Boolean);
      if (planes.length < 2) return [];
      const k = ctx.cp === 'leadArm' || ctx.cp === 'top' ? ctx.cp : check.at ?? 'leadArm';
      const g = hands(k);
      // the value belongs to the position it was read at; elsewhere only the hands are marked
      return g ? [...planes, { t: 'rect', c: g, half: 0.018 }, ...(!check.at || check.at === k ? text(g, valueText(check)) : [])] : planes;
    }
    case 'finish_balance': {
      const a = lm('finish', leadAnkle);
      return a ? [{ t: 'line', a: [a[0], Math.max(0, a[1] - 0.4)], b: a, dash: true, role: 'target' }] : [];
    }
    default: {
      const h = hands(homeOf(check));
      return h ? text(h, valueText(check)) : [];
    }
  }
}
