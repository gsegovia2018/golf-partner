// Swing checks v2 (spec 2026-10-18 §4, §5): the new rows driven with tiny synthetic poses
// (1 px = 1 cm, 176 cm golfer, ball at (300, 200) on the +x side, right-handed unless said).
// Bands are the provisional limits of the spec; a calibration moves the numbers, not the shapes.
import { runChecks } from '../checks';
import { unplacedCheckpoint, POSITIONS } from '../checkpointChecks';
import { CHECK_MIN_CONF } from '../club';

const BALL = { x: 300, y: 200 };
const rad = (d) => (d * Math.PI) / 180;
const blank = () => Array.from({ length: 33 }, () => [0, 0, 1]);
const pose = (pts) => {
  const lm = blank();
  Object.entries(pts).forEach(([i, p]) => { lm[i] = [p[0], p[1], 1]; });
  return lm;
};
const pt = (x, y) => ({ x, y });
const mark = (frame, hands, head = null, extra = {}) => ({
  frame, hands, head, hidden: false, source: 'user', ...extra,
});
const run = (cps, poseAt = () => null, extra = {}) => runChecks({
  checkpoints: cps, ball: BALL, pose: poseAt, handedness: 'right', pxPerCm: 1, heightCm: 176, ...extra,
}).checks;
const one = (checks, id, cp) => checks.find((c) => c.id === id && (!cp || c.cp === cp));

// The address plane: ball (300, 200) -> address hands (200, 100), a 45 degree line. A point `d` cm
// off it (+ = above / outside, toward the ball side).
const ADDRESS = mark(1, pt(200, 100));
const OFF = (d) => pt(250 + d / Math.SQRT2, 150 - d / Math.SQRT2);

describe('knee_flex (address)', () => {
  // trail knee (26) at the origin, ankle (28) straight below, hip (24) rotated `flex` degrees off straight.
  const read = (flex) => one(run({ address: ADDRESS }, () => pose({
    24: [50 * Math.sin(rad(flex)), -50 * Math.cos(rad(flex))], 26: [0, 0], 28: [0, 50],
  })), 'knee_flex');
  test('15-30 green, 10-35 yellow, else red; too little = stiff, too much = squat; fault posture', () => {
    expect(read(22)).toMatchObject({
      status: 'green', value: 22, dir: null, position: 'address', fault: 'posture', severity: 0,
    });
    expect(read(12)).toMatchObject({ status: 'yellow', dir: 'stiff', severity: 0.6 });
    expect(read(8)).toMatchObject({ status: 'red', dir: 'stiff', severity: 0.4 });
    expect(read(33)).toMatchObject({ status: 'yellow', dir: 'squat' });
    expect(read(40)).toMatchObject({ status: 'red', dir: 'squat' });
    expect(read(40).text).toMatch(/sitting down/);
  });
  test('unknown without the trail leg', () => {
    expect(one(run({ address: ADDRESS }), 'knee_flex')).toMatchObject({ status: 'unknown', reason: 'nopose' });
  });
});

describe('shaft_plane (address)', () => {
  // Mid-hip at the origin: the body front is 0.05 x 176 = 8.8 cm toward the ball. The shaft runs
  // from the head at the ball to the hands, on the line that crosses the body front `d` cm above the hips.
  const read = (d, extra = {}) => {
    const p = pt(8.8, -d);
    const head = pt(300, 200);
    const hands = pt(p.x + 0.8 * (head.x - p.x), p.y + 0.8 * (head.y - p.y));
    return one(run({ address: mark(1, hands, head, extra) }, () => pose({ 23: [0, 0], 24: [0, 0] })), 'shaft_plane');
  };
  test('green within 10 cm of the belt either way, yellow to 18, red beyond; + = upright; the angle is shown', () => {
    expect(read(5)).toMatchObject({ status: 'green', value: 5, dir: 'upright', fault: 'posture' });
    expect(read(-5)).toMatchObject({ status: 'green', value: -5, dir: 'flat' });
    expect(read(14)).toMatchObject({ status: 'yellow', dir: 'upright', severity: 0.5 });
    expect(read(-14)).toMatchObject({ status: 'yellow', dir: 'flat' });
    expect(read(20)).toMatchObject({ status: 'red', dir: 'upright' });
    expect(read(-25)).toMatchObject({ status: 'red', dir: 'flat' });
    expect(read(5).shaftDeg).toBeGreaterThan(30);
    expect(read(20).text).toMatch(/above your belt \(upright\)/);
  });
  test('needs the address clubhead: unplaced without one, hidden when marked hidden', () => {
    const noHead = one(run({ address: mark(1, pt(200, 100), null, { source: 'prior' }) }, () => pose({ 23: [0, 0], 24: [0, 0] })), 'shaft_plane');
    expect(noHead).toMatchObject({ status: 'unknown', reason: 'unplaced' });
    const hidden = one(run({ address: mark(1, pt(200, 100), null, { hidden: true }) }, () => pose({ 23: [0, 0], 24: [0, 0] })), 'shaft_plane');
    expect(hidden).toMatchObject({ status: 'unknown', reason: 'hidden' });
  });
});

