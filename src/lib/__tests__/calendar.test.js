import {
  parseIso, todayIso, addDays, nearestSaturday, inBounds, clampIso, addMonths,
  monthGrid, stepTime, formatLabel, monthTitle,
} from '../calendar';

describe('calendar helpers', () => {
  test('parseIso accepts real dates only', () => {
    expect(parseIso('2026-10-10')).toEqual({ y: 2026, m: 10, d: 10 });
    expect(parseIso('2026-02-30')).toBeNull();
    expect(parseIso('tomorrow')).toBeNull();
    expect(parseIso('')).toBeNull();
  });

  test('todayIso uses local fields', () => {
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
    expect(todayIso(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  test('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('nearestSaturday is on or after the date', () => {
    expect(nearestSaturday('2026-10-05')).toBe('2026-10-10'); // Monday
    expect(nearestSaturday('2026-10-10')).toBe('2026-10-10'); // Saturday
    expect(nearestSaturday('2026-10-11')).toBe('2026-10-17'); // Sunday
  });

  test('inBounds and clampIso honour open ends', () => {
    expect(inBounds('2026-10-05', '2026-10-05', null)).toBe(true);
    expect(inBounds('2026-10-04', '2026-10-05', null)).toBe(false);
    expect(inBounds('2026-10-06', null, '2026-10-05')).toBe(false);
    expect(inBounds('nope', null, null)).toBe(false);
    expect(clampIso('2026-09-01', '2026-10-01', '2026-10-31')).toBe('2026-10-01');
    expect(clampIso('2026-11-01', '2026-10-01', '2026-10-31')).toBe('2026-10-31');
    expect(clampIso('2026-10-15', '2026-10-01', '2026-10-31')).toBe('2026-10-15');
  });

  test('addMonths wraps the year', () => {
    expect(addMonths({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
  });

  test('monthGrid is Monday-first with leading blanks', () => {
    const oct = monthGrid({ y: 2026, m: 10 }); // 1 Oct 2026 is a Thursday
    expect(oct.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(oct).toHaveLength(3 + 31);
    expect(monthGrid({ y: 2026, m: 6 })[0]).toBe('2026-06-01'); // a Monday
    expect(monthGrid({ y: 2026, m: 3 }).slice(0, 7))
      .toEqual([null, null, null, null, null, null, '2026-03-01']); // a Sunday
  });

  test('stepTime moves by minutes and wraps', () => {
    expect(stepTime('09:30', 10)).toBe('09:40');
    expect(stepTime('09:30', -10)).toBe('09:20');
    expect(stepTime('23:55', 10)).toBe('00:05');
    expect(stepTime('00:05', -10)).toBe('23:55');
    expect(stepTime('bad', 10)).toBe('00:10');
  });

  test('labels', () => {
    expect(formatLabel('2026-10-10')).toBe('Sat 10 Oct 2026');
    expect(formatLabel('x')).toBe('');
    expect(monthTitle({ y: 2026, m: 10 })).toBe('October 2026');
  });
});
