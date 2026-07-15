import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { listFriends, getCachedFriends } from './friendStore';
import { parseHandicapIndex } from '../lib/handicap';

// ── Players ──────────────────────────────────────────────────────────────────

export async function fetchPlayers() {
  // `*` already includes avatar_url + user_id (added by later migrations);
  // kept explicit to signal downstream consumers what to rely on.
  const { data, error } = await supabase
    .from('players')
    .select('id, name, handicap, user_id, avatar_url, created_at, gender')
    .order('name');
  if (error) throw error;
  return data;
}

// Columns every player consumer relies on. Shared by the scoped readers below.
const PLAYER_COLUMNS = 'id, name, handicap, user_id, avatar_url, created_at, created_by, gender';

// Accepted-friend auth user ids. Falls back to the offline cache when the
// network read fails, so the picker still scopes sensibly offline.
async function myFriendIds() {
  try {
    const friends = await listFriends();
    return friends.map((f) => f.userId).filter(Boolean);
  } catch {
    const cached = await getCachedFriends();
    return cached.map((f) => f.userId).filter(Boolean);
  }
}

// Players the current user may ADD to a game: their own guest players
// (created_by = me), their own app-user row, and every friend's app-user
// row. Including the current user themselves is intentional — the picker
// lets you add yourself to a game. Signed-out → [].
export async function fetchMyPlayers() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const friendIds = await myFriendIds();
  const userIds = [user.id, ...friendIds].filter(Boolean);
  // userIds are all auth UUIDs (the current user + friend user_ids), so they
  // are safe to interpolate into this raw PostgREST .or() filter — postgrest-js
  // has no parameterized form for `user_id.in.(...)`.
  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_COLUMNS)
    .or(`created_by.eq.${user.id},user_id.in.(${userIds.join(',')})`)
    .order('name');
  if (error) throw error;
  return data;
}

// Players the current user MANAGES in their library: only their own guest
// players (created_by = me, no app account). Signed-out → [].
export async function fetchMyGuestPlayers() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_COLUMNS)
    .eq('created_by', user.id)
    .is('user_id', null)
    .order('name');
  if (error) throw error;
  return data;
}

export async function upsertPlayer({ id, name, handicap, gender }) {
  const parsed = parseHandicapIndex(handicap);
  // A genuinely bad handicap (garbage, out of range — reason 'invalid') must
  // never be silently coerced to 0; that badly skews net scoring downstream.
  // An empty field (reason 'required') keeps the existing "no handicap" ->
  // 0 default, since that's a deliberate blank, not a typo.
  if (!parsed.ok && parsed.reason === 'invalid') {
    throw new Error('Handicap must be a number between 0 and 54, with up to one decimal place.');
  }
  const row = { name, handicap: parsed.ok ? parsed.value : 0 };
  if (gender !== undefined) row.gender = gender === 'female' ? 'female' : 'male';
  if (id) row.id = id;
  const { data, error } = await supabase.from('players').upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function deletePlayer(id) {
  const { error } = await supabase.from('players').delete().eq('id', id);
  if (error) throw error;
}

// ── Courses ───────────────────────────────────────────────────────────────────
// Offline cache: the picker falls back to these last-known lists when a fetch
// fails, so a casual game can still be set up without a connection.

export const COURSES_CACHE_KEY = '@golf_courses_cache';
export const QUICK_START_COURSES_CACHE_KEY = '@golf_quick_start_courses_cache';

export async function fetchCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*, course_holes(*), course_tees(*)')
    .order('name');
  if (error) throw error;
  const courses = data.map(normalizeCourse);
  // Write-through cache, fire-and-forget (mirrors friendStore.listFriends).
  AsyncStorage.setItem(COURSES_CACHE_KEY, JSON.stringify(courses)).catch(() => {});
  return courses;
}

async function fetchCoursesByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('courses')
    .select('*, course_holes(*), course_tees(*)')
    .in('id', ids)
    .order('name');
  if (error) throw error;
  return data.map(normalizeCourse);
}