describe('clubhead_plane_takeaway (P2)', () => {
  const read = (d) => one(run({ address: ADDRESS, takeaway: mark(2, pt(240, 150), OFF(d)) }), 'clubhead_plane_takeaway');
  test('green within 8 cm, yellow to 15, red beyond; + (outside) = steep, - (inside) = flat', () => {
    expect(read(5)).toMatchObject({ status: 'green', value: 5, position: 'takeaway' });
    expect(read(10)).toMatchObject({ status: 'yellow', dir: 'steep', fault: 'steep_backswing' });
    expect(read(-10)).toMatchObject({ status: 'yellow', dir: 'flat', fault: 'flat_backswing' });
    expect(read(20)).toMatchObject({ status: 'red', dir: 'steep' });
    expect(read(-20)).toMatchObject({ status: 'red', dir: 'flat', severity: 0.71 });
  });
  test('unknown without a takeaway mark, or without the address plane', () => {
    expect(one(run({ address: ADDRESS }), 'clubhead_plane_takeaway')).toMatchObject({ status: 'unknown', reason: 'nodata' });
    const noAddress = one(run({ takeaway: mark(2, pt(240, 150), OFF(0)) }), 'clubhead_plane_takeaway');
    expect(noAddress).toMatchObject({ status: 'unknown', reason: 'nodata' });
  });
});

describe('clubhead_plane_down (P6) and down_vs_takeaway', () => {
  const read = (d, back = 0, id = 'clubhead_plane_down') => one(run({
    address: ADDRESS, takeaway: mark(2, pt(240, 150), OFF(back)), shaftDown: mark(5, pt(240, 150), OFF(d)),
  }), id);
  test('above: green to 4 cm, yellow to 10 (over the top); under: green to 12, yellow to 20 (stuck)', () => {
    expect(read(3)).toMatchObject({ status: 'green', dir: 'steep', fault: 'over_the_top', position: 'shaftDown' });
    expect(read(7)).toMatchObject({ status: 'yellow', dir: 'steep', fault: 'over_the_top' });
    expect(read(12)).toMatchObject({ status: 'red', dir: 'steep', severity: 0.33 });
    expect(read(-10)).toMatchObject({ status: 'green', dir: 'under', fault: 'stuck' });
    expect(read(-15)).toMatchObject({ status: 'yellow', dir: 'under', fault: 'stuck' });
    expect(read(-25)).toMatchObject({ status: 'red', dir: 'under', fault: 'stuck' });
    expect(read(-25).text).toMatch(/stuck/);
  });
  test('down_vs_takeaway: down minus back, + = steeper; green to 0, yellow to 10, red beyond', () => {
    expect(read(-15, -10, 'down_vs_takeaway')).toMatchObject({ status: 'green', value: -5, fault: 'over_the_top' });
    expect(read(-5, -10, 'down_vs_takeaway')).toMatchObject({ status: 'yellow', value: 5, dir: 'steeper' });
    expect(read(12, 0, 'down_vs_takeaway')).toMatchObject({ status: 'red', value: 12 });
  });
  test('down_vs_takeaway needs both clubheads and names the missing one', () => {
    const cps = {
      address: ADDRESS, takeaway: mark(2, pt(240, 150), null, { hidden: true }), shaftDown: mark(5, pt(240, 150), OFF(3)),
    };
    const row = one(run(cps), 'down_vs_takeaway');
    expect(row).toMatchObject({ status: 'unknown', reason: 'hidden', cps: ['takeaway', 'shaftDown'] });
    expect(row.text).toMatch(/takeaway/i);
    const noDown = one(run({ ...cps, takeaway: mark(2, pt(240, 150), OFF(0)), shaftDown: mark(5, pt(240, 150), null, { source: 'prior' }) }), 'down_vs_takeaway');
    expect(noDown).toMatchObject({ status: 'unknown', reason: 'unplaced' });
  });
});

