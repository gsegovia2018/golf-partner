import { supabase } from '../lib/supabase';
import { listFriends, getCachedFriends } from './friendStore';

// ── Players ──────────────────────────────────────────────────────────────────

export async function fetchPlayers() {
  // `*` already includes avatar_url + user_id (added by later migrations);
  // kept explicit to signal downstream consumers what to rely on.
  const { data, error } = await supabase
    .from('players')
    .select('id, name, handicap, user_id, avatar_url, created_at')
    .order('name');
  if (error) throw error;
  return data;
}

// Columns every player consumer relies on. Shared by the scoped readers below.
const PLAYER_COLUMNS = 'id, name, handicap, user_id, avatar_url, created_at, created_by';

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

export async function upsertPlayer({ id, name, handicap }) {
  const row = { name, handicap: parseInt(handicap, 10) || 0 };
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

export async function fetchCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*, course_holes(*), course_tees(*)')
    .order('name');
  if (error) throw error;
  return data.map(normalizeCourse);
}

export async function upsertCourse({ id, name, city, province }) {
  const row = {
    name,
    city: city?.trim() || null,
    province: province?.trim() || null,
  };
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

export async function fetchFavoriteCourseIds() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('favorite_courses')
    .select('course_id')
    .eq('user_id', user.id);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.course_id));
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
      sortOrder: t.sort_order ?? 0,
      yardages: t.yardages ?? undefined,
    }));
  // Legacy course with no tee rows but a stored course-level slope/rating →
  // synthesize a single Default tee so the app shape always has `tees`.
  const effectiveTees = tees.length > 0
    ? tees
    : (c.slope != null || c.rating != null)
      ? [{ id: `legacy-${c.id}`, label: 'Default', rating: c.rating, slope: c.slope, sortOrder: 0 }]
      : [];
  return {
    id: c.id,
    name: c.name,
    slope: c.slope,    // legacy course-level fields, kept for back-compat reads
    rating: c.rating,
    city: c.city,
    province: c.province,
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
