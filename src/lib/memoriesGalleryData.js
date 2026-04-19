// Pure view-model helpers for the Recuerdos screen. No React, no hooks —
// everything is a plain function of (items, tournament). Keeps the screen
// logic cheap to reason about and easy to eyeball.

export function resolveRoundIndex(roundId, rounds) {
  if (!rounds) return -1;
  return rounds.findIndex((r) => r.id === roundId);
}

export function findParForHole(round, holeIndex) {
  if (!round || holeIndex == null) return null;
  return round.holes?.[holeIndex]?.par ?? null;
}

export function deriveHolesWithMedia(items) {
  const set = new Set();
  for (const m of items) {
    if (typeof m.holeIndex === 'number') set.add(m.holeIndex);
  }
  return set;
}

export function deriveMaxHoles(rounds) {
  if (!rounds?.length) return 18;
  return Math.max(...rounds.map((r) => r.holes?.length ?? 18));
}

export function deriveKindCounts(items) {
  let photo = 0;
  let video = 0;
  for (const m of items) {
    if (m.kind === 'photo') photo++;
    else if (m.kind === 'video') video++;
  }
  return { all: items.length, photo, video };
}

// Per-round view model entry: { roundId, roundIndex, courseName, items, cover }.
// Items inside come oldest-first so the stories viewer reads chronologically.
// `cover` is the most recent item (store feeds us newest-first, so it's the
// first item we push before the per-round reverse).
export function deriveRoundEntries(items, rounds) {
  if (!rounds) return [];
  const byId = new Map();
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    byId.set(r.id, {
      roundId: r.id,
      roundIndex: i,
      courseName: r.courseName ?? '',
      items: [],
      cover: null,
    });
  }
  for (const m of items) {
    const entry = byId.get(m.roundId);
    if (!entry) continue;
    if (!entry.cover) entry.cover = m;
    entry.items.push(m);
  }
  for (const entry of byId.values()) entry.items.reverse();
  return rounds.map((r) => byId.get(r.id));
}

export function applyFilters(items, { hole, kind }) {
  return items.filter((m) => {
    if (hole != null && m.holeIndex !== hole) return false;
    if (kind === 'photo' && m.kind !== 'photo') return false;
    if (kind === 'video' && m.kind !== 'video') return false;
    return true;
  });
}