describe('spine_hold and knee_hold', () => {
  // Level hips at the origin, shoulders `tilt` degrees off vertical toward the ball; the trail leg
  // (hip 24, knee 26, ankle 28) flexed `flex` degrees.
  const body = (tilt, flex = 20) => pose({
    11: [100 * Math.sin(rad(tilt)), -100 * Math.cos(rad(tilt))],
    12: [100 * Math.sin(rad(tilt)), -100 * Math.cos(rad(tilt))],
    23: [0, 0],
    24: [0, 0],
    26: [-50 * Math.sin(rad(flex)), 50 * Math.cos(rad(flex))],
    28: [-50 * Math.sin(rad(flex)), 50 * Math.cos(rad(flex)) + 50],
  });
  const frames = { address: 1, takeaway: 2, leadArm: 3, top: 4, shaftDown: 5 };
  const cps = Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, mark(f, pt(0, 0))]));
  test('spine_hold runs at P2, P3, P4 and P6; + = standing up; posture_loss before the downswing, early extension at P6', () => {
    const checks = run(cps, (f) => body(f === 1 ? 35 : 35 - (f === 5 ? 8 : 4)));
    const rows = checks.filter((c) => c.id === 'spine_hold');
    expect(rows.map((c) => c.cp)).toEqual(['takeaway', 'leadArm', 'top', 'shaftDown']);
    expect(rows.map((c) => c.position)).toEqual(['takeaway', 'leadArm', 'top', 'shaftDown']);
    expect(one(checks, 'spine_hold', 'takeaway')).toMatchObject({ status: 'yellow', value: 4, dir: 'up', fault: 'posture_loss' });
    expect(one(checks, 'spine_hold', 'shaftDown')).toMatchObject({ status: 'red', value: 8, fault: 'early_extension' });
    const bent = one(run(cps, (f) => body(f === 1 ? 35 : 42)), 'spine_hold', 'top');
    expect(bent).toMatchObject({ status: 'red', value: -7, dir: 'down' });
    expect(bent.text).toMatch(/more bent over/);
  });
  test('knee_hold runs at P2 and P3: flex(P) - flex(address), - = straightening; 5 / 10 degrees', () => {
    const at = (d) => run(cps, (f) => body(35, f === 1 ? 25 : 25 + d));
    expect(at(-3).filter((c) => c.id === 'knee_hold').map((c) => [c.cp, c.status])).toEqual([['takeaway', 'green'], ['leadArm', 'green']]);
    expect(one(at(-7), 'knee_hold', 'takeaway')).toMatchObject({ status: 'yellow', value: -7, dir: 'straighten', fault: 'posture_loss' });
    expect(one(at(12), 'knee_hold', 'leadArm')).toMatchObject({ status: 'red', value: 12, dir: 'flex' });
  });
  test('unknown without the pose at the position', () => {
    const row = one(run(cps, (f) => (f === 4 ? null : body(35))), 'spine_hold', 'top');
    expect(row).toMatchObject({ status: 'unknown', reason: 'nopose' });
    expect(row.text).toMatch(/top/i);
  });
});

