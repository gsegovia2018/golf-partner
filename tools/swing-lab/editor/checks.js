// Swing checks (plan §5.4/§5.5) as pure functions. No DOM. ES module, loadable by the browser and by node.
// Coordinates are video pixels (y down). Everything is mirrored internally so the golfer is "right-handed,
// ball on the +x side"; left-handers are mirrored around ball.x.

export const CHECKPOINTS = ['address', 'takeaway', 'leadArm', 'top', 'transition', 'shaftDown', 'impact', 'trailArm', 'finish'];
export const CP_LABEL = {
  address: 'Address', takeaway: 'Takeaway', leadArm: 'Lead arm', top: 'Top', transition: 'Transition',
  shaftDown: 'Shaft down', impact: 'Impact', trailArm: 'Trail arm', finish: 'Finish',
};
export const STATUS_WORD = { green: 'Good', yellow: 'Watch', red: 'Fix', unknown: 'Hidden' };

// MediaPipe landmark indices
const LM = { nose: 0, lSh: 11, rSh: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lToe: 31, rToe: 32 };

const rad2deg = (r) => (r * 180) / Math.PI;
const round = (v, d = 1) => (v == null || !isFinite(v) ? v : Math.round(v * 10 ** d) / 10 ** d);
const has = (p) => p && isFinite(p.x) && isFinite(p.y);

// ---------- geometry ----------
export function angleAboveHorizontal(p, q) {
  return rad2deg(Math.atan2(-(q.y - p.y), Math.abs(q.x - p.x)));
}
/** Signed perpendicular distance (px) of pt from line a->b; positive on the ball side (right/above for a
 *  line running up-left from the ball). */
export function sideOfLine(pt, a, b) {
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  if (dy > 0) { dx = -dx; dy = -dy; }
  const nx = -dy, ny = dx;
  return (pt.x - a.x) * nx + (pt.y - a.y) * ny;
}
/** x where line p->q crosses height y. */
export function extendToY(p, q, y) {
  if (q.y === p.y) return null;
  return p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y);
}
export function spineTiltDeg(hips, shoulders) {
  return rad2deg(Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y));
}
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ---------- scale ----------
/** Returns { cmPerPx, source, approx, golferPx }. Priority: explicit cmPerPx > leg-segment > height/golferPx. */
export function computeScale(input) {
  const { pose, checkpoints, heightCm = 176, video } = input;
  if (input.cmPerPx > 0) return { cmPerPx: input.cmPerPx, source: 'given', approx: false, golferPx: heightCm / input.cmPerPx };
  const right = (input.handedness || 'right') !== 'left';
  const ids = right ? [LM.rHip, LM.rKnee, LM.rAnk] : [LM.lHip, LM.lKnee, LM.lAnk];
  const base = checkpoints?.address?.frame;
  if (pose && base != null) {
    const legs = [];
    for (let f = base - 2; f <= base + 2; f++) {
      const lm = pose[f];
      if (!lm) continue;
      const [h, k, a] = ids.map((i) => lm[i]);
      if (!h || !k || !a) continue;
      legs.push(Math.hypot(h[0] - k[0], h[1] - k[1]) + Math.hypot(k[0] - a[0], k[1] - a[1]));
    }
    if (legs.length) {
      legs.sort((a, b) => a - b);
      const legPx = legs[Math.floor(legs.length / 2)];
      const cmPerPx = (0.49 * heightCm) / legPx;
      return { cmPerPx, source: 'leg', approx: !input.heightKnown && false, golferPx: heightCm / cmPerPx };
    }
  }
  // No pose: assume the golfer is ~42 % of the frame height at address (DTL framing); flagged approximate.
  const h = video?.h || 850;
  const golferPx = 0.42 * h;
  return { cmPerPx: heightCm / golferPx, source: 'height', approx: true, golferPx };
}

// ---------- the checks ----------
const unknown = (meta, reason, text) => ({ ...meta, status: 'unknown', value: null, reason, text });
const band = (v, g, y) => (v <= g ? 'green' : v <= y ? 'yellow' : 'red');

