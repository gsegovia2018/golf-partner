import { classifyHoleResult } from '../constants';

describe('classifyHoleResult', () => {
  test('par 4: strokes map to the expected shape tiers', () => {
    expect(classifyHoleResult(4, 2)).toBe('eagle');  // 2 under → eagle or better
    expect(classifyHoleResult(4, 3)).toBe('birdie'); // 1 under
    expect(classifyHoleResult(4, 4)).toBe('par');    // level
    expect(classifyHoleResult(4, 5)).toBe('bogey');  // 1 over
    expect(classifyHoleResult(4, 6)).toBe('double'); // 2 over → double or worse
  });

  test('eagle-or-better also covers scores 3+ under par', () => {
    expect(classifyHoleResult(5, 2)).toBe('eagle'); // 3 under (albatross) still 'eagle'
    expect(classifyHoleResult(4, 1)).toBe('eagle'); // hole-in-one on a par 4
  });

  test('double-or-worse covers anything 2+ over par', () => {
    expect(classifyHoleResult(3, 5)).toBe('double');
    expect(classifyHoleResult(4, 9)).toBe('double');
  });

  test('par 3 tiers', () => {
    expect(classifyHoleResult(3, 2)).toBe('birdie');
    expect(classifyHoleResult(3, 3)).toBe('par');
    expect(classifyHoleResult(3, 4)).toBe('bogey');
    expect(classifyHoleResult(3, 1)).toBe('eagle'); // hole-in-one on par 3
  });

  test('a 1-stroke score on any par > 1 is eagle-or-better', () => {
    expect(classifyHoleResult(2, 1)).toBe('eagle'); // ace on a par 2
    expect(classifyHoleResult(5, 1)).toBe('eagle');
  });

  test('null when par or strokes are missing / zero / invalid', () => {
    expect(classifyHoleResult(4, 0)).toBeNull();
    expect(classifyHoleResult(0, 4)).toBeNull();
    expect(classifyHoleResult(null, 4)).toBeNull();
    expect(classifyHoleResult(4, null)).toBeNull();
    expect(classifyHoleResult(undefined, undefined)).toBeNull();
    expect(classifyHoleResult(4, -1)).toBeNull();
  });
});
