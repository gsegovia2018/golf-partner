import { watchInputsOf } from '../useWatchBridge';
import { watchStateOf } from '../../store/watchProtocol';

const mockFeatures = {
  1: {
    greenCenter: [43.0, -2.0], greenFront: [43.0, -2.001], greenBack: [43.0, -1.999], start: [43.01, -2.0],
  },
  2: { greenCenter: [43.1, -2.1], greenFront: null, greenBack: null, start: null },
};
jest.mock('../../lib/geo', () => ({
  holeFeatures: (_c, n) => mockFeatures[n] ?? null,
}));

const round = {
  id: 'r1',
  courseName: 'Test',
  holes: [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 3, strokeIndex: 2 },
    { number: 3, par: 5, strokeIndex: 3 },
  ],
  playerHandicaps: { p1: 18 },
};
const base = {
  round,
  players: [{ id: 'p1', name: 'Marcos' }],
  meId: 'p1',
  scores: { p1: { 1: 5, 3: 6 } },
  shotDetails: { p1: { 1: { putts: 2, drive: 'left', teeClub: 'iron', approachBunker: true, approachLie: 'rough' } } },
  currentHole: 1,
  courseName: 'Test',
  distances: null,
  units: 'meters',
  statGroups: { putting: true, teeShot: true, approach: false, shortGame: true, penalties: true },
  blocked: null,
};

describe('watchInputsOf: whole-course state', () => {
  const s = watchStateOf({ rev: 1, ...watchInputsOf(base) });

  test('course lists every hole with green, tee and extra shots', () => {
    expect(s.course.holes.map((h) => h.number)).toEqual([1, 2, 3]);
    expect(s.course.holes[0]).toEqual({
      number: 1, par: 4, si: 1, extraShots: 1,
      green: { front: [43.0, -2.001], center: [43.0, -2.0], back: [43.0, -1.999] },
      tee: [43.01, -2.0],
    });
    expect(s.course.holes[1]).toMatchObject({ green: { front: null, center: [43.1, -2.1], back: null }, tee: null });
    expect(s.course.holes[2]).toMatchObject({ green: null, tee: null });
    // the current hole's own green is unchanged
    expect(s.hole.green.center).toEqual([43.0, -2.0]);
  });

  test('a green with no front/back points carries its traced outline', () => {
    const outline = [[43.2, -2.2], [43.2, -2.199], [43.201, -2.2]];
    mockFeatures[3] = { greenCenter: [43.2005, -2.1995], greenFront: null, greenBack: null, green: outline, start: null };
    try {
      const holes = watchStateOf({ rev: 1, ...watchInputsOf(base) }).course.holes;
      expect(holes[2].green).toEqual({ front: null, center: [43.2005, -2.1995], back: null, outline });
      expect(holes[0].green).not.toHaveProperty('outline'); // admin points win, as on the phone
    } finally {
      delete mockFeatures[3];
    }
  });

  test('mine has every hole: strokes, points and the watch-visible shot subset', () => {
    expect(Object.keys(s.mine)).toEqual(['1', '2', '3']);
    expect(s.mine[1].strokes).toBe(5);
    expect(s.mine[1].points).toBe(s.me.points); // hole 1 is the current hole
    expect(s.mine[1].shot).toEqual({
      putts: 2, drive: 'left', teeClub: 'iron', driveDistBucket: null, teePenalties: 0, otherPenalties: 0,
      sandShots: 0, recoveryOutcome: null, firstPuttBucket: null, approachBucket: null,
      approachResult: null, approachMiss: null, approachBunker: true,
    });
    expect(s.mine[1].shot).not.toHaveProperty('approachLie');
    expect(s.mine[2]).toEqual({ strokes: null, points: null, shot: null });
    expect(s.mine[3]).toMatchObject({ strokes: 6, shot: null });
  });

  test('track carries approach', () => {
    expect(s.track).toEqual({
      putting: true, teeShot: true, approach: false, shortGame: true, penalties: true,
    });
  });

  test('a supplied course is used as is (the hook memoizes it)', () => {
    const course = { holes: [] };
    expect(watchInputsOf({ ...base, course }).course).toBe(course);
  });
});
