import {
  normalizeText, buildCourseLibraryItems, filterCourseLibraryItems,
  computeSiIssues, computeDupeTeeLabels, canSaveCourse,
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

// ---------------------------------------------------------------------------
// Save-guard: stroke-index + duplicate tee-label validation.
// ---------------------------------------------------------------------------

function cleanHoles() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}

function cleanTees() {
  return [
    { id: 't1', label: 'White', rating: 71.5, slope: 128 },
    { id: 't2', label: 'Blue', rating: 73.2, slope: 132 },
  ];
}

describe('computeSiIssues', () => {
  test('complete 1..18 permutation → no issues', () => {
    expect(computeSiIssues(cleanHoles())).toEqual([]);
  });

  test('duplicate SI values are flagged', () => {
    const holes = cleanHoles();
    holes[1] = { ...holes[1], strokeIndex: holes[0].strokeIndex }; // hole 2 dupes hole 1's SI
    const issues = computeSiIssues(holes);
    expect(issues.some((i) => i.startsWith('Duplicate SI'))).toBe(true);
  });

  test('missing SI values are flagged', () => {
    const holes = cleanHoles();
    holes[0] = { ...holes[0], strokeIndex: 2 }; // now nothing has SI 1, SI 2 used twice
    const issues = computeSiIssues(holes);
    expect(issues.some((i) => i.startsWith('Missing SI'))).toBe(true);
  });

  test('SI of 0 is flagged as invalid', () => {
    const holes = cleanHoles();
    holes[0] = { ...holes[0], strokeIndex: 0 };
    const issues = computeSiIssues(holes);
    expect(issues.some((i) => i.includes('Hole 1'))).toBe(true);
  });

  test('missing/undefined strokeIndex is flagged as invalid', () => {
    const holes = cleanHoles();
    delete holes[0].strokeIndex;
    const issues = computeSiIssues(holes);
    expect(issues.some((i) => i.includes('Hole 1'))).toBe(true);
  });
});

describe('computeDupeTeeLabels', () => {
  test('unique labels → no dupes', () => {
    expect(computeDupeTeeLabels(cleanTees())).toEqual([]);
  });

  test('duplicate labels (case/whitespace-insensitive) are flagged', () => {
    const tees = [
      { id: 't1', label: 'White', rating: 71.5, slope: 128 },
      { id: 't2', label: ' white ', rating: 73.2, slope: 132 },
    ];
    expect(computeDupeTeeLabels(tees)).toEqual(['white']);
  });

  test('empty labels are ignored, not treated as dupes', () => {
    const tees = [
      { id: 't1', label: '', rating: 71.5, slope: 128 },
      { id: 't2', label: '', rating: 73.2, slope: 132 },
    ];
    expect(computeDupeTeeLabels(tees)).toEqual([]);
  });
});

describe('canSaveCourse', () => {
  test('clean course passes', () => {
    const result = canSaveCourse(cleanHoles(), cleanTees());
    expect(result).toEqual({ ok: true, siIssues: [], dupes: [] });
  });

  test('blocks on duplicate SI', () => {
    const holes = cleanHoles();
    holes[1] = { ...holes[1], strokeIndex: holes[0].strokeIndex };
    const result = canSaveCourse(holes, cleanTees());
    expect(result.ok).toBe(false);
    expect(result.siIssues.length).toBeGreaterThan(0);
  });

  test('blocks on missing SI', () => {
    const holes = cleanHoles();
    holes[0] = { ...holes[0], strokeIndex: 2 };
    const result = canSaveCourse(holes, cleanTees());
    expect(result.ok).toBe(false);
    expect(result.siIssues.length).toBeGreaterThan(0);
  });

  test('blocks on SI of 0', () => {
    const holes = cleanHoles();
    holes[0] = { ...holes[0], strokeIndex: 0 };
    const result = canSaveCourse(holes, cleanTees());
    expect(result.ok).toBe(false);
    expect(result.siIssues.length).toBeGreaterThan(0);
  });

  test('blocks on duplicate tee labels', () => {
    const tees = [
      { id: 't1', label: 'White', rating: 71.5, slope: 128 },
      { id: 't2', label: 'White', rating: 73.2, slope: 132 },
    ];
    const result = canSaveCourse(cleanHoles(), tees);
    expect(result.ok).toBe(false);
    expect(result.dupes).toEqual(['white']);
  });
});
