// Bridge between the flat golf_* tables and the nested course-geometry shape
// that src/lib/geo.js consumes ({ key, name, matchTokens, mode, holes|greens }).
// Pure JS, no imports — used by both the app (courseGeometryStore) and the
// node seed/extract scripts.

const DEFAULT_SOURCE = 'OpenStreetMap (ODbL)';

// A coord point is only usable when both entries are finite numbers. jsonb
// columns often hold [null, null] (a truthy array) rather than SQL NULL —
// letting that through poisons distance math (haversine → NaN). Normalize any
// non-finite point to undefined so callers fall back to the green polygon.
const pt = (v) => (Array.isArray(v) && v.length === 2
  && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? v : undefined);

// Nested course object -> { course, holes, hazards, greens } row arrays for
// upsert into golf_course / golf_hole / golf_hazard / golf_green.
export function flattenCourse(course) {
  const course_id = course.key;
  const courseRow = {
    id: course_id,
    name: course.name,
    mode: course.mode,
    match_tokens: course.matchTokens,
    source: course.source ?? DEFAULT_SOURCE,
  };
  const holes = [];
  const hazards = [];
  const greens = [];

  if (course.mode === 'holes') {
    for (const h of course.holes ?? []) {
      holes.push({
        course_id,
        number: h.number,
        par: h.par ?? null,
        green: h.green ?? null,
        green_center: h.greenCenter ?? null,
        green_front: h.greenFront ?? null,
        green_back: h.greenBack ?? null,
        pin: h.pin ?? null,
        tees: h.tees ?? null,
        start_pt: h.start ?? null,
      });
      (h.hazards ?? []).forEach((hz, i) => {
        hazards.push({ course_id, hole_number: h.number, kind: hz.kind, poly: hz.poly, ordinal: i });
      });
    }
  } else {
    (course.greens ?? []).forEach((poly, i) => {
      greens.push({ course_id, ordinal: i, poly, center: null });
    });
  }
  return { course: courseRow, holes, hazards, greens };
}

// Flat rows (from a Supabase select) -> array of nested course objects.
export function assembleCourses({ courses, holes = [], hazards = [], greens = [] }) {
  const byHole = new Map(); // course_id -> [holeRow]
  for (const h of holes) {
    if (!byHole.has(h.course_id)) byHole.set(h.course_id, []);
    byHole.get(h.course_id).push(h);
  }
  const hazByCourse = new Map(); // course_id -> { holeNumber -> [hz] }
  for (const hz of hazards) {
    if (!hazByCourse.has(hz.course_id)) hazByCourse.set(hz.course_id, new Map());
    const m = hazByCourse.get(hz.course_id);
    if (!m.has(hz.hole_number)) m.set(hz.hole_number, []);
    m.get(hz.hole_number).push(hz);
  }
  const greensByCourse = new Map(); // course_id -> [greenRow]
  for (const g of greens) {
    if (!greensByCourse.has(g.course_id)) greensByCourse.set(g.course_id, []);
    greensByCourse.get(g.course_id).push(g);
  }

  return courses.map((c) => {
    const base = { key: c.id, name: c.name, matchTokens: c.match_tokens, mode: c.mode, source: c.source };
    if (c.mode === 'holes') {
      const hazMap = hazByCourse.get(c.id) ?? new Map();
      const courseHoles = (byHole.get(c.id) ?? [])
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((h) => ({
          number: h.number,
          par: h.par ?? undefined,
          green: h.green ?? undefined,
          greenCenter: pt(h.green_center),
          greenFront: pt(h.green_front),
          greenBack: pt(h.green_back),
          pin: pt(h.pin),
          tees: h.tees ?? undefined,
          start: pt(h.start_pt),
          hazards: (hazMap.get(h.number) ?? [])
            .slice()
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((hz) => ({ kind: hz.kind, poly: hz.poly })),
        }));
      return { ...base, holes: courseHoles };
    }
    const courseGreens = (greensByCourse.get(c.id) ?? [])
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((g) => g.poly);
    return { ...base, greens: courseGreens };
  });
}
