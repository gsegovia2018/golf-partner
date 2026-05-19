import { playerInitials, clampPlayingHandicap } from '../RoundTeeAssignments';

describe('playerInitials', () => {
  test('two-word name uses first and last initials', () => {
    expect(playerInitials('Marco Specker')).toBe('MS');
  });
  test('three-word name uses first and last initials', () => {
    expect(playerInitials('Mary Anne Jones')).toBe('MJ');
  });
  test('single name uses its first two letters', () => {
    expect(playerInitials('Marco')).toBe('MA');
  });
  test('collapses extra whitespace', () => {
    expect(playerInitials('  Marco   Specker  ')).toBe('MS');
  });
  test('empty or missing name falls back to a placeholder', () => {
    expect(playerInitials('')).toBe('?');
    expect(playerInitials(undefined)).toBe('?');
  });
});

describe('clampPlayingHandicap', () => {
  test('keeps a value already in range', () => {
    expect(clampPlayingHandicap(18)).toBe(18);
  });
  test('clamps below the floor to -9', () => {
    expect(clampPlayingHandicap(-20)).toBe(-9);
  });
  test('clamps above the ceiling to 54', () => {
    expect(clampPlayingHandicap(99)).toBe(54);
  });
  test('rounds a non-integer input', () => {
    expect(clampPlayingHandicap(12.6)).toBe(13);
  });
  test('non-numeric input falls back to 0', () => {
    expect(clampPlayingHandicap('abc')).toBe(0);
  });
});
