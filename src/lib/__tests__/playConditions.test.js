import {
  estimateTempC, tempFactor, altitudeFactor, conditionFactor, playsLike, describeConditions,
} from '../playConditions';

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
