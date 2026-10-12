import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import {
  hydrateCourseGeometry, ensureCourseGeometry, _resetForTests,
} from '../courseGeometryStore';
import {
  setCourseGeometry, findCourseGeometry, getCourseGeometry, hasCourseDetails,
} from '../../lib/geo';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const COURSE_ROW = { id: 'zeta', name: 'Zeta Golf', mode: 'holes', match_tokens: [['zeta']], source: 'OSM' };
const HOLE_ROW = { course_id: 'zeta', number: 1, par: 4, green_center: [38.5, -0.1] };
const HAZARD_ROW = { course_id: 'zeta', hole_number: 1, kind: 'bunker', poly: [[1, 1], [1, 2], [2, 2]], ordinal: 0 };

// Chainable PostgREST stand-in: resolves with `tables[table]` (or an error).
function mockTables(tables, { error = null } = {}) {
  supabase.from.mockImplementation((table) => {
    const res = () => Promise.resolve(error ? { data: null, error } : { data: tables[table] ?? [], error: null });
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      range: res,
      then: (ok, ko) => res().then(ok, ko),
    };
    return q;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  setCourseGeometry([]); // bundled seed
  AsyncStorage.getItem.mockResolvedValue(null);
});

describe('hydrateCourseGeometry', () => {
  it('merges the course index without touching seed details, caches it', async () => {
    const seedCount = getCourseGeometry().length;
    const seedKey = getCourseGeometry()[0].key;
    mockTables({ golf_course: [COURSE_ROW, { ...COURSE_ROW, id: seedKey, name: 'Renamed' }] });
    await hydrateCourseGeometry();
    expect(getCourseGeometry()).toHaveLength(seedCount + 1);
    expect(hasCourseDetails(findCourseGeometry('Zeta Golf'))).toBe(false);
    expect(hasCourseDetails(getCourseGeometry().find((c) => c.key === seedKey))).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('courseGeometry.index.v3', expect.any(String));
    expect(supabase.from).toHaveBeenCalledTimes(1); // no hole/hazard/green fetch
  });

  it('splits the v2 blob into per-course caches before dropping it, even offline', async () => {
    const legacy = { key: 'zeta', name: 'Zeta Golf', matchTokens: [['zeta']], mode: 'holes', holes: [{ number: 1, greenCenter: [38.5, -0.1] }] };
    AsyncStorage.getItem.mockImplementation((k) => Promise.resolve(k === 'courseGeometry.v2' ? JSON.stringify([legacy]) : null));
    mockTables({}, { error: new Error('offline') });
    await hydrateCourseGeometry();
    expect(hasCourseDetails(findCourseGeometry('Zeta Golf'))).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('courseGeometry.v3.zeta', JSON.stringify(legacy));
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('courseGeometry.v2');
  });

  it('keeps the seed when offline', async () => {
    mockTables({}, { error: new Error('offline') });
    await expect(hydrateCourseGeometry()).resolves.toBeUndefined();
    expect(findCourseGeometry('Zeta Golf')).toBeNull();
  });
});

describe('ensureCourseGeometry', () => {
  beforeEach(async () => {
    mockTables({ golf_course: [COURSE_ROW] });
    await hydrateCourseGeometry();
    jest.clearAllMocks();
  });

  it('fetches one course, merges its details and caches them per course', async () => {
    mockTables({ golf_course: [COURSE_ROW], golf_hole: [HOLE_ROW], golf_hazard: [HAZARD_ROW] });
    const course = await ensureCourseGeometry('Zeta Golf');
    expect(course.holes).toHaveLength(1);
    expect(course.holes[0].hazards).toEqual([{ kind: 'bunker', poly: HAZARD_ROW.poly }]);
    expect(findCourseGeometry('Zeta')).toBe(course);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('courseGeometry.v3.zeta', JSON.stringify(course));
  });

  it('applies the per-course cache before the network', async () => {
    const cached = { key: 'zeta', name: 'Zeta Golf', matchTokens: [['zeta']], mode: 'holes', holes: [{ number: 9 }] };
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(cached));
    mockTables({}, { error: new Error('offline') });
    const course = await ensureCourseGeometry('zeta');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('courseGeometry.v3.zeta');
    expect(course.holes[0].number).toBe(9);
  });

  it('dedupes concurrent calls and fetches once per session', async () => {
    mockTables({ golf_course: [COURSE_ROW], golf_hole: [HOLE_ROW] });
    const [a, b] = await Promise.all([ensureCourseGeometry('zeta'), ensureCourseGeometry('Zeta Golf')]);
    expect(a).toBe(b);
    const calls = supabase.from.mock.calls.length;
    expect(calls).toBe(4); // course + holes + hazards + greens
    await ensureCourseGeometry('zeta');
    expect(supabase.from.mock.calls.length).toBe(calls);
    await ensureCourseGeometry('zeta', { force: true });
    expect(supabase.from.mock.calls.length).toBe(calls + 4);
  });

  it('never throws offline and keeps the index entry', async () => {
    mockTables({}, { error: new Error('offline') });
    const course = await ensureCourseGeometry('zeta');
    expect(course.key).toBe('zeta');
    expect(hasCourseDetails(course)).toBe(false);
  });

  it('resolves null for an unknown course', async () => {
    await expect(ensureCourseGeometry('Nowhere CC')).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
