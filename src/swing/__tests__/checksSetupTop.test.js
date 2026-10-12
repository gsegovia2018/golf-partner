// D21: the four setup checks at address and the two top-position checks, driven with tiny
// synthetic poses (1 px = 1 cm, ball on the +x side, right-handed unless said).
import { runChecks } from '../checks';

const rad = (d) => (d * Math.PI) / 180;
const blank = () => Array.from({ length: 33 }, () => [0, 0, 1]);
const pose = (pts) => {
  const lm = blank();
  Object.entries(pts).forEach(([i, p]) => { lm[i] = [p[0], p[1], 1]; });
  return lm;
};
const both = (i, j, p) => ({ [i]: p, [j]: p });
const at = (frame, hands) => ({ frame, hands: { x: hands[0], y: hands[1] }, head: null, hidden: false, source: 'user' });

const run = (cps, lmAt, extra = {}) => runChecks({
  checkpoints: cps, ball: { x: 300, y: 200 }, pose: lmAt, handedness: 'right', pxPerCm: 1, heightCm: 176, ...extra,
}).checks;
const one = (checks, id) => checks.find((c) => c.id === id);

describe('hands_under_shoulders (address)', () => {
  const read = (handsX) => one(run({ address: at(1, [handsX, 100]) }, () => pose({ ...both(11, 12, [50, 0]) })), 'hands_under_shoulders');
  test('green within 4 cm either way, yellow to 8, red beyond; + is out toward the ball', () => {
    expect(read(53).status).toBe('green');
    expect(read(46).status).toBe('green');
    expect(read(56)).toMatchObject({ status: 'yellow', value: 6, dir: 'out' });
    expect(read(43)).toMatchObject({ status: 'yellow', value: -7, dir: 'in' });
    expect(read(60)).toMatchObject({ status: 'red', dir: 'out' });
    expect(read(60).text).toMatch(/out past the shoulders/);
    expect(read(40).text).toMatch(/inside the shoulders/);
  });
});

describe('waist_bend (address)', () => {
  // hips at the origin, knees straight down, the torso `bend` degrees from the thigh line.
  const read = (bend) => one(run({ address: at(1, [0, 0]) }, () => pose({
    ...both(23, 24, [0, 0]), ...both(25, 26, [0, 50]), ...both(11, 12, [100 * Math.sin(rad(bend)), 100 * Math.cos(rad(bend))]),
  })), 'waist_bend');
  test('ideal about 135: green 125-145, yellow 115-125 / 145-155, else red', () => {
    expect(read(135)).toMatchObject({ status: 'green', value: 135 });
    expect(read(126).status).toBe('green');
    expect(read(120)).toMatchObject({ status: 'yellow', dir: 'over' });
    expect(read(150)).toMatchObject({ status: 'yellow', dir: 'tall' });
    expect(read(110).status).toBe('red');
    expect(read(165)).toMatchObject({ status: 'red', dir: 'tall' });
  });
});

describe('back_line (address)', () => {
  // spine from the hips (0, 0) up and toward the ball at 45 degrees; the ear continues it,
  // bent by `kink` degrees (+ = toward the ball and down: dropped).
  const read = (kink) => {
    const sh = [100 * Math.cos(rad(45)), -100 * Math.sin(rad(45))];
    const a = rad(45 - kink);
    const ear = [sh[0] + 30 * Math.cos(a), sh[1] - 30 * Math.sin(a)];
    return one(run({ address: at(1, [0, 0]) }, () => pose({ ...both(23, 24, [0, 0]), ...both(11, 12, sh), ...both(7, 8, ear) })), 'back_line');
  };
  test('green up to 10 degrees, yellow to 20, red beyond; the side names the fault', () => {
    expect(read(5)).toMatchObject({ status: 'green', value: 5 });
    expect(read(15)).toMatchObject({ status: 'yellow', dir: 'dropped' });
    expect(read(30)).toMatchObject({ status: 'red', dir: 'dropped' });
    expect(read(30).text).toMatch(/rounded/);
    expect(read(-15)).toMatchObject({ status: 'yellow', dir: 'up' });
  });
});

