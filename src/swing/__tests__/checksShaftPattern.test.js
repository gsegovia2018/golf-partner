// The shaft line at the ball (D23, checks v2): the shaft (grip -> clubhead) extended to ball
// height, read against the ball and the toes halfway back (P3) and in the follow-through (P9).
// Synthetic, 1 px = 1 cm: ball at x 300 (height 200), toes at x 200; the golfer stands on the -x side.
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

describe('halfway back (P3): the shaft points at the ball', () => {
  const lead = (landX) => one(run({ leadArm: shaft(5, landX) }), 'butt_extension');
  test('green just inside the ball; beyond = flat, inside the toes = steep', () => {
    expect(lead(280)).toMatchObject({ status: 'green', label: 'Shaft points at the ball', position: 'leadArm', fault: null });
    expect(lead(280).text).toMatch(/steep enough/);
    expect(lead(330)).toMatchObject({ status: 'red', dir: 'flat', fault: 'flat_backswing' });
    expect(lead(330).text).toMatch(/shallow going back/);
    expect(lead(180)).toMatchObject({ status: 'red', dir: 'steep', fault: 'steep_backswing' });
  });
  test('a red flat P3 is a flat backswing', () => {
    expect(mainFault([lead(330)]).fault).toBe('flat_backswing');
  });
  test('a nearly flat shaft is capped 50 cm outside the zone, on either side, and stays red', () => {
    // 900 cm beyond the ball (the 122 cm lab reading, worse): reads 50 and says it was capped
    expect(lead(1200)).toMatchObject({ status: 'red', dir: 'flat', value: 50, capped: true });
    // far inside the toes: the cap is measured from the toes, so it never lands back in the green zone
    expect(lead(-700)).toMatchObject({ status: 'red', dir: 'steep', value: -150, capped: true });
    expect(lead(330).capped).toBe(false);
  });
});

describe('follow-through (P9): the same reading after impact', () => {
  const through = (landX) => one(run({ trailArm: shaft(20, landX) }), 'shaft_through_ball');
  test('a red beyond P9 is the flip; a red inside P9 is over the top', () => {
    expect(through(330).text).toMatch(/flip/);
    expect(mainFault([through(330)]).fault).toBe('flip');
    expect(mainFault([through(170)]).fault).toBe('over_the_top');
  });
});

describe('both need the clubhead (D16)', () => {
  test('unplaced -> unknown with the tap-to-place reason; hidden -> hidden', () => {
    const checks = run({ leadArm: shaft(5, 320, { head: null, source: 'prior' }), trailArm: shaft(20, 260, { head: null, hidden: true }) });
    expect(one(checks, 'butt_extension')).toMatchObject({ status: 'unknown', reason: 'unplaced', cps: ['leadArm'] });
    expect(one(checks, 'shaft_through_ball')).toMatchObject({ status: 'unknown', reason: 'hidden' });
  });
  test('they live at their positions', () => {
    const checks = run({ leadArm: shaft(5, 320), trailArm: shaft(20, 260) });
    expect(checksAt(checks, 'leadArm').map((c) => c.id)).toContain('butt_extension');
    expect(checksAt(checks, 'trailArm').map((c) => c.id)).toEqual(['shaft_through_ball', 'through_vs_halfway']);
  });
});
