// Pure models behind the loading splash scenes. Every function that runs per frame is a
// worklet (Reanimated runs it on the UI thread, which stays free while boot keeps JS busy);
// in Jest the directive is a plain string, so the same code is unit-tested directly.

export const SCENES = ['putt', 'green', 'swing', 'water'];

// One scene per app launch, chosen uniformly.
export function pickScene(rand = Math.random) {
  return SCENES[Math.min(SCENES.length - 1, Math.floor(rand() * SCENES.length))];
}

// ---------------------------------------------------------------------------
// Easing helpers
// ---------------------------------------------------------------------------

export function clamp01(v) {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Progress of u through [a, b], clamped to 0..1.
export function seg(u, a, b) {
  'worklet';
  return clamp01((u - a) / (b - a));
}

export function easeIO(p) {
  'worklet';
  return (1 - Math.cos(Math.PI * p)) / 2;
}

// CSS cubic-bezier(x1, y1, x2, y2) evaluated at progress p (solve x(s) = p, return y(s)).
export function cubicBezier(x1, y1, x2, y2, p) {
  'worklet';
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const bx = (s, a, b) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  let lo = 0;
  let hi = 1;
  let s = p;
  for (let i = 0; i < 24; i++) {
    const x = bx(s, x1, x2);
    if (Math.abs(x - p) < 1e-5) break;
    if (x < p) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return bx(s, y1, y2);
}

// An SVG path for an ellipse rotated by `deg` (arcs carry their own rotation, so no transform).
export function ellipsePath(cx, cy, rx, ry, deg = 0) {
  'worklet';
  const a = (deg * Math.PI) / 180;
  const dx = rx * Math.cos(a);
  const dy = rx * Math.sin(a);
  const f = (v) => v.toFixed(2);
  return `M${f(cx + dx)} ${f(cy + dy)} A${f(rx)} ${f(ry)} ${f(deg)} 1 0 ${f(cx - dx)} ${f(cy - dy)}`
    + ` A${f(rx)} ${f(ry)} ${f(deg)} 1 0 ${f(cx + dx)} ${f(cy + dy)} Z`;
}

// ---------------------------------------------------------------------------
// Golf ball face: a Fibonacci lattice of dimples on the unit sphere, z toward the viewer.
// A dimple of angular radius d projects to an ellipse: d across the radius, d*z along it.
// Returned in a 16 x 16 box; the ball turns about the view axis, so one face rotated is exact.
// ---------------------------------------------------------------------------

export function ballDimples(n = 140, d = 0.1) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) * 2) / n;
    const r = Math.sqrt(1 - y * y);
    const x = Math.cos(ga * i) * r;
    const z = Math.sin(ga * i) * r;
    if (z <= 0) continue;
    out.push({
      cx: 8 + 8 * x,
      cy: 8 - 8 * y,
      rx: Math.max(8 * d * z, 0.05),
      ry: 8 * d,
      deg: (Math.atan2(-y, x) * 180) / Math.PI,
      alpha: 0.12 + 0.12 * z,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scene "putt" (side view): pendulum stroke, friction roll, drop into a to-scale cup.
// Ground contact y = 70, ball r = 8, cup 40 wide. Times in seconds.
// ---------------------------------------------------------------------------

export const PUTT_CYCLE = 3.2;
export const PUTT_STILL = 1.47;   // reduced motion: ball mid-roll, putter gone
export const PUTT_ROLL = 124;     // px from address to the lip
const PUTT_DEG_PER_PX = 888 / PUTT_ROLL;

export function puttFrame(t) {
  'worklet';
  const u = (t % PUTT_CYCLE) / PUTT_CYCLE;
  // Putter: back 0.05-0.16, through to impact at 0.22, follow-through to 0.31, fade by 0.42
  let rot = 0;
  let putterOpacity = clamp01(u / 0.05);
  if (u >= 0.05 && u < 0.16) rot = 7 * cubicBezier(0.45, 0, 0.55, 1, seg(u, 0.05, 0.16));
  else if (u >= 0.16 && u < 0.22) rot = 7 * (1 - cubicBezier(0.45, 0, 0.9, 0.55, seg(u, 0.16, 0.22)));
  else if (u >= 0.22 && u < 0.31) rot = -6 * cubicBezier(0.1, 0.45, 0.55, 1, seg(u, 0.22, 0.31));
  else if (u >= 0.31) {
    rot = -6;
    putterOpacity = 1 - seg(u, 0.31, 0.42);
  }
  // Ball: struck at 0.22, friction decel to the lip at 0.74 (still rolling), falls 0.74-0.84
  let x = 0;
  let y = 0;
  if (u >= 0.22 && u < 0.74) x = PUTT_ROLL * cubicBezier(0.2, 0.35, 0.8, 0.95, seg(u, 0.22, 0.74));
  else if (u >= 0.74) {
    x = PUTT_ROLL + 10 * seg(u, 0.74, 0.84);
    y = 22 * cubicBezier(0.55, 0, 1, 0.45, seg(u, 0.74, 0.84));
  }
  const shadowOpacity = u < 0.74 ? 0.9 * clamp01(u / 0.04) : 0.9 * (1 - seg(u, 0.74, 0.77));
  return {
    putterRot: rot,
    putterOpacity,
    ballX: x,
    ballY: y,
    ballRot: x * PUTT_DEG_PER_PX,
    ballOpacity: clamp01(u / 0.04),
    shadowOpacity,
  };
}

// ---------------------------------------------------------------------------
// Scene "green" (top-down): a right-handed golfer west of the ball, target up the screen.
// A pendulum stroke (2:1 tempo), then the ball takes the break into the cup.
// ---------------------------------------------------------------------------

export const GREEN_CYCLE = 3.8;
export const GREEN_STILL = 0.62 * GREEN_CYCLE;
export const GREEN_CUP = [132, 30];
const GREEN_PATH = [[48, 112], [54, 60], [100, 22], [132, 30]];

function bezierPoint(t) {
  'worklet';
  const m = 1 - t;
  const w0 = m * m * m;
  const w1 = 3 * m * m * t;
  const w2 = 3 * m * t * t;
  const w3 = t * t * t;
  return [
    w0 * GREEN_PATH[0][0] + w1 * GREEN_PATH[1][0] + w2 * GREEN_PATH[2][0] + w3 * GREEN_PATH[3][0],
    w0 * GREEN_PATH[0][1] + w1 * GREEN_PATH[1][1] + w2 * GREEN_PATH[2][1] + w3 * GREEN_PATH[3][1],
  ];
}

// Arc length -> point, so the roll follows real distance rather than the curve parameter.
const GREEN_LUT = (() => {
  const out = [[0, GREEN_PATH[0][0], GREEN_PATH[0][1]]];
  for (let i = 1; i <= 240; i++) {
    const [x, y] = bezierPoint(i / 240);
    const prev = out[i - 1];
    out.push([prev[0] + Math.hypot(x - prev[1], y - prev[2]), x, y]);
  }
  return out;
})();
export const GREEN_LENGTH = GREEN_LUT[GREEN_LUT.length - 1][0];

function greenPointAt(s) {
  'worklet';
  for (let i = 0; i < GREEN_LUT.length; i++) {
    if (GREEN_LUT[i][0] >= s) return [GREEN_LUT[i][1], GREEN_LUT[i][2]];
  }
  const last = GREEN_LUT[GREEN_LUT.length - 1];
  return [last[1], last[2]];
}

const G_TOP = 0.27;
const G_IMP = 0.355;
const G_FIN = 0.455;

export function greenSwing(u) {
  'worklet';
  if (u < 0.10) return 0;
  if (u < G_TOP) return 12 * easeIO(seg(u, 0.10, G_TOP));                       // take-away, stops at the top
  if (u < G_IMP) return 12 * Math.cos((Math.PI / 2) * seg(u, G_TOP, G_IMP));    // falls like a pendulum
  if (u < G_FIN) return -14 * Math.sin((Math.PI / 2) * seg(u, G_IMP, G_FIN));   // carries through and slows
  if (u < 0.80) return -14;                                                      // holds the finish
  return -14 * (1 - easeIO(seg(u, 0.80, 0.95)));                                 // back to address
}

// A straight, tapered limb from fraction a to b of shoulder -> hand, half-widths wa -> wb,
// with a rounded far end.
export function limbPath(sx, sy, hx, hy, a, b, wa, wb) {
  'worklet';
  const dx = hx - sx;
  const dy = hy - sy;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const ax = sx + dx * a;
  const ay = sy + dy * a;
  const bx = sx + dx * b;
  const by = sy + dy * b;
  const f = (v) => v.toFixed(2);
  return `M${f(ax + nx * wa)} ${f(ay + ny * wa)} L${f(bx + nx * wb)} ${f(by + ny * wb)}`
    + ` A${f(wb)} ${f(wb)} 0 0 1 ${f(bx - nx * wb)} ${f(by - ny * wb)} L${f(ax - nx * wa)} ${f(ay - ny * wa)} Z`;
}

// Anser-style blade seen from above, centred on (0,0), face toward -y. Scaled to 74 %.
// Each entry: [command, ...points]; transformed per frame (affine maps keep curves exact).
const BLADE = [
  ['M', -13.5, -1.2], ['Q', -13.5, -2.7, -12, -2.7], ['L', 12, -2.7], ['Q', 13.5, -2.7, 13.5, -1.2],
  ['L', 13.5, 1.6], ['Q', 13.5, 2.9, 12, 2.9], ['L', 5, 2.9], ['Q', 4, 2.9, 3.4, 2.2], ['L', -3.4, 2.2],
  ['Q', -4, 2.9, -5, 2.9], ['L', -12, 2.9], ['Q', -13.5, 2.9, -13.5, 1.6],
];
const TOPLINE = [['M', -12.6, -2.7], ['L', 12.6, -2.7], ['L', 12.6, -1.5], ['L', -12.6, -1.5]];
const CAVITY = [['M', -10.5, -1.25], ['L', 10.5, -1.25], ['L', 10.5, 0.45], ['L', -10.5, 0.45]];
const SIGHT = [['M', 0, 0.7], ['L', 0, 2.1]];
const NECK = [['M', -10.8, -2.4], ['L', -10.8, -4.6], ['L', -12.6, -4.6]];
const BLADE_SCALE = 0.74;

function shapePath(shape, px, py, deg, close) {
  'worklet';
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  let d = '';
  for (let i = 0; i < shape.length; i++) {
    const cmd = shape[i];
    d += cmd[0];
    for (let j = 1; j < cmd.length; j += 2) {
      const x = cmd[j] * BLADE_SCALE;
      const y = cmd[j + 1] * BLADE_SCALE;
      d += `${(px + x * c - y * s).toFixed(2)} ${(py + x * s + y * c).toFixed(2)} `;
    }
  }
  return close ? `${d}Z` : d;
}

function rotateAbout(x, y, cx, cy, deg) {
  'worklet';
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

export function greenFrame(t) {
  'worklet';
  const u = (t % GREEN_CYCLE) / GREEN_CYCLE;
  const deg = greenSwing(u);
  const th = (deg * Math.PI) / 180;
  const sn = Math.sin(th);
  // Putter head: long radius, a shallow arc toward the golfer, face opens/closes a third of the swing angle
  const px = 48 - 30 * (1 - Math.cos(th));
  const py = 120.6 + 60 * sn;
  const rot = deg * 0.3;
  // Hands: same pendulum, shorter radius
  const hx = 30.5 - 10 * (1 - Math.cos(th));
  const hy = 120 + 34 * sn;
  const r = (rot * Math.PI) / 180;
  const hosel = [px + (-9.32 * Math.cos(r) + 3.4 * Math.sin(r)), py + (-9.32 * Math.sin(r) - 3.4 * Math.cos(r))];
  // Head stays still through the stroke, then turns to watch the ball, and back
  const look = -38 * easeIO(seg(u, 0.47, 0.58)) * (1 - easeIO(seg(u, 0.82, 0.93)));
  const brim = rotateAbout(15.5, 120, 5, 120, look);
  const seam = (x1, y1, x2, y2) => {
    const a = rotateAbout(x1, y1, 5, 120, look);
    const b = rotateAbout(x2, y2, 5, 120, look);
    return `M${a[0].toFixed(2)} ${a[1].toFixed(2)} L${b[0].toFixed(2)} ${b[1].toFixed(2)} `;
  };
  // Ball: constant friction (ease-out quad blended with a little carry), sinks over the last 11 px
  let s = 0;
  if (u >= G_IMP) {
    const tau = seg(u, G_IMP, 0.80);
    s = GREEN_LENGTH * (0.8 * tau * (2 - tau) + 0.2 * tau);
  }
  const k = Math.max(0, (s - (GREEN_LENGTH - 11)) / 11);
  const [bx, by] = greenPointAt(s);
  return {
    blade: shapePath(BLADE, px, py, rot, true),
    topline: shapePath(TOPLINE, px, py, rot, true),
    cavity: shapePath(CAVITY, px, py, rot, true),
    sight: shapePath(SIGHT, px, py, rot, false),
    neck: shapePath(NECK, px, py, rot, false),
    shaft: [hx, hy, hosel[0], hosel[1]],
    hands: [hx, hy],
    forearmL: limbPath(7, 97.5, hx - 1.5, hy - 1.5, 0.3, 1, 2.7, 2.1),
    forearmR: limbPath(7, 142.5, hx - 1.5, hy + 2, 0.3, 1, 2.7, 2.1),
    sleeveL: limbPath(7, 97.5, hx - 1.5, hy - 1.5, 0, 0.36, 3.4, 3.2),
    sleeveR: limbPath(7, 142.5, hx - 1.5, hy + 2, 0, 0.36, 3.4, 3.2),
    brim: ellipsePath(brim[0], brim[1], 6.5, 7.8, look),
    seams: seam(5, 108.5, 5, 131.5) + seam(-6, 116.5, 16, 123.5) + seam(-6, 123.5, 16, 116.5),
    aimOpacity: 0.6 * easeIO(seg(u, 0.02, 0.07)) * (1 - easeIO(seg(u, 0.14, 0.2))),
    ballX: bx,
    ballY: by,
    ballScale: 1 - 0.45 * k,
    ballOpacity: u >= 0.80 ? 0 : clamp01(u / 0.06) * (1 - k),
  };
}

// ---------------------------------------------------------------------------
// Scene "swing" (face-on, target to our right): pose-to-pose from the P1-P10 positions
// of an iron swing, interpolated with non-uniform Catmull-Rom so every joint keeps a
// continuous velocity.
// Per key: A / R = angle (0 = down, + toward our left) and projected length of the lead
// arm from the lead shoulder to the hands (shorter when the arm swings around the body,
// away from the camera); C = club angle; shift = hips toward the target; fh / fs = hip /
// shoulder width as they turn; tilt = spine lean away from the target; look = head turning
// to watch; heel = trail foot up on its toe; knee = trail knee in; dip = pelvis height;
// kneeR = lead knee across; roll = tilt of the shoulder plane.
// ---------------------------------------------------------------------------

export const SWING_CYCLE = 3.8;
export const SWING_STILL = 2.2;   // reduced motion: the finish
export const SWING_IMPACT = 1.46;
const SWING_FADE_OUT = 3.15;
const SWING_SNAP = 3.35;

const KEYS = [
  // t (s)   A     R     C      shift  fh    fs   tilt look heel knee  dip  kneeR roll
  [0.40,    10,  36.5,   -4,     0,    1,    1,    8,  0,   0,   0,    0,    0,    0],   // P1 address
  [0.66,    32,  36,     90,  -1.5,   0.9,  0.72,  9,  0,   0,   0,    0, -1.5,   -8],   // P2 shaft parallel back
  [0.88,    80,  29,    178,  -2.5,   0.8,  0.5,  10,  0,   0,   0,    0,   -3,  -18],   // P3 lead arm parallel
  [1.20,   135,  28,    245,  -1.5,   0.72, 0.36, 10,  0,   0,   0,  0.5,   -4,  -24],   // P4 top; hips already start back
  [1.36,    92,  28,    200,     2,   0.8,  0.55, 12,  0, 0.05, 0.15, 2,   -1,   -8],   // P5 lead arm parallel, lag held
  [1.415,   40,  33,     92,   3.5,   0.78, 0.75, 13,  0, 0.1, 0.25, 2.5, 0.5,    2],   // P6 shaft parallel, release begins
  [1.46,     2,  37.5,    4,     5,   0.72, 0.9,  14,  0, 0.2, 0.35, 0.5, 1.5,   10],   // P7 impact, lead leg posted
  [1.52,   -40,  35,    -92,   6.5,   0.6,  0.8,  11, 0.1, 0.4, 0.5,  -1,  1.5,    8],   // P8 shaft parallel through
  [1.60,   -95,  27,   -178,     8,   0.5,  0.5,   5, 0.5, 0.75, 0.8, -2,  1.5,    4],   // P9 trail arm parallel
  [2.00,  -165,  21,   -290,     9,   0.5,  0.42, -3,  1,   1,   1,   -3,    1,    0],   // P10 tall finish
];
export const SWING_KEYS = KEYS;
const CH = 13; // channels after t

// At the top only the upper body and club stop: the lower body has already started down
// (the transition), so its channels keep their velocity through P4.
const REST_AT_TOP = [true, true, true, false, false, true, true, false, false, false, false, false, true];
const TANGENTS = KEYS.map((k, i) => {
  const out = [];
  for (let j = 0; j < CH; j++) {
    const rest = i === 0 || i === KEYS.length - 1 || (i === 3 && REST_AT_TOP[j]);
    out.push(rest ? 0 : (KEYS[i + 1][j + 1] - KEYS[i - 1][j + 1]) / (KEYS[i + 1][0] - KEYS[i - 1][0]));
  }
  return out;
});

// Channel values at time `sec` within the cycle: [A, R, C, shift, fh, fs, tilt, look, heel, knee, dip, kneeR, roll]
export function swingPose(sec) {
  'worklet';
  const t = sec >= SWING_SNAP ? 0 : sec;
  const first = KEYS[0];
  const last = KEYS[KEYS.length - 1];
  const out = [];
  if (t <= first[0] || t >= last[0]) {
    const k = t <= first[0] ? first : last;
    for (let j = 0; j < CH; j++) out.push(k[j + 1]);
    return out;
  }
  let i = 0;
  while (KEYS[i + 1][0] < t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const h = b[0] - a[0];
  const u = (t - a[0]) / h;
  const h00 = 2 * u * u * u - 3 * u * u + 1;
  const h10 = u * u * u - 2 * u * u + u;
  const h01 = -2 * u * u * u + 3 * u * u;
  const h11 = u * u * u - u * u;
  for (let j = 0; j < CH; j++) {
    out.push(h00 * a[j + 1] + h10 * h * TANGENTS[i][j] + h01 * b[j + 1] + h11 * h * TANGENTS[i + 1][j]);
  }
  return out;
}

export const ARM_UPPER = 21;
export const ARM_FORE = 20;
const REACH = ARM_UPPER + ARM_FORE - 0.05;
const CLUB = 47;

// Two-bone arm with the elbow always on the lower side (elbows point at the ground in a swing).
export function elbowOf(sx, sy, hx, hy) {
  'worklet';
  const dx = hx - sx;
  const dy = hy - sy;
  const d = Math.min(Math.max(Math.hypot(dx, dy), 2), ARM_UPPER + ARM_FORE - 0.01);
  const phi = Math.atan2(dy, dx);
  const al = Math.acos((ARM_UPPER * ARM_UPPER + d * d - ARM_FORE * ARM_FORE) / (2 * ARM_UPPER * d));
  const c1 = [sx + ARM_UPPER * Math.cos(phi + al), sy + ARM_UPPER * Math.sin(phi + al)];
  const c2 = [sx + ARM_UPPER * Math.cos(phi - al), sy + ARM_UPPER * Math.sin(phi - al)];
  return c1[1] > c2[1] ? c1 : c2;
}

export function swingSolve(q) {
  'worklet';
  const [A, R, C, shift, fh, fs, tilt, look, heel, knee, dip, kneeR, roll] = q;
  const t = (tilt * Math.PI) / 180;
  const ro = ((tilt - roll) * Math.PI) / 180;
  const up = [-Math.sin(t), -Math.cos(t)];
  const perp = [Math.cos(ro), -Math.sin(ro)];
  const pelvis = [80 + shift, 110 + dip];
  const neck = [pelvis[0] + up[0] * 36, pelvis[1] + up[1] * 36];
  const S = [neck[0] - up[0] * 3, neck[1] - up[1] * 3];
  const shL = [S[0] - perp[0] * 14 * fs, S[1] - perp[1] * 14 * fs];
  const shR = [S[0] + perp[0] * 14 * fs, S[1] + perp[1] * 14 * fs];
  const hipL = [pelvis[0] - 10 * fh, pelvis[1]];
  const hipR = [pelvis[0] + 10 * fh, pelvis[1]];
  const a = (A * Math.PI) / 180;
  const c = (C * Math.PI) / 180;
  const dir = [-Math.sin(c), Math.cos(c)];
  const hands = [shR[0] - R * Math.sin(a), shR[1] + R * Math.cos(a)];
  const handT = [hands[0] + dir[0] * 3.6, hands[1] + dir[1] * 3.6];
  // Both hands hold one grip: never further from the trail shoulder than that arm reaches.
  // Through impact this is what straightens both arms, as in a real swing.
  const trailReach = Math.hypot(handT[0] - shL[0], handT[1] - shL[1]);
  if (trailReach > REACH) {
    const k = REACH / trailReach;
    const nx = shL[0] + (handT[0] - shL[0]) * k;
    const ny = shL[1] + (handT[1] - shL[1]) * k;
    hands[0] += nx - handT[0];
    hands[1] += ny - handT[1];
    handT[0] = nx;
    handT[1] = ny;
  }
  const ankL = [65 + 9 * heel, 155 - 4 * heel];
  const ankR = [95, 155];
  // Knees between hip and ankle, nudged toward the target line: never crossed
  const knL = [(hipL[0] + ankL[0]) / 2 + 2 + 5 * knee, (hipL[1] + ankL[1]) / 2];
  const knR = [(hipR[0] + ankR[0]) / 2 - 1.5 + kneeR, (hipR[1] + ankR[1]) / 2];
  return {
    neck, shL, shR, hipL, hipR, hands, handT, dir, ankL, ankR, knL, knR,
    club: [hands[0] + dir[0] * CLUB, hands[1] + dir[1] * CLUB],
    elR: elbowOf(shR[0], shR[1], hands[0], hands[1]),
    elL: elbowOf(shL[0], shL[1], handT[0], handT[1]),
    head: [neck[0] + up[0] * 11.5, neck[1] + up[1] * 11.5],
    look,
    heel,
  };
}

export const SWING_BALL = (() => {
  const club = swingSolve(swingPose(SWING_IMPACT)).club;
  return [club[0], 157.4];
})();

const TURF = [0, 1, 2, 3];

export function swingFrame(sec) {
  'worklet';
  const t = sec % SWING_CYCLE;
  const f = swingSolve(swingPose(t));
  const P = (pt) => `${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`;
  const lerp = (a, b, p) => a + (b - a) * p;
  const sleeveEnd = (sh, el) => [sh[0] + (el[0] - sh[0]) * 0.55, sh[1] + (el[1] - sh[1]) * 0.55];
  const sL = sleeveEnd(f.shL, f.elL);
  const sR = sleeveEnd(f.shR, f.elR);
  const [hx, hy] = f.head;
  const clubDeg = (Math.atan2(f.dir[1], f.dir[0]) * 180) / Math.PI + 90;

  // Motion streak: where the clubhead was over the last 70 ms, so it is long only where the club is fast
  const from = Math.max(KEYS[4][0] - 0.06, t - 0.07);
  const to = Math.min(t, KEYS[9][0]);
  let trail = '';
  if (to - from > 0.004) {
    for (let v = from; v <= to; v += 0.004) trail += `${trail ? 'L' : 'M'}${P(swingSolve(swingPose(v)).club)} `;
  }

  // Ball: sits until impact, then launches up and away; a little turf follows low
  const fp = seg(t, SWING_IMPACT, SWING_IMPACT + 0.35);
  const inFlight = t >= SWING_IMPACT && t < SWING_SNAP;
  const snapIn = seg(t, SWING_SNAP, SWING_CYCLE);
  const tp = seg(t, SWING_IMPACT, SWING_IMPACT + 0.3);
  const turf = TURF.map((i) => ({
    x: SWING_BALL[0] + 14 * tp * (1 + i * 0.45) - 1,
    y: SWING_BALL[1] + 1 - (7 + 3 * i) * tp + 16 * tp * tp,
    opacity: t < SWING_IMPACT || tp >= 1 ? 0 : 1 - tp,
  }));

  return {
    figureOpacity: t < SWING_FADE_OUT ? 1 : t < SWING_SNAP ? 1 - seg(t, SWING_FADE_OUT, SWING_SNAP) : snapIn,
    legL: `M${P(f.hipL)} L${P(f.knL)} L${P(f.ankL)}`,
    legR: `M${P(f.hipR)} L${P(f.knR)} L${P(f.ankR)}`,
    // Trail shoe rolls onto its toe through the finish
    shoeL: ellipsePath(f.ankL[0] - 1.5 + 2 * f.heel, f.ankL[1] + 2.4, lerp(5.4, 2.6, f.heel), lerp(2.3, 3.6, f.heel)),
    shoeR: ellipsePath(f.ankR[0] + 1.5, f.ankR[1] + 2.4, 5.4, 2.3),
    torso: `M${P(f.hipL)} L${P(f.hipR)} L${P(f.shR)} L${P(f.shL)} Z`,
    belt: [f.hipL[0], f.hipL[1] - 1.5, f.hipR[0], f.hipR[1] - 1.5],
    neckLine: [f.neck[0], f.neck[1], hx, hy + 5],
    armL: `M${P(sL)} L${P(f.elL)} L${P(f.handT)}`,
    sleeveL: `M${P(f.shL)} L${P(sL)}`,
    armR: `M${P(sR)} L${P(f.elR)} L${P(f.hands)}`,
    sleeveR: `M${P(f.shR)} L${P(sR)}`,
    handT: f.handT,
    hands: f.hands,
    shaft: [f.hands[0], f.hands[1], f.club[0], f.club[1]],
    grip: [f.hands[0] - f.dir[0] * 2.5, f.hands[1] - f.dir[1] * 2.5, f.hands[0] + f.dir[0] * 7, f.hands[1] + f.dir[1] * 7],
    clubhead: ellipsePath(f.club[0], f.club[1], 3.2, 1.6, clubDeg),
    head: f.head,
    capDome: `M${(hx - 7.9).toFixed(2)} ${(hy - 0.8).toFixed(2)} A7.9 7.9 0 0 1 ${(hx + 7.9).toFixed(2)} ${(hy - 0.8).toFixed(2)} Z`,
    brim: ellipsePath(hx + 0.8 + 3.6 * f.look, hy - 0.4, lerp(5.8, 4.6, f.look), 1.8),
    trail,
    ballX: inFlight ? SWING_BALL[0] + 150 * fp : SWING_BALL[0],
    ballY: inFlight ? SWING_BALL[1] - 130 * fp + 40 * fp * fp : SWING_BALL[1],
    ballR: inFlight ? 2.6 * (1 - 0.45 * fp) : 2.6,
    ballOpacity: inFlight ? (fp >= 1 ? 0 : 1 - seg(fp, 0.7, 1)) : t >= SWING_SNAP ? snapIn : 1,
    turf,
  };
}

// ---------------------------------------------------------------------------
// Scene "water": a ball arrives on a steep line, plops into a pond, throws a few droplets
// and leaves rings spreading. Splash point (80, 83); times in seconds.
// ---------------------------------------------------------------------------

export const WATER_CYCLE = 2.8;
export const WATER_STILL = 0.62 * WATER_CYCLE;   // reduced motion: rings spreading, ball and droplets gone
export const WATER_SPLASH = [80, 82];
const WATER_ENTRY = [[14, -24], [62, -14], [80, 82]];
const W_LAND = 0.36;

function waterPoint(t) {
  'worklet';
  const m = 1 - t;
  return [
    m * m * WATER_ENTRY[0][0] + 2 * m * t * WATER_ENTRY[1][0] + t * t * WATER_ENTRY[2][0],
    m * m * WATER_ENTRY[0][1] + 2 * m * t * WATER_ENTRY[1][1] + t * t * WATER_ENTRY[2][1],
  ];
}

// Arc length -> point along the ball's last few metres of flight.
const WATER_LUT = (() => {
  const out = [[0, WATER_ENTRY[0][0], WATER_ENTRY[0][1]]];
  for (let i = 1; i <= 120; i++) {
    const [x, y] = waterPoint(i / 120);
    const prev = out[i - 1];
    out.push([prev[0] + Math.hypot(x - prev[1], y - prev[2]), x, y]);
  }
  return out;
})();
const WATER_LENGTH = WATER_LUT[WATER_LUT.length - 1][0];

function waterPointAt(s) {
  'worklet';
  for (let i = 0; i < WATER_LUT.length; i++) {
    if (WATER_LUT[i][0] >= s) return [WATER_LUT[i][1], WATER_LUT[i][2]];
  }
  const last = WATER_LUT[WATER_LUT.length - 1];
  return [last[1], last[2]];
}

const RIPPLE_DELAYS = [0, 0.28, 0.56];
const DROPS = [[-9, 14], [-4, 20], [3, 22], [8, 15], [12, 9]];
const GLINTS = [
  { x: 34, y: 98, w: 30, delay: 0 },
  { x: 98, y: 106, w: 18, delay: -1.2 },
];

export function waterFrame(t) {
  'worklet';
  const sec = t % WATER_CYCLE;
  const u = sec / WATER_CYCLE;
  // Ball: speeds up as it falls, then is gone under the surface
  const [bx, by] = waterPointAt(WATER_LENGTH * cubicBezier(0.45, 0, 0.9, 0.6, seg(u, 0, W_LAND)));
  const sink = seg(u, W_LAND, 0.39);
  const ballOpacity = u < W_LAND ? clamp01(u / 0.03) : 1 - sink;
  // Rings: each opens fast and fades as it spreads, a beat after the last
  const ripples = RIPPLE_DELAYS.map((delay) => {
    const v = (((sec - delay) % WATER_CYCLE) + WATER_CYCLE) % WATER_CYCLE / WATER_CYCLE;
    if (v < W_LAND) return { rx: 3, ry: 0.8, opacity: 0 };
    if (v < 0.38) {
      const p = seg(v, W_LAND, 0.38);
      return { rx: 15 * (0.2 + 0.1 * p), ry: 4 * (0.2 + 0.1 * p), opacity: 0.8 * p };
    }
    const p = cubicBezier(0.2, 0.7, 0.4, 1, seg(v, 0.38, 0.9));
    const scale = 0.3 + 2.5 * p;
    return { rx: 15 * scale, ry: 4 * scale, opacity: 0.8 * (1 - seg(v, 0.38, 0.9)) };
  });
  // Droplets: thrown up and out, then falling back
  const drops = DROPS.map(([dx, h]) => {
    if (u < 0.37 || u >= 0.56) return { x: WATER_SPLASH[0], y: WATER_SPLASH[1], opacity: 0 };
    if (u < 0.45) {
      const p = cubicBezier(0.2, 0.7, 0.4, 1, seg(u, 0.37, 0.45));
      return { x: WATER_SPLASH[0] + dx * 0.6 * p, y: WATER_SPLASH[1] - h * p, opacity: 0.95 };
    }
    const p = cubicBezier(0.55, 0, 1, 0.45, seg(u, 0.45, 0.54));
    return {
      x: WATER_SPLASH[0] + dx * (0.6 + 0.4 * p),
      y: WATER_SPLASH[1] - h + (h + 2) * p,
      opacity: u < 0.54 ? 0.95 - 0.35 * p : 0.6 * (1 - seg(u, 0.54, 0.56)),
    };
  });
  // Glints drifting on the surface, back and forth
  const glints = GLINTS.map((g) => {
    const phase = (((sec - g.delay) % 6.8) + 6.8) % 6.8 / 3.4;
    const p = easeIO(phase <= 1 ? phase : 2 - phase);
    return { x1: g.x - 6 + 12 * p, x2: g.x + g.w - 6 + 12 * p, y: g.y, opacity: 0.28 * (0.4 + 0.6 * p) };
  });
  return {
    ballX: bx,
    ballY: by,
    ballScale: 1 - 0.7 * sink,
    ballOpacity: u >= 0.39 ? 0 : ballOpacity,
    ripples,
    drops,
    glints,
  };
}
