// Per-author score submissions and the conflict state DERIVED from them.
// Local round-blob shapes (mirrors of game_score_entries / game_score_resolutions):
//   round.scoreEntries[playerId][hole]     = { [authorId]: { value, ts } }
//   round.scoreResolutions[playerId][hole] = { value, by, ts }
// Holes are keyed by the plain number.
// A blank is value == null; it never contributes a conflict candidate.

export function cellEntries(round, playerId, hole) {
  const byAuthor = round?.scoreEntries?.[playerId]?.[hole];
  return byAuthor && typeof byAuthor === 'object' ? byAuthor : {};
}

// One physical phone can stamp entries under more than one author id: the
// roster meId once identity is known, and the persisted device author id
// before/without one (ScorecardScreen's `meId ?? getDeviceAuthorId()`
// fallback). Those are the same person — they must never be able to
// disagree with themselves. `localAuthorIds` (ordered, meId first) names
// every id THIS phone may have written; when a cell holds entries from two
// or more of them, only the newest survives (ties keep the earlier-listed
// id, i.e. meId). Entries from ids not in the list — genuinely other
// phones — pass through untouched.
function foldLocalEntries(byAuthor, localAuthorIds) {
  const ids = Array.isArray(localAuthorIds)
    ? localAuthorIds.filter(Boolean)
    : localAuthorIds ? [localAuthorIds] : [];
  const mine = ids.filter((a) => byAuthor[a] !== undefined);
  if (mine.length < 2) return byAuthor;
  let keep = mine[0];
  for (const a of mine) {
    if ((byAuthor[a]?.ts ?? 0) > (byAuthor[keep]?.ts ?? 0)) keep = a;
  }
  const out = {};
  for (const [a, e] of Object.entries(byAuthor)) {
    if (a === keep || !mine.includes(a)) out[a] = e;
  }
  return out;
}

function cellResolution(round, playerId, hole) {
  const res = round?.scoreResolutions?.[playerId]?.[hole];
  return res && typeof res === 'object' && 'value' in res ? res : null;
}

// { status, effective, candidates, blankAuthors }
// `localAuthorIds` (optional) folds this phone's identities into one author
// before deriving — see foldLocalEntries. Omitting it keeps the raw view.
export function deriveCell(round, playerId, hole, localAuthorIds = null) {
  const byAuthor = foldLocalEntries(cellEntries(round, playerId, hole), localAuthorIds);
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

// The card as ONE author has marked it: only cells that author wrote (per
// scoreEntries), overlaid with still-dirty local optimistic edits — which are
// by definition the local author's, since remote values only arrive via
// reload. Peers' entries never appear here; the hole entry view shows this so
// every marker records every player's score themselves, and the leave-hole
// verification compares the resulting cards.
// `authorId` may be a single id or the ordered localAuthorIds array — every
// id this phone has stamped counts as "mine", with the newest entry winning
// a cell (a device-id entry from before identity resolved is still my mark).
export function authorScores(round, authorId, localScores = {}, dirtyKeys = new Set()) {
  const ids = (Array.isArray(authorId) ? authorId : [authorId]).filter(Boolean);
  const out = {};
  const byPlayer = round?.scoreEntries ?? {};
  for (const [playerId, byHole] of Object.entries(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const [holeKey, byAuthor] of Object.entries(byHole)) {
      let mine = null;
      for (const a of ids) {
        const e = byAuthor?.[a];
        if (e && (mine == null || (e.ts ?? 0) > (mine.ts ?? 0))) mine = e;
      }
      if (mine?.value != null) {
        if (!out[playerId]) out[playerId] = {};
        out[playerId][holeKey] = mine.value;
      }
    }
  }
  for (const key of dirtyKeys) {
    const [playerId, holeKey] = key.split(':');
    const v = localScores?.[playerId]?.[holeKey];
    if (v != null) {
      if (!out[playerId]) out[playerId] = {};
      out[playerId][holeKey] = v;
    } else if (out[playerId]) {
      // A local clear whose save has not round-tripped — keep it cleared.
      delete out[playerId][holeKey];
    }
  }
  return out;
}

// Disagreements between one author's entries for a hole and every other
// author's, for the leave-hole verification prompt. A cell this author left
// blank never mismatches (they did not mark that player), a blank from a peer
// never mismatches, and a cell with a valid explicit resolution is settled.
// Returns [{ playerId, mine, others: [{ authorId, value }] }].
// `authorId` may be a single id or the ordered localAuthorIds array — an
// entry under ANY of this phone's ids is mine, never an "other".
export function holeEntryMismatches(round, hole, authorId, myScores) {
  const ids = (Array.isArray(authorId) ? authorId : [authorId]).filter(Boolean);
  const out = [];
  for (const playerId of Object.keys(myScores ?? {})) {
    const mine = myScores[playerId]?.[hole];
    if (mine == null) continue;
    if (deriveCell(round, playerId, hole, ids).status === 'resolved') continue;
    const others = Object.entries(cellEntries(round, playerId, hole))
      .filter(([a, e]) => !ids.includes(a) && e?.value != null && e.value !== mine)
      .map(([a, e]) => ({ authorId: a, value: e.value }));
    if (others.length) out.push({ playerId, mine, others });
  }
  return out;
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

export function listRoundConflicts(round, localAuthorIds = null) {
  const byPlayer = round?.scoreEntries;
  if (!byPlayer || typeof byPlayer !== 'object') return [];
  const out = [];
  for (const [playerId, byHole] of Object.entries(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const holeKey of Object.keys(byHole)) {
      const hole = Number(holeKey);
      if (deriveCell(round, playerId, hole, localAuthorIds).status === 'conflict') out.push({ playerId, hole });
    }
  }
  return out.sort((a, b) => a.hole - b.hole);
}

export function roundHasConflicts(round, localAuthorIds = null) {
  return listRoundConflicts(round, localAuthorIds).length > 0;
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

// Authors who wrote at least one entry (any player, any value including a
// blank) on this specific hole.
function authorsOnHole(round, hole) {
  const out = new Set();
  const byPlayer = round?.scoreEntries;
  if (!byPlayer || typeof byPlayer !== 'object') return out;
  for (const byHole of Object.values(byPlayer)) {
    const byAuthor = byHole?.[hole];
    if (byAuthor && typeof byAuthor === 'object') {
      for (const a of Object.keys(byAuthor)) out.add(a);
    }
  }
  return out;
}

// Gated per hole, not round-wide: a hole lights up once every author who
// wrote to THAT hole has moved past it. An author who never touched this
// hole doesn't gate it (they can only ever add a new entry, which folds
// into the conflict when it arrives). An author still on the hole — who may
// be mid-correction — keeps suppressing it, which is the anti-flash guard.
export function isCellSurfaceable(round, hole, progress) {
  const authors = [...authorsOnHole(round, hole)];
  if (authors.length === 0) return false;
  return authors.every((a) => (progress?.[a] ?? 0) > hole);
}

export function surfaceableConflicts(round, presence = {}, localAuthorIds = null) {
  const progress = authorProgress(round, presence);
  return listRoundConflicts(round, localAuthorIds).filter((c) => isCellSurfaceable(round, c.hole, progress));
}
