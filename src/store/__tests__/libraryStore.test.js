import {
  fetchMyPlayers, fetchMyGuestPlayers, normalizeCourse, saveCourseTees,
  fetchCourses, getCachedCourses, COURSES_CACHE_KEY,
  fetchClubs, getCachedClubs, CLUBS_CACHE_KEY,
  fetchFavoriteCourseIds, getCachedFavoriteCourseIds, FAVORITE_COURSES_CACHE_KEY,
  loadCourseLibrary, loadQuickStartCourses,
} from '../libraryStore';
import { listFriends, getCachedFriends } from '../friendStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// mockState is read inside the hoisted jest.mock factory; the `mock` prefix
// is what lets jest reference it from the factory.
const mockState = {
  user: { id: 'u1' },
  rows: [],
  rowsByTable: null,
  calls: {},
  orderError: null,
};

jest.mock('../../lib/supabase', () => {
  // A lightweight delete-chain object whose eq() resolves to { error: null }.
  // This is returned by client.delete() so existing tests that use client.eq()
  // for select/filter chains are unaffected.
  const deleteChain = {
    eq: () => Promise.resolve({ error: null }),
  };

  const client = {
    from(table) {
      mockState.calls.table = table;
      if (!mockState.calls.tables) mockState.calls.tables = [];
      mockState.calls.tables.push(table);
      return client;
    },
    select(cols) { mockState.calls.select = cols; return client; },
    or(expr) { mockState.calls.or = expr; return client; },
    in(col, vals) {
      if (!mockState.calls.in) mockState.calls.in = [];
      mockState.calls.in.push([col, vals]);
      return client;
    },
    eq(col, val) {
      if (!mockState.calls.eq) mockState.calls.eq = [];
      mockState.calls.eq.push([col, val]);
      return client;
    },
    is(col, val) {
      if (!mockState.calls.is) mockState.calls.is = [];
      mockState.calls.is.push([col, val]);
      return client;
    },
    order() {
      const rows = mockState.rowsByTable?.[mockState.calls.table] ?? mockState.rows;
      return Promise.resolve({ data: rows, error: mockState.orderError ?? null });
    },
    // delete() returns a separate chain so its eq() resolves to { error: null }
    // without affecting the existing client.eq() used by select/filter chains.
    delete() { return deleteChain; },
    // insert() records the rows and resolves to { error: null }.
    insert(rows) {
      mockState.calls.insertedRows = rows;
      return Promise.resolve({ error: null });
    },
    // Makes a filter chain that ends without .order() (e.g. fetchFavoriteCourseIds,
    // which ends at .eq()) awaitable — `await <chain>` resolves to the rows.
    then(resolve) {
      const rows = mockState.rowsByTable?.[mockState.calls.table] ?? mockState.rows;
      resolve({ data: rows, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockState.user } }),
    },
  };
  return { supabase: client };
});

jest.mock('../friendStore', () => ({
  listFriends: jest.fn(),
  getCachedFriends: jest.fn(),
}));

describe('fetchMyPlayers', () => {
  beforeEach(() => {
    mockState.user = { id: 'u1' };
    mockState.rows = [{ id: 'p1', name: 'Ann' }];
    mockState.calls = {};
    listFriends.mockReset();
    getCachedFriends.mockReset();
  });

  test('scopes to created_by = me OR user_id in (me + friends)', async () => {
    listFriends.mockResolvedValue([{ userId: 'f1' }, { userId: 'f2' }]);
    const result = await fetchMyPlayers();
    expect(mockState.calls.table).toBe('players');
    expect(mockState.calls.or).toBe(
      'created_by.eq.u1,user_id.in.(u1,f1,f2)',
    );
    expect(result).toEqual([{ id: 'p1', name: 'Ann' }]);
  });

  test('falls back to cached friends when the friends read fails', async () => {
    listFriends.mockRejectedValue(new Error('offline'));
    getCachedFriends.mockResolvedValue([{ userId: 'f3' }]);
    await fetchMyPlayers();
    expect(mockState.calls.or).toBe('created_by.eq.u1,user_id.in.(u1,f3)');
  });

  test('returns [] without querying when signed out', async () => {
    mockState.user = null;
    const result = await fetchMyPlayers();
    expect(result).toEqual([]);
    expect(mockState.calls.table).toBeUndefined();
  });

  test('scopes to just the current user when they have no friends', async () => {
    listFriends.mockResolvedValue([]);
    await fetchMyPlayers();
    expect(mockState.calls.or).toBe('created_by.eq.u1,user_id.in.(u1)');
  });
});

