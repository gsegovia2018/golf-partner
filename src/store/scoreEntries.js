// Per-author score submissions and the conflict state DERIVED from them.
// Local round-blob shapes (mirrors of game_score_entries / game_score_resolutions):
//   round.scoreEntries[playerId][hole]     = { [authorId]: { value, ts } }
//   round.scoreResolutions[playerId][hole] = { value, by, ts }
// Holes are keyed by the plain number (matches the legacy scoreConflicts keying).
// A blank is value == null; it never contributes a conflict candidate.

export function cellEntries(round, playerId, hole) {
  const byAuthor = round?.scoreEntries?.[playerId]?.[hole];
  return byAuthor && typeof byAuthor === 'object' ? byAuthor : {};
}

function cellResolution(round, playerId, hole) {
  const res = round?.scoreResolutions?.[playerId]?.[hole];
  return res && typeof res === 'object' && 'value' in res ? res : null;
}

// { status, effective, candidates, blankAuthors }
export function deriveCell(round, playerId, hole) {
  const byAuthor = cellEntries(round, playerId, hole);
  const authorIds = Object.keys(byAuthor);

  const nonBlank = authorIds
    .map((authorId) => ({ authorId, ...byAuthor[authorId] }))
    .filter((e) => e.value != null);
  const blankAuthors = authorIds.filter((a) => byAuthor[a]?.value == null);

  const maxEntryTs = authorIds.reduce((m, a) => Math.max(m, byAuthor[a]?.ts ?? 0), 0);
  const resolution = cellResolution(round, playerId, hole);
  const resolvedValid = resolution && (resolution.ts ?? 0) >= maxEntryTs && authorIds.length > 0;

  // One candidate per distinct non-null value: the most-recent author of that value.
  const byValue = new Map();
  for (const e of nonBlank) {
    const prev = byValue.get(e.value);
    if (!prev || e.ts > prev.ts) byValue.set(e.value, { value: e.value, ts: e.ts, authorId: e.authorId });
  }
  const candidates = [...byValue.values()].sort((a, b) => a.ts - b.ts);

  if (resolvedValid) {
    return { status: 'resolved', effective: resolution.value, candidates, blankAuthors };
  }
  if (nonBlank.length === 0) {
    return { status: 'empty', effective: null, candidates: [], blankAuthors };
  }
  if (candidates.length === 1) {
    return { status: 'agreed', effective: candidates[0].value, candidates, blankAuthors };
  }
  const mostRecent = nonBlank.reduce((a, b) => (b.ts > a.ts ? b : a));
  return { status: 'conflict', effective: mostRecent.value, candidates, blankAuthors };
}

export function activeAuthors(round) {
  const out = new Set();
  const byPlayer = round?.scoreEntries;
  if (!byPlayer || typeof byPlayer !== 'object') return out;
  for (const byHole of Object.values(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const byAuthor of Object.values(byHole)) {
      if (byAuthor && typeof byAuthor === 'object') {
        for (const a of Object.keys(byAuthor)) out.add(a);
      }
    }
  }
  return out;
}

export function listRoundConflicts(round) {
  const byPlayer = round?.scoreEntries;
  if (!byPlayer || typeof byPlayer !== 'object') return [];
  const out = [];
  for (const [playerId, byHole] of Object.entries(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const holeKey of Object.keys(byHole)) {
      const hole = Number(holeKey);
      if (deriveCell(round, playerId, hole).status === 'conflict') out.push({ playerId, hole });
    }
  }
  return out.sort((a, b) => a.hole - b.hole);
}

export function roundHasConflicts(round) {
  return listRoundConflicts(round).length > 0;
}

export function authorProgress(round, presence = {}) {
  const progress = {};
  for (const a of activeAuthors(round)) progress[a] = presence[a] ?? 0;
  const byPlayer = round?.scoreEntries ?? {};
  for (const byHole of Object.values(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const [holeKey, byAuthor] of Object.entries(byHole)) {
      const hole = Number(holeKey);
      for (const [authorId, entry] of Object.entries(byAuthor ?? {})) {
        if (entry?.value != null && hole > (progress[authorId] ?? 0)) progress[authorId] = hole;
      }
    }
  }
  for (const [authorId, cur] of Object.entries(presence)) {
    if (cur > (progress[authorId] ?? 0)) progress[authorId] = cur;
  }
  return progress;
}

export function isCellSurfaceable(round, hole, progress) {
  const authors = [...activeAuthors(round)];
  if (authors.length === 0) return false;
  return authors.every((a) => (progress?.[a] ?? 0) > hole);
}

export function surfaceableConflicts(round, presence = {}) {
  const progress = authorProgress(round, presence);
  return listRoundConflicts(round).filter((c) => isCellSurfaceable(round, c.hole, progress));
}
