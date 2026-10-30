// The coach-series rows (plan 2026-10-30): hands_bicep, swing_symmetry, finish_trail_foot and
// shaft_top, driven with tiny synthetic poses (1 px = 1 cm, ball at (300, 200) on the +x side,
// right-handed unless said). The limits are provisional; a calibration moves the numbers, not the shapes.
import { runChecks } from '../checks';
import { homeOf } from '../checkpointChecks';

const BALL = { x: 300, y: 200 };
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
const one = (checks, id) => checks.find((c) => c.id === id);
const mirrorX = (x) => 600 - x; // around the ball's x

describe('hands_bicep (halfway back)', () => {
  // Trail shoulder (12) at the origin; the grip `d` cm toward the ball of it.
  const read = (d) => one(run({ leadArm: mark(3, pt(d, 25)) }, () => pose({ 12: [0, 0] })), 'hands_bicep');
  test('-8..15 green, -14..22 yellow, else red; in front = out (steep), behind = deep (flat)', () => {
    expect(read(5)).toMatchObject({ status: 'green', value: 5, dir: null, fault: null, position: 'leadArm' });
    expect(read(18)).toMatchObject({ status: 'yellow', dir: 'out', fault: 'steep_backswing' });
    expect(read(25)).toMatchObject({ status: 'red', dir: 'out', fault: 'steep_backswing' });
    expect(read(-10)).toMatchObject({ status: 'yellow', dir: 'deep', fault: 'flat_backswing' });
    expect(read(-20)).toMatchObject({ status: 'red', dir: 'deep' });
    expect(read(25).text).toMatch(/25 cm in front of the trail shoulder/);
  });
  test('a left-hander mirrored around the ball reads the same (the trail shoulder is 11)', () => {
    const left = one(run({ leadArm: mark(3, pt(mirrorX(18), 25)) }, () => pose({ 11: [mirrorX(0), 0] }), { handedness: 'left' }), 'hands_bicep');
    expect(left).toMatchObject({ status: 'yellow', value: 18, dir: 'out' });
  });
  test('unknown without the pose or the halfway-back mark', () => {
    expect(one(run({ leadArm: mark(3, pt(5, 25)) }), 'hands_bicep')).toMatchObject({ status: 'unknown', reason: 'nopose' });
    expect(one(run({}, () => pose({ 12: [0, 0] })), 'hands_bicep')).toMatchObject({ status: 'unknown', reason: 'nodata' });
  });
});

describe('swing_symmetry (extra, listed under the follow-through)', () => {
  // Top at frame 10 with the hands at (200, 0): the line runs from the ball up and away. After impact
  // (frame 20, trail shoulder at y 120) the hands climb along it, `d` cm off it (+ = above / outside).
  const TOP = pt(200, 0);
  const N = { x: 2 / Math.sqrt(5), y: -1 / Math.sqrt(5) }; // unit normal to the ball side of the line
  const wrists = (p) => ({ 15: [p.x, p.y], 16: [p.x, p.y] });
  const poseAt = (d, { exit = true } = {}) => (f) => {
    if (f === 10) return pose(wrists(TOP));
    if (f === 20) return pose({ 12: [150, 120] });
    if (f > 20 && f <= 30 && exit) {
      const s = (f - 20) / 10;
      return pose(wrists(pt(BALL.x + s * (TOP.x - BALL.x) + d * N.x, BALL.y + s * (TOP.y - BALL.y) + d * N.y)));
    }
    return null;
  };
  const cps = { top: mark(10, TOP), impact: mark(20, pt(290, 190)), finish: mark(30, TOP) };
  const read = (d, extra) => one(run(cps, poseAt(d), extra), 'swing_symmetry');
  test('within 15 cm green, to 25 yellow, else red; above or under the line; no fault yet', () => {
    expect(read(0)).toMatchObject({ status: 'green', value: 0, extra: true });
    expect(read(-30).fault).toBeUndefined();
    expect(read(18)).toMatchObject({ status: 'yellow', value: 18, dir: 'above' });
    expect(read(-30)).toMatchObject({ status: 'red', value: -30, dir: 'under' });
    expect(read(-30).text).toMatch(/30 cm under the line/);
    expect(homeOf(read(0))).toBe('trailArm');
  });
  test('needs the ball, the frames in order and the hands seen climbing', () => {
    expect(read(0, { ball: null })).toMatchObject({ status: 'unknown', reason: 'nodata' });
    expect(one(run({ ...cps, finish: mark(15, TOP) }, poseAt(0)), 'swing_symmetry')).toMatchObject({ status: 'unknown', reason: 'nodata' });
    expect(one(run(cps, poseAt(0, { exit: false })), 'swing_symmetry')).toMatchObject({ status: 'unknown', reason: 'nodata' });
  });
});

