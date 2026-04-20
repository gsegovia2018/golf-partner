// Derives a per-id "last used" timestamp from the user's visible tournaments.
// Consumed by the player and course pickers to float recent entries to the
// top without persisting extra state server-side.

function parseTime(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function buildPlayerLastUsed(tournaments) {
  const out = {};
  for (const t of tournaments ?? []) {
    const ts = parseTime(t.createdAt);
    for (const p of t.players ?? []) {
      if (!p?.id) continue;
      if ((out[p.id] ?? 0) < ts) out[p.id] = ts;
    }
  }
  return out;
}

export function buildCourseLastUsed(tournaments) {
  const out = {};
  for (const t of tournaments ?? []) {
    const ts = parseTime(t.createdAt);
    for (const r of t.rounds ?? []) {
      if (!r?.courseId) continue;
      if ((out[r.courseId] ?? 0) < ts) out[r.courseId] = ts;
    }
  }
  return out;
}
