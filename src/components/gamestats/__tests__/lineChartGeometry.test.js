import { yAxis, nudgeLabels, linePath, lastIndex } from '../lineChartGeometry';

describe('yAxis', () => {
  test('rounds up to a nice max with about three steps', () => {
    expect(yAxis(68)).toEqual({ max: 75, ticks: [0, 25, 50, 75] });
    expect(yAxis(24)).toEqual({ max: 30, ticks: [0, 10, 20, 30] });
  });

  test('never collapses to a zero range', () => {
    expect(yAxis(0).max).toBeGreaterThan(0);
  });
});

describe('nudgeLabels', () => {
  test('spreads close labels apart, keeping their order', () => {
    expect(nudgeLabels([50, 52, 100], 12, 0, 200)).toEqual([50, 62, 100]);
  });

  test('pushes back up when the bottom would overflow', () => {
    expect(nudgeLabels([190, 195], 12, 0, 196)).toEqual([184, 196]);
  });

  test('returns placements in the input order', () => {
    expect(nudgeLabels([100, 10], 12, 0, 200)).toEqual([100, 10]);
  });
});

describe('linePath / lastIndex', () => {
  test('a null value lifts the pen and the line ends at the last value', () => {
    const d = linePath([0, 1, null, 3], (i) => i * 10, (v) => v);
    expect(d).toBe('M0.0 0.0 L10.0 1.0 M30.0 3.0');
    expect(lastIndex([1, 2, null, null])).toBe(1);
    expect(lastIndex([null])).toBe(-1);
  });
});
