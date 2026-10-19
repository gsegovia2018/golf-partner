// Reference swings through the whole analysis (pass 1 + pass 2), so a change to a limit or a
// measure is judged against real swings: tour players should read mostly green, and the owner's
// calibrated swings keep the early extension he confirmed (#238).
import { REFERENCE, TOUR, OWNER, analyzeReference } from './referenceSwings';

const decided = (a) => a.counts.green + a.counts.yellow + a.counts.red;

describe('reference swings', () => {
  test.each(TOUR.map((f) => [f.name, f]))('%s analyses', (_n, fx) => {
    expect(analyzeReference(fx).error).toBeUndefined();
  });

  // A floor at today's readings: a change may make these swings greener, never redder.
  const FLOOR = {
    'tour-oosthuizen-driver': { green: 14, red: 3 },
    'tour-els-hybrid': { green: 10, red: 1 },
    'tour-mcilroy-iron': { green: 11, red: 1 },
    'tour-mcilroy-driver': { green: 14, red: 1 },
  };
  test.each(TOUR.map((f) => [f.name, f]))('%s is no redder than today', (name, fx) => {
    const a = analyzeReference(fx);
    expect(a.counts.green).toBeGreaterThanOrEqual(FLOOR[name].green);
    expect(a.counts.red).toBeLessThanOrEqual(FLOOR[name].red);
    expect(decided(a)).toBeGreaterThan(0);
  });

  test.each(OWNER.map((f) => [f.name, f]))('%s keeps its early extension flagged', (_n, fx) => {
    const hip = analyzeReference(fx).checks.find((c) => c.id === 'hip_drift');
    expect(hip.status).not.toBe('green');
  });
});

describe('view (face-on flag)', () => {
  test.each(REFERENCE.map((f) => [f.name, f]))('%s', (name, fx) => {
    expect(analyzeReference(fx).view).toBe(name.startsWith('faceon-') ? 'faceOn' : 'dtl');
  });
});
