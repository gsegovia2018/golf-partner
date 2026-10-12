import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import {
  mergeCourseGeometry, getCourseGeometry, findCourseGeometry,
} from '../lib/geo';
import { assembleCourses } from '../lib/courseGeometryShape';

// Loads GPS course geometry from the golf_* Supabase tables into geo.js, in
// two tiers so neither the response (PostgREST caps at 1000 rows) nor the
// cache (Android's ~2 MB AsyncStorage row) grows with the course library:
//   - index (golf_course: name/matchTokens/mode) at launch, so any round's
//     course name resolves;
//   - details (holes/hazards/greens) per course, on demand, when a screen
//     actually uses that course — ensureCourseGeometry().
// Each tier is seed → AsyncStorage cache → Supabase fetch; the bundled JSON
// seed stays the offline default and every step only merges upward (an index
// entry never replaces a loaded course — see geo.mergeCourseGeometry).

const INDEX_KEY = 'courseGeometry.index.v3';
const courseKey = (id) => `courseGeometry.v3.${id}`;
// v2 cached every course's details in one blob; superseded by the per-course
// keys above. Removed at launch so it doesn't linger.
const LEGACY_KEY = 'courseGeometry.v2';

const PAGE = 1000; // PostgREST max_rows

const toIndexEntry = (c) => ({
  key: c.id, name: c.name, matchTokens: c.match_tokens, mode: c.mode, source: c.source,
});

// The v2 blob is split into per-course caches before it is dropped: the first
// launch after this update may happen on a course with no signal, and every
// course the blob held must stay playable there.
async function migrateLegacyCache() {
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const courses = JSON.parse(legacy);
    if (Array.isArray(courses)) {
      mergeCourseGeometry(courses);
      await Promise.all(courses.filter((c) => c?.key)
        .map((c) => AsyncStorage.setItem(courseKey(c.key), JSON.stringify(c))));
    }
    await AsyncStorage.removeItem(LEGACY_KEY);
  } catch {
    // corrupt blob or storage error — retried next launch
  }
}

// Call once at app boot. Never throws — GPS falls back to seed/cache on failure.
export async function hydrateCourseGeometry() {
  await migrateLegacyCache();
  try {
    const cached = await AsyncStorage.getItem(INDEX_KEY);
    if (cached) mergeCourseGeometry(JSON.parse(cached));
  } catch {
    // ignore corrupt/missing cache — seed already active
  }
  try {
    const { data, error } = await supabase.from('golf_course').select('id,name,mode,match_tokens,source');
    if (error) throw error;
    const index = (data ?? []).map(toIndexEntry);
    if (index.length) {
      mergeCourseGeometry(index);
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
    }
  } catch {
    // offline or table not migrated yet — keep cache/seed
  }
}

// Every row of `table` for one course, paged past the 1000-row cap (a course
// is ~18 holes and ~100-150 hazards, so this is normally a single page).
async function fetchCourseRows(table, cols, id, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(cols).eq('course_id', id);
    for (const col of order) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// One course, assembled. Re-reads its golf_course row too: the entry we hold
// may be the bundled seed, whose mode/matchTokens can be stale.
async function fetchCourseDetails(id) {
  const [course, holes, hazards, greens] = await Promise.all([
    supabase.from('golf_course').select('id,name,mode,match_tokens,source').eq('id', id),
    fetchCourseRows('golf_hole', 'course_id,number,par,green,green_center,green_front,green_back,pin,tees,start_pt', id, ['number']),
    fetchCourseRows('golf_hazard', 'course_id,hole_number,kind,poly,ordinal', id, ['hole_number', 'ordinal']),
    fetchCourseRows('golf_green', 'course_id,ordinal,poly,center', id, ['ordinal']),
  ]);
  if (course.error) throw course.error;
  if (!course.data?.length) return null;
  return assembleCourses({ courses: course.data, holes, hazards, greens })[0];
}

const fetchedThisSession = new Set(); // course ids refreshed from Supabase
const cacheRead = new Set(); // course ids whose per-course cache was applied
const inFlight = new Map(); // course id -> Promise

// Make sure one course's holes/hazards/greens are loaded: its per-course cache
// first (offline), then Supabase once per session. `force` refetches (after an
// admin edit). Accepts a course key or a round's course name. Concurrent calls
// for the same course share one request. Resolves to the course (or null);
// never throws — offline keeps whatever is loaded.
export function ensureCourseGeometry(courseIdOrName, { force = false } = {}) {
  const entry = getCourseGeometry().find((c) => c.key === courseIdOrName)
    ?? findCourseGeometry(courseIdOrName);
  if (!entry) return Promise.resolve(null);
  const id = entry.key;
  if (inFlight.has(id)) {
    // A forced refresh must not settle for a fetch that began before the edit.
    return force
      ? inFlight.get(id).then(() => ensureCourseGeometry(id, { force: true }))
      : inFlight.get(id);
  }
  if (!force && fetchedThisSession.has(id)) return Promise.resolve(entry);

  const run = (async () => {
    if (!force && !cacheRead.has(id)) {
      cacheRead.add(id);
      try {
        const cached = await AsyncStorage.getItem(courseKey(id));
        if (cached) mergeCourseGeometry([JSON.parse(cached)]);
      } catch {
        // ignore corrupt/missing cache
      }
    }
    try {
      const course = await fetchCourseDetails(id);
      fetchedThisSession.add(id);
      if (course) {
        mergeCourseGeometry([course]);
        await AsyncStorage.setItem(courseKey(id), JSON.stringify(course));
      }
    } catch {
      // offline — keep seed/cache
    }
    return getCourseGeometry().find((c) => c.key === id) ?? null;
  })();
  inFlight.set(id, run);
  run.finally(() => inFlight.delete(id));
  return run;
}

export function _resetForTests() {
  fetchedThisSession.clear();
  cacheRead.clear();
  inFlight.clear();
}
