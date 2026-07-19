import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { setCourseGeometry } from '../lib/geo';
import { assembleCourses } from '../lib/courseGeometryShape';

// Loads GPS course geometry from the golf_* Supabase tables, caches the
// assembled result in AsyncStorage, and pushes it into geo.js via
// setCourseGeometry(). Order of availability:
//   1) bundled JSON seed (geo.js default) — instant, offline, may be stale
//   2) AsyncStorage cache — instant on repeat launches, offline
//   3) Supabase fetch — authoritative, requires network
// GPS distances keep working at every stage; each step just upgrades the data.

// v2: v1 cached the assembled blob with [null,null] point coords passed through
// (pre-sanitize); bumping discards that poisoned cache so the sanitized fetch wins.
const CACHE_KEY = 'courseGeometry.v2';

async function fetchGeometry() {
  const [courses, holes, hazards, greens] = await Promise.all([
    supabase.from('golf_course').select('id,name,mode,match_tokens,source'),
    supabase.from('golf_hole').select('course_id,number,par,green,green_center,green_front,green_back,pin,tees,start_pt'),
    supabase.from('golf_hazard').select('course_id,hole_number,kind,poly,ordinal'),
    supabase.from('golf_green').select('course_id,ordinal,poly,center'),
  ]);
  const err = courses.error || holes.error || hazards.error || greens.error;
  if (err) throw err;
  return assembleCourses({
    courses: courses.data ?? [],
    holes: holes.data ?? [],
    hazards: hazards.data ?? [],
    greens: greens.data ?? [],
  });
}

// Call once at app boot. Never throws — GPS falls back to seed/cache on failure.
export async function hydrateCourseGeometry() {
  // Cache first so a repeat launch has live data before the network responds.
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) setCourseGeometry(JSON.parse(cached));
  } catch {
    // ignore corrupt/missing cache — seed already active
  }
  try {
    const courses = await fetchGeometry();
    if (courses.length) {
      setCourseGeometry(courses);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(courses));
    }
  } catch {
    // offline or table not migrated yet — keep cache/seed
  }
}
