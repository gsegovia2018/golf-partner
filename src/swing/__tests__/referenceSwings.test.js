// Reference swings through the whole analysis (pass 1 + pass 2), so a change to a limit or a
// measure is judged against real swings: tour players should read mostly green, and the owner's
// calibrated swings keep the early extension he confirmed (#238).
import { REFERENCE, TOUR, OWNER, analyzeReference, byName } from './referenceSwings';

const decided = (a) => a.counts.green + a.counts.yellow + a.counts.red;

describe('reference swings', () => {
  test.each(TOUR.map((f) => [f.name, f]))('%s analyses', (_n, fx) => {
    expect(analyzeReference(fx).error).toBeUndefined();
  });

  // Tour swings read mostly green, not all green: no swing with more than one red, green the
  // largest group on each, and seven in ten decided rows green over the set.
  test.each(TOUR.map((f) => [f.name, f]))('%s reads mostly green', (_n, fx) => {
    const { counts } = analyzeReference(fx);
    expect(counts.red).toBeLessThanOrEqual(1);
    expect(counts.green).toBeGreaterThan(counts.yellow + counts.red);
  });
  test('seven in ten decided rows are green over the tour swings', () => {
    const all = TOUR.map(analyzeReference);
    const green = all.reduce((n, a) => n + a.counts.green, 0);
    expect(green / all.reduce((n, a) => n + decided(a), 0)).toBeGreaterThanOrEqual(0.7);
  });

  test('a clubhead proposal on the chest is no reading: Rose\'s impact shaft angle asks to place it', () => {
    const row = analyzeReference(byName('tour-rose-iron')).checks.find((c) => c.id === 'shaft_angle_impact');
    expect(row).toMatchObject({ status: 'unknown', reason: 'unplaced' });
  });

  test.each(OWNER.map((f) => [f.name, f]))('%s keeps its early extension flagged', (_n, fx) => {
    const hip = analyzeReference(fx).checks.find((c) => c.id === 'hip_drift');
    expect(hip.status).not.toBe('green');
  });
  test('early extension stays the main fault on four of the owner\'s five swings', () => {
    expect(OWNER.filter((fx) => analyzeReference(fx).main?.fault === 'early_extension')).toHaveLength(4);
  });

  // The coach-series rows take their limits from the tour swings (plan 2026-10-30): none of them may
  // read anything but green, or unknown where a swing has no ball for the symmetry line.
  test.each(REFERENCE.filter((f) => f.name.startsWith('tour-')).map((f) => [f.name, f]))('%s is green on the coach rows', (_n, fx) => {
    const rows = analyzeReference(fx).checks.filter((c) => ['hands_bicep', 'swing_symmetry', 'finish_trail_foot'].includes(c.id));
    expect(rows).toHaveLength(3);
    rows.forEach((c) => expect([c.id, c.status]).toEqual([c.id, c.id === 'swing_symmetry' && !fx.ball ? 'unknown' : 'green']));
  });
});

describe('view (face-on flag)', () => {
  test.each(REFERENCE.map((f) => [f.name, f]))('%s', (name, fx) => {
    expect(analyzeReference(fx).view).toBe(name.startsWith('faceon-') ? 'faceOn' : 'dtl');
  });
});
