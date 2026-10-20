import {
  normalizeText, buildCourseLibraryItems,
  regionSummary, regionItems, recentCourses, searchCourses,
  computeSiIssues, computeDupeTeeLabels, canSaveCourse, roundHolesArePersistable,
} from '../courseLibrary';
import { setLanguagePref } from '../../i18n';

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

// The picker's views over a federation-sized library (CoursePickerScreen).
describe('picker views', () => {
  const clubs = [
    { id: 'vm', name: 'Real Club de Campo Villa de Madrid', city: 'Madrid', province: 'Madrid' },
    { id: 'vd', name: 'Real Club Valderrama', city: 'Sotogrande', province: 'Andalusia' },
    { id: 'empty', name: 'Club Without Courses', city: null, province: 'Galicia' },
  ];
  const courses = [
    course('vm-n', 'Real Club de Campo Villa de Madrid — Negro', { clubId: 'vm', layoutName: 'Negro' }),
    course('vm-a', 'Real Club de Campo Villa de Madrid — Amarillo', { clubId: 'vm', layoutName: 'Amarillo' }),
    course('vd-1', 'Real Club Valderrama — Valderrama', { clubId: 'vd', layoutName: 'Valderrama' }),
    course('cng', 'Centro Nacional de Golf', { city: 'Madrid', province: 'Madrid' }),
    course('fa', 'La Faisanera', { city: 'Segovia', province: 'Castile and León' }),
    course('lost', 'Golf Sin Región'),
  ];

  test('regionSummary counts clubs and club-less courses once each, most first, no-region last', () => {
    expect(regionSummary(courses, clubs)).toEqual([
      { region: 'Madrid', count: 2 },
      { region: 'Andalusia', count: 1 },
      { region: 'Castile and León', count: 1 },
      { region: null, count: 1 },
    ]);
  });

  test('regionItems groups a region by club, in name order', () => {
    const items = regionItems(courses, clubs, 'Madrid');
    expect(items.map((it) => (it.kind === 'club' ? it.club.name : it.course.name))).toEqual([
      'Centro Nacional de Golf', 'Real Club de Campo Villa de Madrid',
    ]);
    expect(items[1].layouts).toHaveLength(2);
  });

  test('recentCourses: newest first, favourites left out, capped', () => {
    const lastUsed = { 'vm-n': 300, cng: 200, fa: 100, 'vd-1': 400 };
    expect(recentCourses(courses, lastUsed, new Set(['vd-1']), 2).map((c) => c.id)).toEqual(['vm-n', 'cng']);
  });

  test('searchCourses returns layouts grouped under their club, accent-insensitive', () => {
    const { groups, total } = searchCourses(courses, clubs, 'VILLA');
    expect(total).toBe(2);
    expect(groups).toHaveLength(1);
    expect(groups[0].club.id).toBe('vm');
    expect(groups[0].courses.map((c) => c.id)).toEqual(['vm-a', 'vm-n']);
    expect(searchCourses(courses, clubs, 'leon').groups[0].courses[0].id).toBe('fa');
  });

  test('searchCourses matches the club city and region, and a layout name alone', () => {
    expect(searchCourses(courses, clubs, 'sotogrande').total).toBe(1);
    expect(searchCourses(courses, clubs, 'andalusia').total).toBe(1);
    expect(searchCourses(courses, clubs, 'negro').groups[0].courses.map((c) => c.id)).toEqual(['vm-n']);
  });

  test('searchCourses puts names that start with the query first and caps the courses', () => {
    const { groups, total } = searchCourses(courses, clubs, 'madrid', 2);
    expect(total).toBe(3);
    // "Real Club de Campo Villa de Madrid" only contains it; "Centro…" is in Madrid
    // by city. Neither starts with it, so alphabetical: Centro first.
    expect(groups[0].courses[0].id).toBe('cng');
    expect(groups.flatMap((g) => g.courses)).toHaveLength(2);
    expect(searchCourses(courses, clubs, 'la faisanera').groups[0].courses[0].id).toBe('fa');
    expect(searchCourses(courses, clubs, 'real club v').groups[0].club.id).toBe('vd');
  });

  test('a blank query finds nothing', () => {
    expect(searchCourses(courses, clubs, '  ')).toEqual({ groups: [], total: 0 });
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

describe('computeSiIssues in Spanish', () => {
  beforeEach(async () => { await setLanguagePref('es'); });
  afterEach(async () => { await setLanguagePref('en'); });

  test('issues are written in Spanish with the same details', () => {
    const dupes = cleanHoles();
    dupes[1] = { ...dupes[1], strokeIndex: dupes[0].strokeIndex };
    const issues = computeSiIssues(dupes);
    expect(issues.some((i) => i.startsWith('HCP repetidos: '))).toBe(true);
    expect(issues.some((i) => i.startsWith('HCP que faltan: '))).toBe(true);
    const range = cleanHoles();
    range[0] = { ...range[0], strokeIndex: 30 };
    expect(computeSiIssues(range)[0]).toBe('Hoyo 1: el HCP debe estar entre 1 y 18');
  });
});

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

  test('a nine-hole card is validated against 1..9, not 1..18', () => {
    const nine = cleanHoles().slice(0, 9).map((h, i) => ({ ...h, strokeIndex: i + 1 }));
    expect(computeSiIssues(nine)).toEqual([]);
  });

  test('a nine-hole card with an out-of-range SI is flagged', () => {
    const nine = cleanHoles().slice(0, 9).map((h, i) => ({ ...h, strokeIndex: i + 1 }));
    nine[0] = { ...nine[0], strokeIndex: 12 };
    const issues = computeSiIssues(nine);
    expect(issues.some((i) => i.includes('SI must be 1–9'))).toBe(true);
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

// ---------------------------------------------------------------------------
// roundHolesArePersistable — Task 13: the round-holes editor (SetupScreen /
// EditTournamentScreen, via CourseEditorScreen opened WITHOUT a courseId)
// writes straight into a round's `holes`/`tees`, bypassing the course-library
// save-guard entirely. This predicate is the shared gate reused on that
// persist path so the SAME SI/tee-label rules apply there too.
// ---------------------------------------------------------------------------

describe('roundHolesArePersistable', () => {
  test('a round with a clean, complete SI set and unique tee labels is persistable', () => {
    expect(roundHolesArePersistable({ holes: cleanHoles(), tees: cleanTees() })).toBe(true);
  });

  test('a round with duplicate SI is not persistable', () => {
    const holes = cleanHoles();
    holes[1] = { ...holes[1], strokeIndex: holes[0].strokeIndex };
    expect(roundHolesArePersistable({ holes, tees: cleanTees() })).toBe(false);
  });

  test('a round with a partial (incomplete) SI set is not persistable', () => {
    const holes = cleanHoles();
    holes[0] = { ...holes[0], strokeIndex: 2 }; // now nothing has SI 1, SI 2 used twice
    expect(roundHolesArePersistable({ holes, tees: cleanTees() })).toBe(false);
  });

  test('a round with duplicate tee labels is not persistable even with clean SI', () => {
    const tees = [
      { id: 't1', label: 'White', rating: 71.5, slope: 128 },
      { id: 't2', label: 'White', rating: 73.2, slope: 132 },
    ];
    expect(roundHolesArePersistable({ holes: cleanHoles(), tees })).toBe(false);
  });

  test('an empty/not-yet-populated holes array is persistable (nothing to contradict yet)', () => {
    expect(roundHolesArePersistable({ holes: [], tees: [] })).toBe(true);
  });

  test('a round missing holes/tees entirely (null round fields) does not throw and is persistable', () => {
    expect(roundHolesArePersistable({})).toBe(true);
  });
});
