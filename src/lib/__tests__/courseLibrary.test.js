import {
  normalizeText, buildCourseLibraryItems, filterCourseLibraryItems,
} from '../courseLibrary';

const course = (id, name, extra = {}) => ({
  id, name, slope: null, holes: [], city: null, province: null,
  clubId: null, layoutName: null, ...extra,
});

describe('normalizeText', () => {
  test('lowercases and strips diacritics', () => {
    expect(normalizeText('Herrería')).toBe('herreria');
  });
  test('nullish → empty string', () => {
    expect(normalizeText(null)).toBe('');
  });
});

describe('buildCourseLibraryItems', () => {
  test('standalone course → course item', () => {
    const items = buildCourseLibraryItems([course('c1', 'Pine Valley')], []);
    expect(items).toEqual([{ kind: 'course', course: expect.objectContaining({ id: 'c1' }) }]);
  });

  test('club with 2+ layouts → club item; single-layout club → course item', () => {
    const courses = [
      course('a', 'Moraleja — Campo 1', { clubId: 'm', layoutName: 'Campo 1' }),
      course('b', 'Moraleja — Campo 2', { clubId: 'm', layoutName: 'Campo 2' }),
      course('c', 'Herreria', { clubId: 'h', layoutName: 'Herreria' }),
    ];
    const clubs = [
      { id: 'm', name: 'La Moraleja' },
      { id: 'h', name: 'La Herreria' },
    ];
    const items = buildCourseLibraryItems(courses, clubs);
    const club = items.find((i) => i.kind === 'club');
    const single = items.find((i) => i.kind === 'course');
    expect(club.club.id).toBe('m');
    expect(club.layouts.map((l) => l.id)).toEqual(['a', 'b']);
    expect(single.course.id).toBe('c');
  });

  test('course whose clubId has no matching club falls back to a course item', () => {
    const items = buildCourseLibraryItems(
      [course('x', 'Orphan', { clubId: 'gone' })], []);
    expect(items).toEqual([{ kind: 'course', course: expect.objectContaining({ id: 'x' }) }]);
  });

  test('favorited standalone courses sort before others', () => {
    const items = buildCourseLibraryItems(
      [course('z', 'Zeta'), course('a', 'Alpha')], [], new Set(['z']));
    expect(items.map((i) => i.course.id)).toEqual(['z', 'a']);
  });
});

describe('filterCourseLibraryItems', () => {
  const items = [
    { kind: 'course', course: course('c1', 'Pine Valley', { city: 'Madrid' }) },
    {
      kind: 'club',
      club: { id: 'm', name: 'La Moraleja', city: null, province: null },
      layouts: [
        course('a', 'Moraleja — Campo 1', { clubId: 'm', layoutName: 'Campo 1' }),
        course('b', 'Moraleja — Campo 2', { clubId: 'm', layoutName: 'Campo 2' }),
      ],
    },
  ];

  test('empty query → unchanged', () => {
    expect(filterCourseLibraryItems(items, '')).toBe(items);
  });

  test('club-name match keeps the club with all layouts', () => {
    const out = filterCourseLibraryItems(items, 'moraleja');
    expect(out).toHaveLength(1);
    expect(out[0].layouts).toHaveLength(2);
  });

  test('layout-name match keeps only matching layouts', () => {
    const out = filterCourseLibraryItems(items, 'campo 1');
    expect(out).toHaveLength(1);
    expect(out[0].layouts.map((l) => l.id)).toEqual(['a']);
  });

  test('standalone course matched by city', () => {
    const out = filterCourseLibraryItems(items, 'madrid');
    expect(out.map((i) => i.kind)).toEqual(['course']);
  });
});