describe('hand_gap (address)', () => {
  // lead hip (23) at x 0, lead knee (25) straight below: the thigh line is x = 0.
  const read = (gap) => one(run({ address: at(1, [gap, 60]) }, () => pose({ 23: [0, 0], 25: [0, 80] })), 'hand_gap');
  test('green 10-20 cm, yellow 6-10 / 20-25, red closer or further', () => {
    expect(read(15)).toMatchObject({ status: 'green', value: 15 });
    expect(read(8)).toMatchObject({ status: 'yellow', dir: 'close' });
    expect(read(22)).toMatchObject({ status: 'yellow', dir: 'far' });
    expect(read(4)).toMatchObject({ status: 'red', dir: 'close' });
    expect(read(30)).toMatchObject({ status: 'red', dir: 'far' });
    expect(read(30).text).toMatch(/reaching/);
  });
  test('reads the thigh line extended to the hands, not the hip x', () => {
    const slanted = one(run({ address: at(1, [30, 100]) }, () => pose({ 23: [0, 0], 25: [10, 50] })), 'hand_gap');
    expect(slanted.value).toBe(10); // the line is at x = 20 at the hands' height
  });
});

describe('hands_over_heels (top)', () => {
  const read = (x) => one(run({ top: at(5, [x, 0]) }, () => pose({ 30: [100, 300] })), 'hands_over_heels');
  test('green within 6 cm of the trail heel, yellow to 12, red beyond; behind = too deep', () => {
    expect(read(104).status).toBe('green');
    expect(read(92)).toMatchObject({ status: 'yellow', value: -8, dir: 'deep' });
    expect(read(85)).toMatchObject({ status: 'red', dir: 'deep' });
    expect(read(115)).toMatchObject({ status: 'red', dir: 'shallow' });
    expect(read(115).text).toMatch(/not enough depth/);
  });
  test('unknown without a top mark', () => {
    expect(one(run({}, () => pose({})), 'hands_over_heels').status).toBe('unknown');
  });
});

describe('lead_arm_shoulder_plane (top)', () => {
  // Ball (300, 200); trail shoulder at address straight up-and-back at 45 degrees: the plane.
  // At the top the lead shoulder (11) is at the origin and the lead wrist (15) at `deg`.
  const read = (deg) => one(run(
    { address: at(1, [0, 0]), top: at(5, [0, 0]) },
    (f) => (f === 1 ? pose({ 12: [200, 100] }) : pose({ 11: [0, 0], 15: [-60 * Math.cos(rad(deg)), -60 * Math.sin(rad(deg))] })),
  ), 'lead_arm_shoulder_plane');
  test('green within 10 degrees, yellow to 20, red beyond; above = more upright', () => {
    expect(read(50)).toMatchObject({ status: 'green', value: 5 });
    expect(read(60)).toMatchObject({ status: 'yellow', dir: 'above' });
    expect(read(30)).toMatchObject({ status: 'yellow', value: -15, dir: 'below' });
    expect(read(75)).toMatchObject({ status: 'red', dir: 'above' });
    expect(read(15)).toMatchObject({ status: 'red', dir: 'below' });
  });
});

describe('left-handers', () => {
  test('hands_under_shoulders reads the same mirrored', () => {
    const right = one(run({ address: at(1, [60, 100]) }, () => pose({ ...both(11, 12, [50, 0]) })), 'hands_under_shoulders');
    const left = one(run({ address: at(1, [540, 100]) }, () => pose({ ...both(11, 12, [550, 0]) }), { handedness: 'left' }), 'hands_under_shoulders');
    expect([left.status, left.value]).toEqual([right.status, right.value]);
  });
});
