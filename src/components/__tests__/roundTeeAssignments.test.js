import { playerInitials, clampPlayingHandicap, resolvePlayerTee } from '../RoundTeeAssignments';

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

describe('resolvePlayerTee', () => {
  const white = { label: 'White', slope: 113, rating: 70.0 };
  const yellow = { label: 'Yellow', slope: 120, rating: 71.2 };
  const tees = [white, yellow];

  test('keeps an existing tee that still matches a course tee', () => {
    const existing = { label: 'White', slope: 113, rating: 70.0 };
    expect(resolvePlayerTee(existing, null, tees)).toBe(existing);
  });

  test('drops a stale existing tee absent from the course, uses the middle tee', () => {
    const stale = { label: 'Default', slope: 99, rating: 99 };
    expect(resolvePlayerTee(stale, null, tees)).toEqual(
      { label: 'Yellow', slope: 120, rating: 71.2 },
    );
  });

  test('adopts the last-used tee, taking the current course tee data', () => {
    const lastUsed = { label: 'White', slope: 999, rating: 999 };
    expect(resolvePlayerTee(null, lastUsed, tees)).toEqual(
      { label: 'White', slope: 113, rating: 70.0 },
    );
  });

  test('ignores a stale last-used tee absent from the course', () => {
    const lastUsed = { label: 'Default', slope: 99, rating: 99 };
    expect(resolvePlayerTee(null, lastUsed, tees)).toEqual(
      { label: 'Yellow', slope: 120, rating: 71.2 },
    );
  });

  test('matches an unnamed tee to an unnamed course tee', () => {
    const unnamed = { label: '', slope: 125, rating: 70.1 };
    const existing = { label: '', slope: 125, rating: 70.1 };
    expect(resolvePlayerTee(existing, null, [unnamed])).toBe(existing);
  });

  test('returns null when the course has no tees', () => {
    expect(resolvePlayerTee({ label: 'White' }, { label: 'White' }, [])).toBeNull();
  });
});
