// D21: the setup checks at address kept by checks v2 and hands over heels at the top, driven with tiny
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
  test('green within 8 cm either way, yellow to 12, red beyond; + is out toward the ball', () => {
    expect(read(57).status).toBe('green');
    expect(read(43).status).toBe('green');
    expect(read(60)).toMatchObject({ status: 'yellow', value: 10, dir: 'out' });
    expect(read(39)).toMatchObject({ status: 'yellow', value: -11, dir: 'in' });
    expect(read(64)).toMatchObject({ status: 'red', dir: 'out' });
    expect(read(64).text).toMatch(/out past the shoulders/);
    expect(read(36).text).toMatch(/inside the shoulders/);
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
  test('dropped (looking down at the ball): green to 40 degrees, yellow to 50; lifted: green to 10, yellow to 20', () => {
    expect(read(5)).toMatchObject({ status: 'green', value: 5 });
    expect(read(35)).toMatchObject({ status: 'green', value: 35, dir: 'dropped' });
    expect(read(45)).toMatchObject({ status: 'yellow', dir: 'dropped' });
    expect(read(55)).toMatchObject({ status: 'red', dir: 'dropped' });
    expect(read(55).text).toMatch(/rounded/);
    expect(read(-15)).toMatchObject({ status: 'yellow', dir: 'up' });
    expect(read(-25)).toMatchObject({ status: 'red', dir: 'up' });
  });
});

describe('hands_over_heels (top)', () => {
  const read = (x) => one(run({ top: at(5, [x, 0]) }, () => pose({ 30: [100, 300] })), 'hands_over_heels');
  test('green within 6 cm of the trail heel, yellow to 18, red beyond; behind = too deep', () => {
    expect(read(104).status).toBe('green');
    expect(read(92)).toMatchObject({ status: 'yellow', value: -8, dir: 'deep' });
    expect(read(85)).toMatchObject({ status: 'yellow', value: -15, dir: 'deep' });
    expect(read(80)).toMatchObject({ status: 'red', dir: 'deep' });
    expect(read(115)).toMatchObject({ status: 'yellow', dir: 'shallow' });
    expect(read(120)).toMatchObject({ status: 'red', dir: 'shallow' });
    expect(read(120).text).toMatch(/not enough depth/);
  });
  test('unknown without a top mark', () => {
    expect(one(run({}, () => pose({})), 'hands_over_heels').status).toBe('unknown');
  });
});

describe('left-handers', () => {
  test('hands_under_shoulders reads the same mirrored', () => {
    const right = one(run({ address: at(1, [60, 100]) }, () => pose({ ...both(11, 12, [50, 0]) })), 'hands_under_shoulders');
    const left = one(run({ address: at(1, [540, 100]) }, () => pose({ ...both(11, 12, [550, 0]) }), { handedness: 'left' }), 'hands_under_shoulders');
    expect([left.status, left.value]).toEqual([right.status, right.value]);
  });
});
