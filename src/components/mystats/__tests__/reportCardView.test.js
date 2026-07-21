import { fmtDelta, buildChapterVM, calloutSub } from '../reportCardView';

const pph = (label, value, deltaVsAvg, deltaVs2 = null, polarity = 'higher') => ({
  label, group: 'course', value, baseline: null, deltaVsAvg, deltaVs2, holes: 4, polarity,
});

describe('fmtDelta', () => {
  test('formats sign and null', () => {
    expect(fmtDelta(1.2)).toBe('+1.2');
    expect(fmtDelta(-0.4)).toBe('-0.4');
    expect(fmtDelta(0)).toBe('0');
    expect(fmtDelta(null)).toBe('—');
  });
});

describe('buildChapterVM', () => {
  test('normalizes bar ratios to the biggest swing in the chapter', () => {
    const vm = buildChapterVM({
      key: 'course', label: 'Where on the course',
      cells: [pph('Par 3s', 1.25, -0.7), pph('Par 5s', 2.8, 0.9), pph('Par 4s', 2.2, 0.3)],
    }, { hasHistory: true });
    const byLabel = Object.fromEntries(vm.rows.map((r) => [r.label, r]));
    expect(byLabel['Par 5s'].ratio).toBe(1);
    expect(byLabel['Par 3s'].ratio).toBeCloseTo(0.7 / 0.9);
    expect(byLabel['Par 5s'].good).toBeCloseTo(0.9);
    expect(byLabel['Par 3s'].good).toBeCloseTo(-0.7);
    expect(vm.hasDeltas).toBe(true);
  });

  test('applies lower-is-better polarity so beating average reads as good', () => {
    const vm = buildChapterVM({
      key: 'shots', label: 'Shot stats',
      cells: [{ label: 'Putts', group: 'shots', value: 31, baseline: 32.5, deltaVsAvg: -1.5, deltaVs2: null, holes: null, polarity: 'lower' }],
    }, { hasHistory: true });
    expect(vm.rows[0].good).toBeCloseTo(1.5);
    expect(vm.rows[0].delta).toBeCloseTo(-1.5);
    expect(vm.rows[0].sub).toBe('31 this round');
  });

  test('strips % from labels and formats percentage values', () => {
    const vm = buildChapterVM({
      key: 'shots', label: 'Shot stats',
      cells: [{ label: 'Fairways hit %', group: 'shots', value: 57, baseline: 49, deltaVsAvg: 8, deltaVs2: null, holes: null, polarity: 'higher' }],
    }, { hasHistory: true });
    expect(vm.rows[0].label).toBe('Fairways hit');
    expect(vm.rows[0].valueText).toBe('57%');
  });

  test('falls back to deltaVs2 when no career baseline exists', () => {
    const vm = buildChapterVM({
      key: 'course', label: 'Where on the course',
      cells: [pph('Par 3s', 1.25, null, -0.75)],
    }, { hasHistory: false });
    expect(vm.rows[0].delta).toBeCloseTo(-0.75);
    expect(vm.rows[0].good).toBeCloseTo(-0.75);
  });

  test('rows with no delta at all get null good and zero ratio', () => {
    const vm = buildChapterVM({
      key: 'distribution', label: 'Scoring',
      cells: [{ label: 'Pars', group: 'distribution', value: 8, baseline: null, deltaVsAvg: null, deltaVs2: null, holes: null, polarity: 'higher' }],
    }, { hasHistory: false });
    expect(vm.rows[0].good).toBeNull();
    expect(vm.rows[0].ratio).toBe(0);
    expect(vm.hasDeltas).toBe(false);
    expect(vm.preview).toBe('8 pars');
  });

  test('preview names best and worst rows when deltas exist', () => {
    const vm = buildChapterVM({
      key: 'course', label: 'Where on the course',
      cells: [pph('Par 3s', 1.25, -0.7), pph('Par 5s', 2.8, 0.9)],
    }, { hasHistory: true });
    expect(vm.preview).toBe('Best: Par 5s +0.9 · Worst: Par 3s -0.7');
  });

  test('pph rows get a per-hole sub line', () => {
    const vm = buildChapterVM({
      key: 'timing', label: 'When in the round',
      cells: [{ ...pph('Opening 3', 1.33, -0.6), group: 'timing' }],
    }, { hasHistory: true });
    expect(vm.rows[0].sub).toBe('1.33 / hole');
  });
});

describe('calloutSub', () => {
  test('reads vs your avg when a baseline exists', () => {
    expect(calloutSub(pph('Par 5s', 2.8, 0.9))).toBe('2.8 / hole · +0.9 vs your avg');
  });
  test('reads vs the 2.0 mark without a baseline', () => {
    expect(calloutSub(pph('Par 3s', 1.25, null, -0.75))).toBe('1.25 / hole · -0.75 vs the 2.0 mark');
  });
});