describe('lead_arm_spine (top)', () => {
  // Spine 30 degrees off vertical; the lead arm (11 -> 15) turned `d` degrees from the
  // perpendicular to the spine toward the spine itself (+ = more upright).
  const read = (d) => {
    const s = [Math.sin(rad(30)), -Math.cos(rad(30))];
    const p = [-Math.cos(rad(30)), -Math.sin(rad(30))];
    const arm = [p[0] * Math.cos(rad(d)) + s[0] * Math.sin(rad(d)), p[1] * Math.cos(rad(d)) + s[1] * Math.sin(rad(d))];
    const sh = [100 * s[0], 100 * s[1]];
    return one(run({ top: mark(4, pt(0, 0)) }, () => pose({
      23: [0, 0], 24: [0, 0], 11: sh, 12: sh, 15: [sh[0] + 60 * arm[0], sh[1] + 60 * arm[1]],
    })), 'lead_arm_spine');
  };
  test('green within 10 degrees of square, yellow to 20, red beyond; + = upright, - = flat; fault top_position', () => {
    expect(read(5)).toMatchObject({ status: 'green', value: 5, fault: 'top_position', position: 'top' });
    expect(read(15)).toMatchObject({ status: 'yellow', dir: 'upright' });
    expect(read(-15)).toMatchObject({ status: 'yellow', value: -15, dir: 'flat' });
    expect(read(25)).toMatchObject({ status: 'red', dir: 'upright' });
    expect(read(-25)).toMatchObject({ status: 'red', dir: 'flat' });
  });
});

describe('shaft_through_ball and through_vs_halfway (P9)', () => {
  // Toes (31, 32) at x 200 at address: the 10 % margin is 10 cm. A shaft whose line crosses ball
  // height at x = landX: grip at (150, 100), clubhead on the line.
  const shaft = (frame, landX, extra = {}) => mark(frame, pt(150, 100), pt(150 + (landX - 150) * 0.5, 150), extra);
  const toes = () => pose({ 31: [200, 200], 32: [200, 200] });
  const read = (cps, id) => one(run({ address: mark(1, pt(250, 120)), ...cps }, toes), id);
  test('shaft_through_ball: toes to ball green; beyond the ball = flip; inside the toes = over the top', () => {
    expect(read({ trailArm: shaft(7, 280) }, 'shaft_through_ball')).toMatchObject({ status: 'green', value: -20, position: 'trailArm' });
    expect(read({ trailArm: shaft(7, 320) }, 'shaft_through_ball')).toMatchObject({ status: 'yellow', dir: 'beyond', fault: 'flip' });
    expect(read({ trailArm: shaft(7, 330) }, 'shaft_through_ball')).toMatchObject({ status: 'red', dir: 'beyond' });
    expect(read({ trailArm: shaft(7, 195) }, 'shaft_through_ball')).toMatchObject({ status: 'yellow', dir: 'inside', fault: 'over_the_top' });
    expect(read({ trailArm: shaft(7, 180) }, 'shaft_through_ball')).toMatchObject({ status: 'red', dir: 'inside' });
  });
  test('through_vs_halfway: P9 landing minus P3 landing, 10 / 20 cm, fault flip', () => {
    const at = (back, through) => read({ leadArm: shaft(3, back), trailArm: shaft(7, through) }, 'through_vs_halfway');
    expect(at(280, 285)).toMatchObject({ status: 'green', value: 5, fault: 'flip' });
    expect(at(280, 295)).toMatchObject({ status: 'yellow', value: 15, dir: 'beyond' });
    expect(at(280, 255)).toMatchObject({ status: 'red', value: -25, dir: 'inside' });
  });
  test('through_vs_halfway names the missing clubhead', () => {
    const row = read({ leadArm: shaft(3, 280, { head: null, hidden: true }), trailArm: shaft(7, 285) }, 'through_vs_halfway');
    expect(row).toMatchObject({ status: 'unknown', reason: 'hidden' });
    expect(row.text).toMatch(/halfway back/i);
  });
});

describe('the clubhead gate (spec §5)', () => {
  const read = (extra) => one(run({ address: ADDRESS, takeaway: mark(2, pt(240, 150), OFF(10), extra) }), 'clubhead_plane_takeaway');
  test(`a model head below CHECK_MIN_CONF (${CHECK_MIN_CONF}) is unplaced; above it, or the golfer's mark, is measured`, () => {
    expect(read({ source: 'model', conf: 0.05 })).toMatchObject({ status: 'unknown', reason: 'unplaced', text: 'Clubhead not visible — tap to place' });
    expect(read({ source: 'model-shaft', conf: 0.1 })).toMatchObject({ status: 'unknown', reason: 'unplaced' });
    expect(read({ source: 'model', conf: 0.5 })).toMatchObject({ status: 'yellow', value: 10 });
    expect(read({ source: 'edge', conf: 0.4 })).toMatchObject({ status: 'yellow' });
    expect(read({ source: 'user', conf: 1 })).toMatchObject({ status: 'yellow' });
    expect(read({ source: 'user' })).toMatchObject({ status: 'yellow' });
  });
  test('a gated head sends "tap to place" to its position; a trusted or hidden one does not', () => {
    const row = read({ source: 'model', conf: 0.05 });
    const head = [0.5, 0.5];
    expect(unplacedCheckpoint(row, { takeaway: { head, source: 'model', conf: 0.05, hidden: false } })).toBe('takeaway');
    expect(unplacedCheckpoint(row, { takeaway: { head, source: 'model', conf: 0.5, hidden: false } })).toBeNull();
    expect(unplacedCheckpoint(row, { takeaway: { head: null, source: 'user', hidden: true } })).toBeNull();
  });
});

