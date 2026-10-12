// D23: steep -> shallow -> steep. The shaft line (grip -> clubhead) extended to ball height,
// read against the ball and the toes at P6 (shaftDown) and P8 (shaftThrough). Synthetic, 1 px = 1 cm:
// ball at x 300 (height 200), toes at x 200; the golfer stands on the -x side.
import { runChecks } from '../checks';
import { mainFault } from '../priority';
import { checksAt } from '../checkpointChecks';

const pose = () => {
  const lm = Array.from({ length: 33 }, () => [0, 0, 1]);
  lm[31] = [200, 200, 1];
  lm[32] = [200, 200, 1];
  return lm;
};
// A shaft whose line crosses ball height (y 200) at x = landX: grip at (150, 100), head on the line.
const shaft = (frame, landX, extra = {}) => ({
  frame, hands: { x: 150, y: 100 }, head: { x: 150 + (landX - 150) * 0.5, y: 150 }, hidden: false, source: 'user', ...extra,
});
const run = (cps) => runChecks({
  checkpoints: { address: { frame: 1, hands: { x: 250, y: 120 }, head: null, hidden: false, source: 'user' }, ...cps },
  ball: { x: 300, y: 200 }, pose, handedness: 'right', pxPerCm: 1, heightCm: 176,
}).checks;
const one = (checks, id) => checks.find((c) => c.id === id);

describe('shaft_down_shallow at P6', () => {
  const read = (landX) => one(run({ shaftDown: shaft(10, landX) }), 'shaft_down_shallow');
  test('beyond the ball = shallow (green); toes to ball = yellow; inside the toes = steep (red)', () => {
    expect(read(320)).toMatchObject({ status: 'green', value: 20, dir: 'shallow' });
    expect(read(250)).toMatchObject({ status: 'yellow', value: -50, dir: 'steep' });
    expect(read(170)).toMatchObject({ status: 'red', dir: 'steep' });
    expect(read(170).text).toMatch(/over the top/);
    expect(read(170).phase).toBe('transition');
  });
  test('a steep P6 feeds over the top', () => {
    expect(mainFault([read(170)]).fault).toBe('over_the_top');
  });
});

describe('shaft_through_steep at P8', () => {
  const read = (landX) => one(run({ shaftThrough: shaft(20, landX) }), 'shaft_through_steep');
  test('between the toes and the ball, or inside, = green; beyond the ball yellow up to 15 cm, then red (flip)', () => {
    expect(read(260)).toMatchObject({ status: 'green', dir: 'steep' });
    expect(read(190).status).toBe('green');
    expect(read(310)).toMatchObject({ status: 'yellow', value: 10, dir: 'flat' });
    expect(read(330)).toMatchObject({ status: 'red', dir: 'flat' });
    expect(read(330).text).toMatch(/flip/);
  });
  test('a red flat P8 is the flip fault', () => {
    expect(mainFault([read(330)]).fault).toBe('flip');
  });
});

describe('both need the clubhead (D16)', () => {
  test('unplaced -> unknown with the place-clubhead reason; hidden -> hidden', () => {
    const checks = run({ shaftDown: shaft(10, 320, { head: null, source: 'prior' }), shaftThrough: shaft(20, 260, { head: null, hidden: true }) });
    expect(one(checks, 'shaft_down_shallow')).toMatchObject({ status: 'unknown', reason: 'unplaced', cps: ['shaftDown'] });
    expect(one(checks, 'shaft_through_steep')).toMatchObject({ status: 'unknown', reason: 'hidden' });
  });
  test('they live at their checkpoints', () => {
    const checks = run({ shaftDown: shaft(10, 320), shaftThrough: shaft(20, 260) });
    expect(checksAt(checks, 'shaftDown').map((c) => c.id)).toContain('shaft_down_shallow');
    expect(checksAt(checks, 'shaftThrough').map((c) => c.id)).toEqual(['shaft_through_steep']);
  });
});

describe('halfway back reads in the same words', () => {
  test('green is "steep enough", beyond the ball is shallow', () => {
    const lead = (landX) => one(run({ leadArm: shaft(5, landX) }), 'butt_extension');
    expect(lead(280)).toMatchObject({ status: 'green', label: 'Halfway back: steep' });
    expect(lead(280).text).toMatch(/steep enough/);
    expect(lead(330).text).toMatch(/shallow going back/);
  });
});