export function runChecks(input) {
  const { checkpoints: cps = {}, ball, pose } = input;
  const right = (input.handedness || 'right') !== 'left';
  const sc = computeScale(input);
  const cm = sc.cmPerPx;
  const H = sc.golferPx;
  const sgn = right ? 1 : -1;
  const bx = ball?.x ?? 0;
  const mx = (x) => bx + sgn * (x - bx);
  const mp = (p) => (has(p) ? { x: mx(p.x), y: p.y } : null);

  const cp = (k) => {
    const c = cps[k];
    if (!c || !has(c.hands)) return null;
    return { frame: c.frame, hands: mp(c.hands), head: c.hidden || !has(c.head) ? null : mp(c.head), hidden: !!c.hidden };
  };
  const C = Object.fromEntries(CHECKPOINTS.map((k) => [k, cp(k)]));
  const lm = (k, idx) => {
    const c = cps[k];
    const f = c && pose?.[c.frame];
    const p = f?.[idx];
    return p && isFinite(p[0]) ? { x: mx(p[0]), y: p[1], v: p[2] } : null;
  };
  const shIdx = right ? LM.rSh : LM.lSh;
  const hipIdx = right ? LM.rHip : LM.lHip;
  const leadAnkIdx = right ? LM.lAnk : LM.rAnk;

  const planes = getPlanes(input);
  const out = [];
  const M = (id, label, phase, cpsList, extra = {}) => ({ id, label, phase, cps: cpsList, ...extra });

  // posture_address
  {
    const m = M('posture_address', 'Posture at address', 'Setup', ['address']);
    const a = [lm('address', LM.lSh), lm('address', LM.rSh), lm('address', LM.lHip), lm('address', LM.rHip)];
    if (a.some((p) => !p)) out.push(unknown(m, 'nopose', 'Needs pose at the address frame'));
    else {
      const t = spineTiltDeg(mid(a[2], a[3]), mid(a[0], a[1]));
      const s = t >= 25 && t <= 40 ? 'green' : (t >= 20 && t < 25) || (t > 40 && t <= 45) ? 'yellow' : 'red';
      out.push({ ...m, status: s, value: round(t, 0), unit: '°', text: `Spine tilt ${round(t, 0)}° from vertical (25–40° is good)` });
    }
  }

  // hands_between_planes (worst of leadArm, top)
  {
    const m = M('hands_between_planes', 'Hands between the planes', 'Backswing', ['leadArm', 'top']);
    if (!planes.shaft || !planes.shoulder) out.push(unknown(m, 'nopose', 'Needs the address pose for the shoulder plane'));
    else {
      let worst = null;
      for (const k of ['leadArm', 'top']) {
        const c = C[k];
        if (!c) continue;
        const dShaft = sideOfLine(c.hands, planes.shaft.a, planes.shaft.b) * cm; // + = outside shaft plane
        const dSh = sideOfLine(c.hands, planes.shoulder.a, planes.shoulder.b) * cm; // + = outside shoulder plane
        const steep = dSh, flat = -dShaft;
        const ex = Math.max(steep, flat);
        if (!worst || ex > worst.ex) worst = { ex, k, dir: steep >= flat ? 'steep' : 'flat' };
      }
      if (!worst) out.push(unknown(m, 'nodata', 'No lead arm / top marks'));
      else {
        const s = worst.ex <= 0 ? 'green' : worst.ex <= 4 ? 'yellow' : 'red';
        out.push({ ...m, status: s, value: round(Math.max(0, worst.ex), 0), unit: 'cm', dir: worst.dir,
          text: s === 'green' ? 'Hands travel between shaft and shoulder planes'
            : `Hands ${round(worst.ex, 0)} cm ${worst.dir === 'steep' ? 'outside the shoulder plane (steep)' : 'inside the shaft plane (flat)'} at ${CP_LABEL[worst.k].toLowerCase()}` });
      }
    }
  }

  // butt_extension (leadArm)
  {
    const m = M('butt_extension', 'Butt end points at the ball', 'Backswing', ['leadArm']);
    const c = C.leadArm;
    if (!c) out.push(unknown(m, 'nodata', 'No lead arm mark'));
    else if (!c.head) out.push(unknown(m, 'hidden', 'Clubhead hidden at lead arm'));
    else {
      const x = extendToY(c.head, c.hands, ball.y);
      if (x == null) out.push(unknown(m, 'nodata', 'Shaft is horizontal'));
      else {
        const toeL = lm('address', LM.lToe), toeR = lm('address', LM.rToe);
        const toes = toeL && toeR ? (toeL.x + toeR.x) / 2 : toeL?.x ?? toeR?.x ?? null;
        const span = toes != null && toes < ball.x ? bx - toes : 0;
        const margin = 0.1 * span;
        const beyond = (x - bx - margin) * cm; // + = beyond the ball (flat)
        const inside = toes != null && span ? (toes + margin - x) * cm : -Infinity; // + = inside toes (steep)
        let s = 'green', dir = null, v = round((x - bx) * cm, 0);
        if (beyond > 0) { dir = 'flat'; s = beyond <= 15 ? 'yellow' : 'red'; }
        else if (inside > 0) { dir = 'steep'; s = inside <= 15 ? 'yellow' : 'red'; }
        out.push({ ...m, status: s, value: v, unit: 'cm', dir,
          text: s === 'green' ? 'Butt-end line lands between toes and ball'
            : dir === 'flat' ? `Butt-end line lands ${round(beyond, 0)} cm beyond the ball (flat)` : `Butt-end line lands ${round(inside, 0)} cm inside the toes (steep)` });
      }
    }
  }

  // top_direction
  {
    const m = M('top_direction', 'Shaft direction at the top', 'Backswing', ['top']);
    const c = C.top;
    if (!c) out.push(unknown(m, 'nodata', 'No top mark'));
    else if (!c.head) out.push(unknown(m, 'hidden', 'Clubhead hidden at the top'));
    else {
      const dx = (c.head.x - c.hands.x) / H;
      const s = Math.abs(dx) <= 0.08 ? 'green' : 'yellow';
      out.push({ ...m, status: s, value: round(dx, 2), unit: 'H', dir: dx > 0 ? 'across' : 'laid_off',
        text: s === 'green' ? 'Shaft points near the target line' : dx > 0 ? 'Shaft crossed the line (points right)' : 'Shaft laid off (points left)' });
    }
  }

  // downswing_path (shaftDown hands vs backswing path at same y)
  {
    const m = M('downswing_path', 'Downswing path', 'Transition', ['shaftDown']);
    const c = C.shaftDown;
    const path = ['address', 'takeaway', 'leadArm', 'top'].map((k) => C[k]?.hands).filter(Boolean);
    if (!c) out.push(unknown(m, 'nodata', 'No shaft-down mark'));
    else {
      let bxAt = null;
      for (let i = 0; i < path.length - 1; i++) {
        const p = path[i], q = path[i + 1];
        const lo = Math.min(p.y, q.y), hi = Math.max(p.y, q.y);
        if (c.hands.y >= lo && c.hands.y <= hi && p.y !== q.y) { bxAt = p.x + ((q.x - p.x) * (c.hands.y - p.y)) / (q.y - p.y); break; }
      }
      if (bxAt == null) out.push(unknown(m, 'nodata', 'Hands outside the backswing height range'));
      else {
        const out_cm = (c.hands.x - bxAt) * cm; // + = outside / toward the ball
        const s = out_cm <= 3 ? 'green' : out_cm <= 6 ? 'yellow' : 'red';
        out.push({ ...m, status: s, value: round(out_cm, 0), unit: 'cm',
          text: s === 'green' ? 'Hands drop on or inside the backswing path' : `Hands ${round(out_cm, 0)} cm outside the backswing path (over the top)` });
      }
    }
  }

  // clubhead_vs_plane (impact)
  {
    const m = M('clubhead_vs_plane', 'Clubhead on the plane', 'Impact', ['impact']);
    const c = C.impact;
    if (!c) out.push(unknown(m, 'nodata', 'No impact mark'));
    else if (!c.head) out.push(unknown(m, 'hidden', 'Clubhead hidden at impact'));
    else if (!planes.shaft) out.push(unknown(m, 'nodata', 'No address plane'));
    else {
      const d = sideOfLine(c.head, planes.shaft.a, planes.shaft.b) * cm;
      const s = Math.abs(d) <= 4 ? 'green' : d > 4 && d <= 8 ? 'yellow' : d < -4 ? 'yellow' : 'red';
      out.push({ ...m, status: s, value: round(d, 0), unit: 'cm', dir: d > 0 ? 'steep' : 'under',
        text: s === 'green' ? 'Clubhead returns to the address plane' : d > 0 ? `Clubhead ${round(d, 0)} cm above the plane (steep)` : `Clubhead ${round(-d, 0)} cm under the plane` });
    }
  }

  // hands_height_impact
  {
    const m = M('hands_height_impact', 'Hands height at impact', 'Impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address, i = C.impact;
    if (!a || !i) out.push(unknown(m, 'nodata', 'Needs address and impact marks'));
    else {
      const d = (a.hands.y - i.hands.y) * cm;
      const s = band(d, 5, 8);
      out.push({ ...m, status: s, value: round(d, 0), unit: 'cm',
        text: d > 0 ? `Hands ${round(d, 0)} cm higher than at address` : `Hands ${round(-d, 0)} cm lower than at address` });
    }
  }

  // hands_out_impact (new)
  {
    const m = M('hands_out_impact', 'Hands toward the ball at impact', 'Impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address, i = C.impact;
    if (!a || !i) out.push(unknown(m, 'nodata', 'Needs address and impact marks'));
    else {
      const d = (i.hands.x - a.hands.x) * cm;
      const s = band(d, 4, 8);
      out.push({ ...m, status: s, value: round(d, 0), unit: 'cm',
        text: d > 0 ? `Hands ${round(d, 0)} cm closer to the ball line than at address` : `Hands ${round(-d, 0)} cm further from the ball line than at address` });
    }
  }

  // shaft_angle_impact
  {
    const m = M('shaft_angle_impact', 'Shaft angle at impact', 'Impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = C.address, i = C.impact;
    if (!a || !i) out.push(unknown(m, 'nodata', 'Needs address and impact marks'));
    else if (!a.head || !i.head) out.push(unknown(m, 'hidden', 'Clubhead hidden at address or impact'));
    else {
      const d = angleAboveHorizontal(i.head, i.hands) - angleAboveHorizontal(a.head, a.hands);
      const s = band(d, 6, 10);
      out.push({ ...m, status: s, value: round(d, 0), unit: '°',
        text: d >= 0 ? `Shaft ${round(d, 0)}° more upright than at address` : `Shaft ${round(-d, 0)}° flatter than at address` });
    }
  }

  // spine_loss
  {
    const m = M('spine_loss', 'Spine angle kept', 'Impact', ['address', 'impact'], { cluster: 'early_extension' });
    const g = (k) => [lm(k, LM.lSh), lm(k, LM.rSh), lm(k, LM.lHip), lm(k, LM.rHip)];
    const a = g('address'), i = g('impact');
    if (a.some((p) => !p) || i.some((p) => !p)) out.push(unknown(m, 'nopose', 'Needs pose at address and impact'));
    else {
      const ta = spineTiltDeg(mid(a[2], a[3]), mid(a[0], a[1])), ti = spineTiltDeg(mid(i[2], i[3]), mid(i[0], i[1]));
      const loss = ta - ti;
      out.push({ ...m, status: band(loss, 3, 6), value: round(loss, 0), unit: '°', text: `Spine tilt ${round(ta, 0)}° → ${round(ti, 0)}° (${round(loss, 0)}° lost)` });
    }
  }

  // hip_drift
  {
    const m = M('hip_drift', 'Hips hold their line', 'Impact', ['address', 'impact'], { cluster: 'early_extension' });
    const a = lm('address', hipIdx), i = lm('impact', hipIdx);
    if (!a || !i) out.push(unknown(m, 'nopose', 'Needs pose at address and impact'));
    else {
      const d = (i.x - a.x) * cm;
      out.push({ ...m, status: band(d, 3, 6), value: round(d, 0), unit: 'cm', text: `Trail hip ${round(d, 0)} cm toward the ball` });
    }
  }

  // head_drift
  {
    const m = M('head_drift', 'Head stays put', 'Impact', ['address', 'impact']);
    const a = lm('address', LM.nose), i = lm('impact', LM.nose);
    if (!a || !i) out.push(unknown(m, 'nopose', 'Needs pose at address and impact'));
    else {
      const d = Math.hypot(i.x - a.x, i.y - a.y) * cm;
      out.push({ ...m, status: band(d, 5, 10), value: round(d, 0), unit: 'cm', text: `Head moved ${round(d, 0)} cm from address` });
    }
  }

  // tempo
  {
    const m = M('tempo', 'Tempo', 'Transition', ['takeaway', 'top', 'impact']);
    const t = cps.takeaway?.frame, tp = cps.top?.frame, im = cps.impact?.frame;
    if (t == null || tp == null || im == null || im <= tp || tp <= t) out.push(unknown(m, 'nodata', 'Needs takeaway, top and impact frames in order'));
    else {
      const raw = (tp - t) / (im - tp);
      const r = round(raw, 1); // judged at the precision shown
      let s, dir = null;
      if (r >= 2.5 && r <= 3.5) s = 'green';
      else if (r < 2.5) { s = r < 1.6 ? 'red' : 'yellow'; dir = 'fast'; }
      else { s = r <= 4.5 ? 'yellow' : 'red'; dir = 'slow'; }
      out.push({ ...m, status: s, value: r, unit: ':1', dir, text: `Backswing ${tp - t} : downswing ${im - tp} frames = ${r}:1 (2.5–3.5 is good)` });
    }
  }

  // finish_balance: needs time-in-motion, not available from stills
  out.push(unknown(M('finish_balance', 'Finish balance', 'Finish', ['finish']), 'nodata', 'Needs stillness over time; not measured in the lab'));

  return { checks: out, main: mainFault(out), scale: sc, planes };
}

/** Reference lines from the address frame. a/b are in mirrored coordinates (golfer on -x of the ball). */
export function getPlanes(input) {
  const { checkpoints: cps = {}, ball, pose } = input;
  const right = (input.handedness || 'right') !== 'left';
  const sgn = right ? 1 : -1;
  const out = { shaft: null, shoulder: null, raw: { shaft: null, shoulder: null } };
  const addr = cps.address;
  if (!ball || !addr || !has(addr.hands)) return out;
  const mx = (x) => ball.x + sgn * (x - ball.x);
  out.shaft = { a: { x: ball.x, y: ball.y }, b: { x: mx(addr.hands.x), y: addr.hands.y } };
  out.raw.shaft = { a: { x: ball.x, y: ball.y }, b: { x: addr.hands.x, y: addr.hands.y } };
  const f = pose?.[addr.frame];
  const s = f?.[right ? LM.rSh : LM.lSh];
  if (s && isFinite(s[0])) {
    out.shoulder = { a: { x: ball.x, y: ball.y }, b: { x: mx(s[0]), y: s[1] } };
    out.raw.shoulder = { a: { x: ball.x, y: ball.y }, b: { x: s[0], y: s[1] } };
  }
  return out;
}

// ---------- priority (§5.5) ----------
// Order = causal chain (setup -> backswing -> transition -> impact -> finish); ties go to the earliest.
const FAULTS = [
  { id: 'posture', label: 'Posture at address', weight: 0.7, pick: (c) => c.id === 'posture_address' },
  { id: 'steep_backswing', label: 'Steep backswing', weight: 0.8, pick: (c) => (c.id === 'hands_between_planes' || c.id === 'butt_extension') && c.dir === 'steep' },
  { id: 'flat_backswing', label: 'Flat backswing', weight: 0.8, pick: (c) => (c.id === 'hands_between_planes' || c.id === 'butt_extension') && c.dir === 'flat' },
  { id: 'head_sway', label: 'Head sway', weight: 0.7, pick: (c) => c.id === 'head_drift' },
  { id: 'tempo_fast', label: 'Rushed tempo', weight: 0.6, pick: (c) => c.id === 'tempo' && c.dir === 'fast' },
  { id: 'tempo_slow', label: 'Slow tempo', weight: 0.6, pick: (c) => c.id === 'tempo' && c.dir === 'slow' },
  { id: 'over_the_top', label: 'Over the top', weight: 0.95, pick: (c) => c.id === 'downswing_path' || (c.id === 'clubhead_vs_plane' && c.dir === 'steep') },
  { id: 'early_extension', label: 'Early extension', weight: 1.0, pick: (c) => c.cluster === 'early_extension' },
  { id: 'balance', label: 'Finish balance', weight: 0.5, pick: (c) => c.id === 'finish_balance' },
  // across_the_line / laid_off (top_direction) never main on their own.
];

export function mainFault(checks) {
  let best = null;
  for (const f of FAULTS) {
    const ev = checks.filter((c) => (c.status === 'red' || c.status === 'yellow') && f.pick(c));
    if (!ev.length) continue;
    const sum = ev.reduce((s, c) => s + (c.status === 'red' ? 1 : 0.5), 0);
    const score = f.weight * sum * (1 + 0.25 * (ev.length - 1));
    if (!best || score > best.score + 1e-9) best = { fault: f.id, label: f.label, score: round(score, 2), evidence: ev.map((c) => c.id) };
  }
  return best;
}

// ---------- display <-> video coordinates ----------
/** Rect (in container px) where a video of vw x vh is painted for object-fit contain|cover. */
export function fitRect(cw, ch, vw, vh, mode = 'contain') {
  const s = mode === 'cover' ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
  const w = vw * s, h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale: s };
}
export function videoToView(pt, cw, ch, vw, vh, mode = 'contain') {
  const r = fitRect(cw, ch, vw, vh, mode);
  return { x: r.x + pt.x * r.scale, y: r.y + pt.y * r.scale };
}
/** Pointer position relative to the container -> video px (unclamped; use clampToVideo). */
export function viewToVideo(pt, cw, ch, vw, vh, mode = 'contain') {
  const r = fitRect(cw, ch, vw, vh, mode);
  return { x: (pt.x - r.x) / r.scale, y: (pt.y - r.y) / r.scale };
}
export function clampToVideo(p, vw, vh) {
  return { x: Math.min(vw, Math.max(0, p.x)), y: Math.min(vh, Math.max(0, p.y)) };
}
