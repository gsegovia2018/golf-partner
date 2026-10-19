import { guessClub, playConditionsFor, shotBearing } from '../clubGuess';
import { setCourseGeometry } from '../../lib/geo';

let mockWeather = null;
jest.mock('../weatherStore', () => ({ weatherAt: () => mockWeather }));
jest.mock('../shotStore', () => ({ getShots: () => [] }));

const BAG = ['driver', '3w', '5i', '6i', '7i'];
const DIST = { driver: 230, '3w': 210, '5i': 160, '6i': 150, '7i': 140 };
const base = (over = {}) => ({ conditionsEnabled: true, bag: BAG, clubDistances: DIST, courseAltitudes: {}, ...over });
// 20 °C at sea level: the air is neutral, so only the wind moves plays-like.
const calmAir = (windKmh, windFromDeg) => ({ tempC: 20, windKmh, windFromDeg, elevationM: 0, fetchedAt: 0, fresh: true });

afterEach(() => { mockWeather = null; setCourseGeometry([]); });

describe('guessClub', () => {
  it('clubs to the plays-like distance when conditions are on (137 m into 10 mph plays 151 -> 6 iron)', () => {
    mockWeather = calmAir(16.09344, 0);
    expect(guessClub({ meters: 137, bearing: 0, courseName: 'X', settings: base() }).club).toBe('6i');
  });

  it('uses the real distance when conditions are off', () => {
    mockWeather = calmAir(16.09344, 0);
    expect(guessClub({ meters: 137, bearing: 0, courseName: 'X', settings: base({ conditionsEnabled: false }) }).club).toBe('7i');
  });

  it('the driver is a candidate only from the tee', () => {
    expect(guessClub({ meters: 228, settings: base({ conditionsEnabled: false }), fromTee: true }).club).toBe('driver');
    expect(guessClub({ meters: 228, settings: base({ conditionsEnabled: false }) }).club).toBe('3w');
  });

  it('agrees with playConditionsFor for the same shot', () => {
    mockWeather = calmAir(20, 30);
    const settings = base();
    const cond = playConditionsFor({ courseName: 'X', bearing: 10.4, settings });
    const g = guessClub({ meters: 150, bearing: 10.4, courseName: 'X', settings });
    expect(g.delta).toBeCloseTo(cond.plays(150) - g.distance, 6);
  });
});

describe('shotBearing', () => {
  it('points from the tee (or a given spot) to the green centre', () => {
    setCourseGeometry([{
      key: 'tc', name: 'Test Course', matchTokens: [['test', 'course']], mode: 'holes',
      holes: [{ number: 1, start: [40, -3], greenCenter: [40.002, -3] }],
    }]);
    expect(shotBearing('Test Course', 1)).toBeCloseTo(0, 3);
    expect(shotBearing('Test Course', 1, [40.001, -2.999])).toBeGreaterThan(270);
    expect(shotBearing('Test Course', 2)).toBeNull();
  });
});
