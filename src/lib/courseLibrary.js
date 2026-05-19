// Pure helpers that turn the flat `courses` + `clubs` lists into the grouped,
// sorted, searchable item list the course picker renders. No I/O, no React —
// unit-tested in isolation.
//
// An "item" is one of:
//   { kind: 'course', course }                 — standalone or single-layout
//   { kind: 'club', club, layouts: course[] }   — a club with 2+ layouts

// Lowercase + strip diacritics, for accent-insensitive search/sort.
export function normalizeText(value) {
  return (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Sort key for a course: favorites first, then most-recently-used, then name.
function courseSortKey(course, favorites, lastUsed) {
  return {
    fav: favorites.has(course.id) ? 0 : 1,
    used: lastUsed[course.id] ?? 0,
    name: normalizeText(course.name),
  };
}

function compareKeys(a, b) {
  if (a.fav !== b.fav) return a.fav - b.fav;
  if (a.used !== b.used) return b.used - a.used;
  return a.name.localeCompare(b.name);
}

// Group courses under their clubs. A club with one layout, an orphan course
// (clubId with no matching club), and any standalone course all become plain
// course items. `favorites` is a Set of favorited course ids; `lastUsed` maps
// course id → timestamp.
export function buildCourseLibraryItems(courses, clubs, favorites = new Set(), lastUsed = {}) {
  const byClub = new Map();
  const standalone = [];
  for (const course of courses) {
    if (course.clubId) {
      if (!byClub.has(course.clubId)) byClub.set(course.clubId, []);
      byClub.get(course.clubId).push(course);
    } else {
      standalone.push(course);
    }
  }

  const items = standalone.map((course) => ({ kind: 'course', course }));

  const knownClubIds = new Set();
  for (const club of clubs) {
    knownClubIds.add(club.id);
    const layouts = byClub.get(club.id) ?? [];
    if (layouts.length === 0) continue;            // empty club — nothing to show
    if (layouts.length === 1) {
      items.push({ kind: 'course', course: layouts[0] });
      continue;
    }
    layouts.sort((a, b) =>
      compareKeys(courseSortKey(a, favorites, lastUsed),
                  courseSortKey(b, favorites, lastUsed)));
    items.push({ kind: 'club', club, layouts });
  }

  // Orphan courses (clubId set, club not in `clubs`) — keep them visible.
  for (const [clubId, layouts] of byClub) {
    if (knownClubIds.has(clubId)) continue;
    for (const course of layouts) items.push({ kind: 'course', course });
  }

  // Top-level sort. A club is never favorite-first; it uses the most recent
  // of its layouts so a recently-played club still floats up.
  const itemKey = (item) => {
    if (item.kind === 'course') return courseSortKey(item.course, favorites, lastUsed);
    const used = item.layouts.reduce((m, c) => Math.max(m, lastUsed[c.id] ?? 0), 0);
    return { fav: 1, used, name: normalizeText(item.club.name) };
  };
  items.sort((a, b) => compareKeys(itemKey(a), itemKey(b)));
  return items;
}

// Filter built items by a search query. Matches club name, layout/course name,
// city and province. A club whose name matches keeps all layouts; otherwise
// only its matching layouts are kept. Empty query returns the input unchanged.
export function filterCourseLibraryItems(items, query) {
  const q = normalizeText(query);
  if (!q) return items;
  const courseMatches = (c) =>
    normalizeText(c.name).includes(q) ||
    normalizeText(c.layoutName).includes(q) ||
    normalizeText(c.city).includes(q) ||
    normalizeText(c.province).includes(q);
  const out = [];
  for (const item of items) {
    if (item.kind === 'course') {
      if (courseMatches(item.course)) out.push(item);
      continue;
    }
    const clubHit =
      normalizeText(item.club.name).includes(q) ||
      normalizeText(item.club.city).includes(q) ||
      normalizeText(item.club.province).includes(q);
    if (clubHit) { out.push(item); continue; }
    const layouts = item.layouts.filter(courseMatches);
    if (layouts.length) out.push({ ...item, layouts });
  }
  return out;
}
