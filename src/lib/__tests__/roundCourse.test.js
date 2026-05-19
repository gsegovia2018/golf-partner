import { applyCoursePick, applyLayoutChoice } from '../roundCourse';

const course = (over = {}) => ({
  id: 'c1', name: 'Pine Valley', slope: 132, rating: 71.8,
  holes: [{ number: 1, par: 4, strokeIndex: 1 }],
  tees: [{ label: 'White', slope: 132 }],
  ...over,
});

describe('applyCoursePick', () => {
  test('course pick resolves the round and clears club fields', () => {
    const next = applyCoursePick({ id: 'r1', club: { id: 'x' } },
      { kind: 'course', course: course() });
    expect(next.courseId).toBe('c1');
    expect(next.courseName).toBe('Pine Valley');
    expect(next.holes).toHaveLength(1);
    expect(next.tees).toHaveLength(1);
    expect(next.slope).toBe(132);
    expect(next.courseRating).toBe(71.8);
    expect(next.club).toBeNull();
    expect(next.clubLayouts).toBeNull();
    expect(next.layoutId).toBeNull();
  });

  test('course pick deep-copies holes (no shared reference)', () => {
    const c = course();
    const next = applyCoursePick({ id: 'r1' }, { kind: 'course', course: c });
    expect(next.holes).not.toBe(c.holes);
    expect(next.holes[0]).not.toBe(c.holes[0]);
  });

  test('club pick leaves the round unresolved with layouts attached', () => {
    const layouts = [course({ id: 'l1' }), course({ id: 'l2' })];
    const next = applyCoursePick({ id: 'r1' },
      { kind: 'club', club: { id: 'k1', name: 'La Moraleja' }, layouts });
    expect(next.club).toEqual({ id: 'k1', name: 'La Moraleja' });
    expect(next.clubLayouts).toBe(layouts);
    expect(next.layoutId).toBeNull();
    expect(next.courseName).toBe('');
    expect(next.courseId).toBeNull();
    expect(next.holes).toEqual([]);
  });
});

describe('applyLayoutChoice', () => {
  test('resolves the round from the layout, keeping club/clubLayouts', () => {
    const layouts = [course({ id: 'l1', name: 'Campo 1' })];
    const round = { id: 'r1', club: { id: 'k1', name: 'La Moraleja' }, clubLayouts: layouts };
    const next = applyLayoutChoice(round, layouts[0]);
    expect(next.courseId).toBe('l1');
    expect(next.courseName).toBe('Campo 1');
    expect(next.layoutId).toBe('l1');
    expect(next.club).toEqual({ id: 'k1', name: 'La Moraleja' });
    expect(next.clubLayouts).toBe(layouts);
  });
});
