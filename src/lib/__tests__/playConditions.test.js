import {
  estimateTempC, tempFactor, altitudeFactor, conditionFactor, playsLike, describeConditions,
  windComponents, windFactor, windText, compassPoint,
} from '../playConditions';
import { setLanguagePref } from '../../i18n';

describe('estimateTempC', () => {
  it('reads the monthly curve at sea level', () => {
    expect(estimateTempC(6, 0)).toBe(26); // July
  });
  it('cools with elevation via the lapse rate (6.5C/1000m)', () => {
    expect(estimateTempC(6, 1000)).toBeCloseTo(26 - 6.5, 1);
  });
  it('wraps month index', () => {
    expect(estimateTempC(12, 0)).toBe(estimateTempC(0, 0));
  });
});

describe('tempFactor', () => {
  it('is 1 at the 20C baseline', () => {
    expect(tempFactor(20)).toBeCloseTo(1, 5);
  });
  it('warmer air carries farther, colder shorter', () => {
    expect(tempFactor(30)).toBeGreaterThan(1);
    expect(tempFactor(5)).toBeLessThan(1);
  });
});

describe('altitudeFactor', () => {
  it('is 1 at sea level and grows ~2% per 1000ft', () => {
    expect(altitudeFactor(0)).toBe(1);
    expect(altitudeFactor(304.8)).toBeCloseTo(1.02, 3);
  });
  it('never dips below 1 for negative input', () => {
    expect(altitudeFactor(-500)).toBe(1);
  });
});

describe('conditionFactor + playsLike', () => {
  it('a warm high course makes a hole play shorter than measured', () => {
    const f = conditionFactor({ month: 6, altitudeM: 620 }); // July, 620m
    expect(f).toBeGreaterThan(1);
    expect(playsLike(150, f)).toBeLessThan(150);
  });
  it('a cold sea-level day plays longer', () => {
    const f = conditionFactor({ month: 0, altitudeM: 0 }); // January
    expect(f).toBeLessThan(1);
    expect(playsLike(150, f)).toBeGreaterThan(150);
  });
  it('playsLike is a no-op for a non-positive factor', () => {
    expect(playsLike(150, 0)).toBe(150);
  });
});

describe('describeConditions', () => {
  it('summarises direction and percent', () => {
    const d = describeConditions({ month: 6, altitudeM: 620 });
    expect(d.pct).toBeGreaterThan(0);
    expect(d.text).toMatch(/shorter/);
  });
});

describe('describeConditions in Spanish', () => {
  beforeEach(async () => { await setLanguagePref('es'); });
  afterEach(async () => { await setLanguagePref('en'); });

  it('describes a warm, high course in Spanish', () => {
    const d = describeConditions({ month: 6, altitudeM: 620 });
    expect(d.text).toBe(`los hoyos se juegan ~${d.pct} % más cortos`);
  });
  it('describes a cold sea-level day as longer, and neutral as marked', () => {
    const cold = describeConditions({ month: 0, altitudeM: 0 });
    expect(cold.text).toMatch(/más largos$/);
    expect(describeConditions({ month: 4, altitudeM: 0, }).text).toBeTruthy();
  });
});

describe('describeConditions text keys', () => {
  it('resolves in English', () => {
    expect(describeConditions({ month: 6, altitudeM: 620 }).text).toMatch(/^holes play ~\d+% shorter$/);
  });
});

describe('real temperature', () => {
  it('a reading replaces the month estimate', () => {
    expect(conditionFactor({ month: 6, altitudeM: 0, tempC: 20 })).toBeCloseTo(1, 5);
    expect(describeConditions({ month: 6, altitudeM: 0, tempC: 11 }).tempC).toBe(11);
  });
});

describe('windComponents', () => {
  it('wind from where the shot points is all head wind', () => {
    const w = windComponents(20, 0, 0);
    expect(w.headKmh).toBeCloseTo(20, 5);
    expect(w.kind).toBe('into');
    expect(w.side).toBeNull();
    expect(w.arrowDeg).toBe(180); // blows back at the player
  });
  it('wind from behind helps', () => {
    expect(windComponents(20, 180, 0)).toMatchObject({ kind: 'helping' });
    expect(windComponents(20, 180, 0).headKmh).toBeCloseTo(-20, 5);
  });
  it('front-left wind: into, from the left, arrow down-right', () => {
    const w = windComponents(18, 280, 315); // from W, shot NW: 35° off the nose
    expect(w.kind).toBe('into');
    expect(w.side).toBe('left');
    expect(w.headKmh).toBeCloseTo(18 * Math.cos((35 * Math.PI) / 180), 5);
    expect(w.arrowDeg).toBeCloseTo(145, 5);
  });
  it('mostly sideways is across; light wind is calm', () => {
    expect(windComponents(20, 90, 0)).toMatchObject({ kind: 'across', side: 'right' });
    expect(windComponents(3, 0, 0).kind).toBe('calm');
  });
  it('null without a bearing', () => {
    expect(windComponents(10, 0, null)).toBeNull();
  });
});

describe('windFactor', () => {
  it('head wind ~1%/mph longer, tail ~0.5%/mph shorter, none 1', () => {
    expect(windFactor(16.09344)).toBeCloseTo(1.1, 5); // 10 mph into
    expect(windFactor(-16.09344)).toBeCloseTo(0.95, 5); // 10 mph helping
    expect(windFactor(0)).toBe(1);
    expect(windFactor(NaN)).toBe(1);
  });
});

describe('windText / compassPoint', () => {
  it('describes the wind along the shot', () => {
    expect(windText(windComponents(18, 280, 315))).toBe('18 km/h · into, from the left');
    expect(windText(windComponents(18, 0, 0))).toBe('18 km/h · into');
    expect(windText(windComponents(18, 0, 0), { row: true })).toBe('Wind 18 km/h, into');
    expect(windText(windComponents(2, 0, 0))).toBe('calm');
    expect(windText(null)).toBeNull();
  });
  it('names eight compass points', () => {
    expect(compassPoint(280)).toBe('W');
    expect(compassPoint(350)).toBe('N');
    expect(compassPoint(135)).toBe('SE');
  });
});
