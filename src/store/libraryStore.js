import { supabase } from '../lib/supabase';

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

// Called from CourseEditorScreen to sync slope+holes back to the library
export async function updateCourseFromEditor(courseId, slope, holes) {
  const { error } = await supabase
    .from('courses')
    .update({ slope: slope ? parseInt(slope, 10) : null })
    .eq('id', courseId);
  if (error) throw error;
  await saveCourseHoles(courseId, holes);
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