// Last-known course library — used when fetchCourses fails (offline). Never
// throws; returns [] when nothing is cached or the cache is unreadable.
export async function getCachedCourses() {
  try {
    const raw = await AsyncStorage.getItem(COURSES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getCachedQuickStartCourses() {
  try {
    const raw = await AsyncStorage.getItem(QUICK_START_COURSES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// All clubs, ordered by name. A club groups several course layouts; the
// picker uses this together with fetchCourses to build its grouped list.
export const CLUBS_CACHE_KEY = '@golf_clubs_cache';

export async function fetchClubs() {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, city, province')
    .order('name');
  if (error) throw error;
  AsyncStorage.setItem(CLUBS_CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return data;
}

// Last-known club list — used when fetchClubs fails (offline). Never throws.
export async function getCachedClubs() {
  try {
    const raw = await AsyncStorage.getItem(CLUBS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function upsertCourse({ id, name, city, province, clubId, layoutName }) {
  const row = {
    name,
    city: city?.trim() || null,
    province: province?.trim() || null,
  };
  if (clubId !== undefined) row.club_id = clubId;
  if (layoutName !== undefined) row.layout_name = layoutName;
  if (id) row.id = id;
  const { data, error } = await supabase.from('courses').upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function saveCourseHoles(courseId, holes) {
  await supabase.from('course_holes').delete().eq('course_id', courseId);
  if (!holes.length) return;
  const { error } = await supabase.from('course_holes').insert(
    holes.map((h) => ({
      course_id: courseId,
      number: h.number,
      par: h.par,
      stroke_index: h.strokeIndex,
    })),
  );
  if (error) throw error;
}

export async function deleteCourse(id) {
  const { error } = await supabase.from('courses').delete().eq('id', id);
  if (error) throw error;
}

// Replace a course's tee list. Delete-then-insert (mirrors saveCourseHoles);
// tee ids are therefore not stable across saves — callers match tees by
// `label`, never by id.
export async function saveCourseTees(courseId, tees) {
  const { error: delErr } = await supabase.from('course_tees').delete().eq('course_id', courseId);
  if (delErr) throw delErr;
  if (!tees || !tees.length) return;
  const rows = tees.map((t, i) => ({
    course_id: courseId,
    label: String(t.label ?? '').trim(),
    rating: t.rating != null && t.rating !== '' ? parseFloat(t.rating) : null,
    slope: t.slope != null && t.slope !== '' ? parseInt(t.slope, 10) : null,
    rating_women: t.ratingWomen != null && t.ratingWomen !== '' ? parseFloat(t.ratingWomen) : null,
    slope_women: t.slopeWomen != null && t.slopeWomen !== '' ? parseInt(t.slopeWomen, 10) : null,
    sort_order: i,
    yardages: t.yardages ?? null,
  }));
  const { error } = await supabase.from('course_tees').insert(rows);
  if (error) throw error;
}

// Called from CourseEditorScreen / CourseLibraryDetailScreen to sync holes +
// tees back to the course library.
export async function updateCourseFromEditor(courseId, holes, tees) {
  await saveCourseHoles(courseId, holes);
  await saveCourseTees(courseId, tees);
}

// ── Favorite courses ─────────────────────────────────────────────────────────
// Per-user toggle. Unauthenticated sessions get an empty set and a no-op
// toggle so callers can render the control the same way either way.

export const FAVORITE_COURSES_CACHE_KEY = '@golf_fav_courses_cache';

export async function fetchFavoriteCourseIds() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('favorite_courses')
    .select('course_id')
    .eq('user_id', user.id);
  if (error) throw error;
  const ids = new Set((data ?? []).map((r) => r.course_id));
  // Cache as an array — a Set does not survive JSON serialization.
  AsyncStorage.setItem(FAVORITE_COURSES_CACHE_KEY, JSON.stringify([...ids])).catch(() => {});
  return ids;
}

// Last-known favorite course ids as a Set. Never throws; returns an empty Set
// when nothing is cached or the cache is unreadable.
export async function getCachedFavoriteCourseIds() {
  try {
    const raw = await AsyncStorage.getItem(FAVORITE_COURSES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

// Loads the course library for the picker. Online, each underlying fetch also
// refreshes its cache. If the course fetch fails (offline), the whole library
// is served from the last-known cache and usingCachedData is true so the
// caller can disable course creation. Never throws.
export async function loadCourseLibrary() {
  try {
    const courses = await fetchCourses();
    const [clubs, favorites] = await Promise.all([
      fetchClubs().catch(() => getCachedClubs()),
      fetchFavoriteCourseIds().catch(() => getCachedFavoriteCourseIds()),
    ]);
    return { courses, clubs, favorites, usingCachedData: false };
  } catch {
    const [courses, clubs, favorites] = await Promise.all([
      getCachedCourses(),
      getCachedClubs(),
      getCachedFavoriteCourseIds(),
    ]);
    return { courses, clubs, favorites, usingCachedData: true };
  }
}

export async function loadQuickStartCourses() {
  try {
    const favoriteIds = await fetchFavoriteCourseIds();
    const ids = [...favoriteIds];
    if (ids.length === 0) {
      AsyncStorage.setItem(QUICK_START_COURSES_CACHE_KEY, JSON.stringify([])).catch(() => {});
      return { courses: [], usingCachedData: false };
    }
    const courses = await fetchCoursesByIds(ids);
    AsyncStorage.setItem(QUICK_START_COURSES_CACHE_KEY, JSON.stringify(courses)).catch(() => {});
    return { courses, usingCachedData: false };
  } catch {
    const cachedQuickStartCourses = await getCachedQuickStartCourses();
    if (cachedQuickStartCourses.length > 0) {
      return { courses: cachedQuickStartCourses, usingCachedData: true };
    }
    const [courses, favoriteIds] = await Promise.all([
      getCachedCourses(),
      getCachedFavoriteCourseIds(),
    ]);
    return {
      courses: courses.filter((course) => favoriteIds.has(course.id)),
      usingCachedData: true,
    };
  }
}

export async function toggleFavoriteCourse(courseId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { favorite: false };
  const { data: existing, error: selErr } = await supabase
    .from('favorite_courses')
    .select('course_id')
    .eq('user_id', user.id)
    .eq('course_id', courseId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    const { error } = await supabase
      .from('favorite_courses')
      .delete()
      .eq('user_id', user.id)
      .eq('course_id', courseId);
    if (error) throw error;
    return { favorite: false };
  }
  const { error } = await supabase
    .from('favorite_courses')
    .insert({ user_id: user.id, course_id: courseId });
  if (error) throw error;
  return { favorite: true };
}


// Convert Supabase course row → app-friendly shape
export function normalizeCourse(c) {
  const tees = (c.course_tees ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((t) => ({
      id: t.id,
      label: t.label,
      rating: t.rating,
      slope: t.slope,
      ratingWomen: t.rating_women ?? null,
      slopeWomen: t.slope_women ?? null,
      sortOrder: t.sort_order ?? 0,
      yardages: t.yardages ?? undefined,
    }));
  // Legacy course with no tee rows but a stored course-level slope/rating →
  // synthesize a single unnamed tee so the app shape always has `tees`. It
  // exists only to carry the rating/slope for handicap maths; its label is
  // empty because the course has no real named tees, which keeps tee badges
  // (scorecard, round summary) hidden rather than showing a bogus name.
  const effectiveTees = tees.length > 0
    ? tees
    : (c.slope != null || c.rating != null)
      ? [{ id: `legacy-${c.id}`, label: '', rating: c.rating, slope: c.slope, sortOrder: 0 }]
      : [];
  return {
    id: c.id,
    name: c.name,
    slope: c.slope,    // legacy course-level fields, kept for back-compat reads
    rating: c.rating,
    city: c.city,
    province: c.province,
    clubId: c.club_id ?? null,
    layoutName: c.layout_name ?? null,
    holes: (c.course_holes ?? [])
      .sort((a, b) => a.number - b.number)
      .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index })),
    tees: effectiveTees,
  };
}

// Default 18 holes for a newly created course
export function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
  }));
}