describe('fetchMyGuestPlayers', () => {
  beforeEach(() => {
    mockState.user = { id: 'u1' };
    mockState.rows = [{ id: 'g1', name: 'Guest', user_id: null }];
    mockState.calls = {};
    listFriends.mockReset();
    getCachedFriends.mockReset();
  });

  test('scopes to created_by = me AND user_id IS NULL', async () => {
    const result = await fetchMyGuestPlayers();
    expect(mockState.calls.table).toBe('players');
    expect(mockState.calls.eq).toEqual([['created_by', 'u1']]);
    expect(mockState.calls.is).toEqual([['user_id', null]]);
    expect(result).toEqual([{ id: 'g1', name: 'Guest', user_id: null }]);
  });

  test('returns [] without querying when signed out', async () => {
    mockState.user = null;
    const result = await fetchMyGuestPlayers();
    expect(result).toEqual([]);
    expect(mockState.calls.table).toBeUndefined();
  });
});

describe('normalizeCourse', () => {
  test('maps course_tees rows into a sorted tees array', () => {
    const out = normalizeCourse({
      id: 'c1', name: 'Pine', slope: null, rating: null,
      course_holes: [],
      course_tees: [
        { id: 't2', label: 'White',  rating: 71.8, slope: 132, sort_order: 1 },
        { id: 't1', label: 'Black',  rating: 73.5, slope: 140, sort_order: 0 },
      ],
    });
    expect(out.tees.map((t) => t.label)).toEqual(['Black', 'White']);
    expect(out.tees[0]).toMatchObject({ label: 'Black', rating: 73.5, slope: 140, sortOrder: 0 });
  });

  test('synthesizes a single unnamed tee from legacy slope/rating when no tee rows', () => {
    const out = normalizeCourse({
      id: 'c2', name: 'Oak', slope: 125, rating: 70.1,
      course_holes: [], course_tees: [],
    });
    expect(out.tees).toHaveLength(1);
    // Label is empty: a legacy course has no real named tees, so the synthetic
    // tee (which only exists to carry rating/slope) must not surface a name.
    expect(out.tees[0]).toMatchObject({ label: '', slope: 125, rating: 70.1 });
  });

  test('yields an empty tees array when there is no tee data at all', () => {
    const out = normalizeCourse({
      id: 'c3', name: 'Elm', slope: null, rating: null,
      course_holes: [], course_tees: [],
    });
    expect(out.tees).toEqual([]);
  });
});

describe('saveCourseTees', () => {
  beforeEach(() => {
    mockState.calls = {};
  });

  test('inserts trimmed, coerced rows with sort_order from index and null yardages', async () => {
    await saveCourseTees('c1', [
      { label: ' White ', rating: '71.8', slope: '132' },
      { label: 'Yellow', rating: 69, slope: 125 },
    ]);
    expect(mockState.calls.insertedRows).toEqual([
      { course_id: 'c1', label: 'White', rating: 71.8, slope: 132, sort_order: 0, yardages: null },
      { course_id: 'c1', label: 'Yellow', rating: 69, slope: 125, sort_order: 1, yardages: null },
    ]);
  });
});

describe('courses offline cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.rowsByTable = null;
    mockState.calls = {};
  });

  test('fetchCourses writes the normalized list to the cache', async () => {
    mockState.rows = [
      { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
    ];
    const result = await fetchCourses();
    const cached = await getCachedCourses();
    expect(cached).toEqual(result);
    expect(cached[0]).toMatchObject({ id: 'c1', name: 'Pine' });
  });

  test('getCachedCourses returns [] when nothing is cached', async () => {
    expect(await getCachedCourses()).toEqual([]);
  });

  test('getCachedCourses returns [] when the cached value is corrupt', async () => {
    await AsyncStorage.setItem(COURSES_CACHE_KEY, 'not-json{');
    expect(await getCachedCourses()).toEqual([]);
  });
});