describe('finish_trail_foot (extra, listed under the finish)', () => {
  // Trail heel (30) `v` cm above the trail toe (32) at the finish.
  const read = (v) => one(run({ finish: mark(40, pt(0, 0)) }, () => pose({ 30: [0, 100 - v], 32: [10, 100] })), 'finish_trail_foot');
  test('3 cm and up green, 1-3 yellow, under 1 red; fault balance', () => {
    expect(read(8)).toMatchObject({ status: 'green', value: 8, extra: true, fault: 'balance' });
    expect(read(2)).toMatchObject({ status: 'yellow', dir: 'flat' });
    expect(read(0)).toMatchObject({ status: 'red', dir: 'flat' });
    expect(read(0).text).toMatch(/only 0 cm above the toe/);
    expect(homeOf(read(8))).toBe('finish');
  });
  test('unknown without the trail foot', () => {
    expect(one(run({ finish: mark(40, pt(0, 0)) }), 'finish_trail_foot')).toMatchObject({ status: 'unknown', reason: 'nopose' });
  });
});

describe('shaft_top (extra, listed under the top)', () => {
  // Address: hands (200, 100), clubhead on the ball, a 141 cm picture shaft. A 600 px frame puts the
  // vanishing point at (300, 100). At the top the hands are at (100, 0) and a 50 cm shaft points `d`
  // degrees right of the vanishing point (+ = across the line).
  const ADDRESS = mark(1, pt(200, 100), pt(300, 200));
  const HANDS = pt(100, 0);
  const toVp = Math.atan2(100, 200);
  const headAt = (d, len = 50) => pt(HANDS.x + len * Math.cos(toVp - (d * Math.PI) / 180), HANDS.y + len * Math.sin(toVp - (d * Math.PI) / 180));
  const read = (d, { len, extra } = {}) => one(run({ address: ADDRESS, top: mark(4, HANDS, headAt(d, len)) }, () => null, { frameW: 600, ...extra }), 'shaft_top');
  test('within 20 degrees green, to 35 yellow, else red; across the line or laid off', () => {
    expect(read(0)).toMatchObject({ status: 'green', value: 0, extra: true, fault: null });
    expect(read(25)).toMatchObject({ status: 'yellow', value: 25, dir: 'across', fault: 'across_the_line' });
    expect(read(-40)).toMatchObject({ status: 'red', value: -40, dir: 'laid_off', fault: 'laid_off' });
    expect(read(25).text).toMatch(/25° right of the target line/);
    expect(homeOf(read(0))).toBe('top');
  });
  test('a left-hander mirrored around the ball reads the same', () => {
    const m = (p) => pt(mirrorX(p.x), p.y);
    const left = one(run({ address: mark(1, m(ADDRESS.hands), m(ADDRESS.head)), top: mark(4, m(HANDS), m(headAt(25))) }, () => null,
      { frameW: 600, handedness: 'left' }), 'shaft_top');
    expect(left).toMatchObject({ status: 'yellow', value: 25, dir: 'across' });
  });
  test('not graded short of parallel, without the clubheads or without the frame width', () => {
    expect(read(0, { len: 100 })).toMatchObject({ status: 'unknown', reason: 'nodata' });
    expect(read(0, { len: 100 }).text).toMatch(/short of parallel/);
    expect(read(-144)).toMatchObject({ status: 'unknown', reason: 'nodata' }); // pointing back at the camera
    const top = (extra) => one(run({ address: ADDRESS, top: mark(4, HANDS, null, extra) }, () => null, { frameW: 600 }), 'shaft_top');
    expect(top({ source: 'prior' })).toMatchObject({ status: 'unknown', reason: 'unplaced' });
    expect(top({ hidden: true })).toMatchObject({ status: 'unknown', reason: 'hidden' });
    expect(read(0, { extra: { frameW: undefined } })).toMatchObject({ status: 'unknown', reason: 'nodata' });
  });
});
