// Derives a per-id "last used" timestamp from the local tournaments index
// (store/tournamentsIndex.js rows: createdAt + playerIds / courseIds).
// Consumed by the player and course pickers to float recent entries to the
// top without a network call or extra server-side state.

function parseTime(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function buildLastUsed(rows, idsOf) {
  const out = {};
  for (const row of rows ?? []) {
    const ts = parseTime(row.createdAt);
    for (const id of idsOf(row) ?? []) {
      if ((out[id] ?? 0) < ts) out[id] = ts;
    }
  }
  return out;
}

export function buildPlayerLastUsed(indexRows) {
  return buildLastUsed(indexRows, (row) => row.playerIds);
}

export function buildCourseLastUsed(indexRows) {
  return buildLastUsed(indexRows, (row) => row.courseIds);
}