describe('clubs offline cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.rowsByTable = null;
    mockState.calls = {};
  });

  test('fetchClubs writes the club list to the cache', async () => {
    mockState.rows = [{ id: 'club1', name: 'Augusta', city: 'Augusta', province: 'GA' }];
    const result = await fetchClubs();
    expect(await getCachedClubs()).toEqual(result);
  });

  test('getCachedClubs returns [] when nothing is cached', async () => {
    expect(await getCachedClubs()).toEqual([]);
  });

  test('getCachedClubs returns [] when the cached value is corrupt', async () => {
    await AsyncStorage.setItem(CLUBS_CACHE_KEY, '{bad');
    expect(await getCachedClubs()).toEqual([]);
  });
});

describe('favorite courses offline cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.rowsByTable = null;
    mockState.calls = {};
  });

  test('fetchFavoriteCourseIds caches the ids and round-trips through a Set', async () => {
    mockState.rows = [{ course_id: 'c1' }, { course_id: 'c2' }];
    const result = await fetchFavoriteCourseIds();
    expect(result).toEqual(new Set(['c1', 'c2']));
    expect(await getCachedFavoriteCourseIds()).toEqual(new Set(['c1', 'c2']));
  });

  test('getCachedFavoriteCourseIds returns an empty Set when nothing is cached', async () => {
    expect(await getCachedFavoriteCourseIds()).toEqual(new Set());
  });

  test('getCachedFavoriteCourseIds returns an empty Set when the cached value is corrupt', async () => {
    await AsyncStorage.setItem(FAVORITE_COURSES_CACHE_KEY, 'nope');
    expect(await getCachedFavoriteCourseIds()).toEqual(new Set());
  });
});

describe('loadCourseLibrary', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.rowsByTable = null;
    mockState.calls = {};
    mockState.orderError = null;
  });

  test('online: returns fetched courses with usingCachedData false', async () => {
    mockState.rows = [
      { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
    ];
    const result = await loadCourseLibrary();
    expect(result.usingCachedData).toBe(false);
    expect(result.courses.map((c) => c.name)).toEqual(['Pine']);
  });

  test('offline: falls back to the cached library with usingCachedData true', async () => {
    mockState.rows = [
      { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
    ];
    await fetchCourses();                          // online — seeds the cache
    mockState.orderError = { message: 'offline' }; // now fetchCourses rejects
    const result = await loadCourseLibrary();
    expect(result.usingCachedData).toBe(true);
    expect(result.courses.map((c) => c.name)).toEqual(['Pine']);
  });

  test('offline with an empty cache: returns no courses, usingCachedData true', async () => {
    mockState.orderError = { message: 'offline' };
    const result = await loadCourseLibrary();
    expect(result.usingCachedData).toBe(true);
    expect(result.courses).toEqual([]);
  });
});

describe('loadQuickStartCourses', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockState.user = { id: 'u1' };
    mockState.rows = [];
    mockState.rowsByTable = null;
    mockState.calls = {};
    mockState.orderError = null;
  });

  test('online: fetches only favorite course details and skips clubs', async () => {
    mockState.rowsByTable = {
      favorite_courses: [{ course_id: 'c2' }, { course_id: 'c1' }],
      courses: [
        { id: 'c2', name: 'Oak', slope: null, rating: null, course_holes: [], course_tees: [] },
        { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
      ],
    };

    const result = await loadQuickStartCourses();

    expect(result.usingCachedData).toBe(false);
    expect(result.courses.map((course) => course.id)).toEqual(['c2', 'c1']);
    expect(mockState.calls.tables).toEqual(['favorite_courses', 'courses']);
    expect(mockState.calls.in).toEqual([['id', ['c2', 'c1']]]);
  });

  test('online: skips the course detail query when no favorites exist', async () => {
    mockState.rowsByTable = {
      favorite_courses: [],
      courses: [
        { id: 'c1', name: 'Pine', slope: null, rating: null, course_holes: [], course_tees: [] },
      ],
    };

    const result = await loadQuickStartCourses();

    expect(result).toEqual({ courses: [], usingCachedData: false });
    expect(mockState.calls.tables).toEqual(['favorite_courses']);
    expect(mockState.calls.in).toBeUndefined();
  });
});