describe('positions and left-handers', () => {
  // Frames 1-8: address, takeaway, lead arm, top, shaft down, impact, trail arm, finish.
  // A right-handed swing that measures every clubhead row, with a body for the pose rows.
  const body = (f) => pose({
    11: [40, -90], 12: [45, -88], 23: [0, 0], 24: [2, 0], 26: [-15 - f, 45], 28: [-15, 95], 25: [10, 45], 27: [10, 95],
    15: [10 - 5 * f, -120 + f], 31: [200, 200], 32: [205, 200], 0: [60, -120], 30: [-10, 100], 29: [20, 100],
    7: [55, -110], 8: [58, -108],
  });
  const cps = {
    address: mark(1, pt(200, 100), pt(298, 200)),
    takeaway: mark(2, pt(240, 150), OFF(-9)),
    leadArm: mark(3, pt(150, 100), pt(215, 150)),
    top: mark(4, pt(5, -60)),
    shaftDown: mark(5, pt(240, 150), OFF(6)),
    impact: mark(6, pt(205, 98), pt(300, 200)),
    trailArm: mark(7, pt(150, 100), pt(240, 150)),
    finish: mark(8, pt(0, -100)),
  };
  const mirrorX = (x) => 2 * BALL.x - x;
  const SWAP = [[7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
  const mirrorPose = (lm) => {
    const out = lm.map(([x, y, v]) => [mirrorX(x), y, v]);
    SWAP.forEach(([a, b]) => { [out[a], out[b]] = [out[b], out[a]]; });
    return out;
  };
  const mp = (p) => (p ? pt(mirrorX(p.x), p.y) : p);
  const input = { motionStart: 1, finishQuietS: 0.6 };
  const right = run(cps, body, input);

  test('every row is at one of the seven positions or an extra, in swing order', () => {
    right.forEach((c) => expect(c.extra ? c.position : POSITIONS.includes(c.position)).toBe(c.extra ? null : true));
    const order = right.filter((c) => !c.extra).map((c) => POSITIONS.indexOf(c.position));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(right.filter((c) => c.extra).map((c) => c.id)).toEqual([
      'tempo', 'finish_balance', 'head_drift', 'hands_height_impact', 'hands_out_impact', 'shaft_angle_impact',
    ]);
  });

  test('a left-hander mirrored around the ball reads the same on every row', () => {
    const lcps = Object.fromEntries(Object.entries(cps).map(([k, c]) => [k, { ...c, hands: mp(c.hands), head: mp(c.head) }]));
    const left = run(lcps, (f) => mirrorPose(body(f)), { ...input, handedness: 'left' });
    expect(left.map((c) => c.id)).toEqual(right.map((c) => c.id));
    const measured = right.filter((c) => c.status !== 'unknown').map((c) => c.id);
    ['knee_flex', 'shaft_plane', 'clubhead_plane_takeaway', 'knee_hold', 'butt_extension', 'lead_arm_spine',
      'clubhead_plane_down', 'down_vs_takeaway', 'shaft_through_ball', 'through_vs_halfway'].forEach((id) => expect(measured).toContain(id));
    right.forEach((r, n) => {
      expect([r.id, r.cp, left[n].status, left[n].dir ?? null]).toEqual([r.id, r.cp, r.status, r.dir ?? null]);
      if (typeof r.value === 'number') expect(Math.abs(left[n].value - r.value)).toBeLessThanOrEqual(0.5);
    });
  });
});
