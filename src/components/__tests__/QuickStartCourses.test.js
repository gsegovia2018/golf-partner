import {
  coursePar,
  courseTeeCount,
  quickStartCourseMeta,
  initialQuickStartPlayerIds,
} from '../QuickStartCourses';

describe('QuickStartCourses helpers', () => {
  test('coursePar sums hole pars when available', () => {
    expect(coursePar({
      holes: [{ par: 4 }, { par: 5 }, { par: 3 }],
    })).toBe(12);
    expect(coursePar({ holes: [] })).toBeNull();
  });

  test('courseTeeCount counts only named tees', () => {
    expect(courseTeeCount({
      tees: [{ label: 'White' }, { label: '' }, { label: 'Yellow' }],
    })).toBe(2);
  });

  test('quickStartCourseMeta combines par and tee count', () => {
    expect(quickStartCourseMeta({
      holes: [{ par: 4 }, { par: 5 }],
      tees: [{ label: 'White' }, { label: 'Yellow' }],
    })).toBe('Par 9 · 2 tees');
    expect(quickStartCourseMeta({ holes: [], tees: [] })).toBe('');
  });

  test('initialQuickStartPlayerIds preselects the signed-in user player', () => {
    const players = [
      { id: 'p1', name: 'Guest', user_id: null },
      { id: 'p2', name: 'Me', user_id: 'u-me' },
    ];
    expect(initialQuickStartPlayerIds(players, 'u-me')).toEqual(['p2']);
  });

  test('initialQuickStartPlayerIds returns empty when no signed-in user player exists', () => {
    expect(initialQuickStartPlayerIds([{ id: 'p1', user_id: null }], 'u-me')).toEqual([]);
  });
});
