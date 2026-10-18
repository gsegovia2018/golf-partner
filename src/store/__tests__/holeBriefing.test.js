import { expectedApproachBucket, holeLengthM, holeBriefing } from '../holeBriefing';

describe('expectedApproachBucket', () => {
  it('par 3: the bucket of the hole length', () => {
    expect(expectedApproachBucket({ par: 3, holeLength: 165 })).toBe('150-200');
    expect(expectedApproachBucket({ par: 3, holeLength: 49 })).toBe('0-50');
    expect(expectedApproachBucket({ par: 3, holeLength: 200 })).toBe('200+');
  });
  it('par 4/5: hole length minus the average drive', () => {
    expect(expectedApproachBucket({ par: 4, holeLength: 380, avgDrive: 240 })).toBe('100-150');
    expect(expectedApproachBucket({ par: 5, holeLength: 500, avgDrive: 220 })).toBe('200+');
  });
  it('clamps at zero', () => {
    expect(expectedApproachBucket({ par: 4, holeLength: 200, avgDrive: 240 })).toBe('0-50');
  });
  it('is null when the length (or the drive on a par 4/5) is missing', () => {
    expect(expectedApproachBucket({ par: 4, holeLength: 380 })).toBeNull();
    expect(expectedApproachBucket({ par: 4, avgDrive: 220 })).toBeNull();
    expect(expectedApproachBucket({ par: 3 })).toBeNull();
  });
});

const rate = (known, dir) => ({
  directionKnown: known,
  leftRate: Math.round(((dir.left ?? 0) / known) * 100),
  rightRate: Math.round(((dir.right ?? 0) / known) * 100),
  shortRate: 0,
  longRate: 0,
});
const rightApproach = { '100-150': rate(10, { right: 8, left: 2 }) };
const statsWith = ({ approach = true, tee = true, drive = 260 } = {}) => ({
  approachMissByDistance: { buckets: approach ? rightApproach : {} },
  approachTendency: { directionKnown: 0, byDirection: {} },
  driveImpact: { buckets: tee ? { left: { holes: 2 }, right: { holes: 12 } } : { left: { holes: 0 }, right: { holes: 0 } } },
  driveDistance: { drives: 20, avgDistance: drive },
});
// A hole 400 m long running north, with a bunker 17 m east of the green.
const geometry = {
  start: [40, -3],
  greenCenter: [40.0036, -3],
  hazards: [{ kind: 'bunker', poly: [[40.0035, -2.9998], [40.0036, -2.9998], [40.0036, -2.9997]] }],
};

describe('holeLengthM', () => {
  it('is the tee to green-centre line', () => {
    expect(Math.round(holeLengthM(geometry))).toBeGreaterThan(395);
    expect(Math.round(holeLengthM(geometry))).toBeLessThan(405);
  });
  it('is null without a tee or green', () => {
    expect(holeLengthM(null)).toBeNull();
    expect(holeLengthM({ greenCenter: [1, 1] })).toBeNull();
  });
});

describe('holeBriefing', () => {
  it('gives both lines with the expected approach distance', () => {
    const b = holeBriefing({ par: 4, stats: statsWith(), geometry });
    expect(b.tee).toMatchObject({ shot: 'tee', aim: expect.stringMatching(/edge|middle/) });
    expect(b.approach).toMatchObject({ shot: 'approach', miss: 'right' });
    expect(b.approach.detail.params.bucket).toBe('100-150');
    expect(b.approachMeters).toBe(140);
  });
  it('names the green bunker on the miss side on the approach line', () => {
    const b = holeBriefing({ par: 4, stats: statsWith(), geometry });
    expect(b.approach.hazard).toEqual({ kind: 'bunker', side: 'right' });
  });
  it('gives only the approach line on a par 3', () => {
    const g = { ...geometry, greenCenter: [40.0015, -3] }; // ~167 m
    const stats = statsWith();
    stats.approachMissByDistance.buckets = { '150-200': rate(10, { right: 8, left: 2 }) };
    const b = holeBriefing({ par: 3, stats, geometry: g });
    expect(b.tee).toBeNull();
    expect(b.approach.detail.params.bucket).toBe('150-200');
    expect(b.approachMeters).toBe(170);
  });
  it('gives only the tee line when the approach pattern is too thin', () => {
    const b = holeBriefing({ par: 4, stats: statsWith({ approach: false }), geometry });
    expect(b.tee).not.toBeNull();
    expect(b.approach).toBeNull();
  });
  it('gives no lines without a pattern', () => {
    const b = holeBriefing({ par: 4, stats: statsWith({ approach: false, tee: false }), geometry });
    expect(b).toEqual({ tee: null, approach: null, approachMeters: null });
  });
  it('pools the approach when there is no geometry or no drive average', () => {
    const stats = statsWith();
    stats.approachTendency = { directionKnown: 12, byDirection: { left: 2, right: 10 } };
    const noMap = holeBriefing({ par: 4, stats, geometry: null });
    expect(noMap.approach.evidence.scope).toBe('all');
    expect(noMap.approachMeters).toBeNull();
    const noDrive = holeBriefing({ par: 4, stats: { ...stats, driveDistance: null }, geometry });
    expect(noDrive.approach.evidence.scope).toBe('all');
    expect(noDrive.approachMeters).toBeNull();
  });
  it('is empty without stats', () => {
    expect(holeBriefing({ par: 4, stats: null, geometry })).toEqual({ tee: null, approach: null, approachMeters: null });
  });
});
