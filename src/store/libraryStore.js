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
// (created_by = me) plus every friend's app-user row. Signed-out → [].
export async function fetchMyPlayers() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const friendIds = await myFriendIds();
  const userIds = [user.id, ...friendIds].filter(Boolean);
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
    .select('*, course_holes(*)')
    .order('name');
  if (error) throw error;
  return data.map(normalizeCourse);
}

export async function upsertCourse({ id, name, slope, rating, city, province }) {
  const row = {
    name,
    slope: slope ? parseInt(slope, 10) : null,
    rating: rating ? parseFloat(rating) : null,
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

// Called from CourseEditorScreen to sync slope+rating+holes back to the library
export async function updateCourseFromEditor(courseId, slope, rating, holes) {
  const { error } = await supabase
    .from('courses')
    .update({
      slope: slope ? parseInt(slope, 10) : null,
      rating: rating ? parseFloat(rating) : null,
    })
    .eq('id', courseId);
  if (error) throw error;
  await saveCourseHoles(courseId, holes);
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
  return {
    id: c.id,
    name: c.name,
    slope: c.slope,
    rating: c.rating,
    city: c.city,
    province: c.province,
    holes: (c.course_holes ?? [])
      .sort((a, b) => a.number - b.number)
      .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index })),
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
