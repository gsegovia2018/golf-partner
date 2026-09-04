// Derived views over the per-scorer card model (see
// docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md §3).
//
// PURE: no React, no storage, no network, no clock. Every function takes
// plain data and returns plain data.
//
// Shapes (frozen):
//
//   card = {
//     scorer: { playerId: string|null, userId: string|null },
//     holes: { [hole]: { v: number, entries: { [playerId]: number },
//                        shots?: { [playerId]: object }, ts: number } }
//   }
//   cardsByAuthor = { [authorId]: card }          // every author, mine included
//   resolution    = { roundId, playerId, hole, value, by, ts,
//                     basis: { [authorId]: v } }
//   resolutions   = { [playerId]: { [hole]: resolution } }
//   draft         = { [hole]: { entries: { [playerId]: number|null }, shots? } }
//   ctx           = { myAuthorId, cardsByAuthor, resolutions, draft,
//                     names?: { [scorerKey]: string } }
//
// A cell is "marked" by a card when its hole entry holds a finite number for
// that player. A blank is not an opinion: it never conflicts and never counts
// as agreement.
//
// Hole keys are normalised with String(hole) throughout, so callers may pass
// 3 or '3' interchangeably.

const key = (hole) => String(hole);

/** The identity a card scores under: the signed-in user if known, else the device. */
export function scorerKeyOf(card, authorId) {
  return card?.scorer?.userId ?? authorId;
}

/** True when this hole's entries carry a real stroke count for the player. */
export function isMarked(entries, playerId) {
  return Number.isFinite(entries?.[playerId]);
}

// Later of two publications of the same hole by the same scorer: greater ts
// wins, ties broken by the greater version counter.
function isLater(a, b) {
  const at = a?.ts ?? 0;
  const bt = b?.ts ?? 0;
  if (at !== bt) return at > bt;
  return (a?.v ?? 0) > (b?.v ?? 0);
}

/**
 * Collapse cards by scorer: two devices signed into one account are one
 * scorer and can never disagree with themselves. Per hole the later
 * publication wins. `authorIds` is kept so a resolution basis can still be
 * anchored per device.
 * @returns {{ [scorerKey]: { authorIds: string[], holes: object } }}
 */
export function foldScorers(cardsByAuthor) {
  const out = {};
  for (const [authorId, card] of Object.entries(cardsByAuthor ?? {})) {
    if (!card) continue;
    const sk = scorerKeyOf(card, authorId);
    if (!out[sk]) out[sk] = { authorIds: [], holes: {} };
    out[sk].authorIds.push(authorId);
    for (const [holeKey, hole] of Object.entries(card.holes ?? {})) {
      const h = key(holeKey);
      const cur = out[sk].holes[h];
      if (!cur || isLater(hole, cur)) out[sk].holes[h] = hole;
    }
  }
  return out;
}

/**
 * An agreement points at the exact card versions it settled. It is valid iff
 * every author whose card currently marks the cell is in `basis` at the same
 * version. A re-publication (v bump) or a new author marking the cell lapses
 * it; a cell nobody marks any more has nothing to agree about. Basis entries
 * for authors that no longer mark the cell are ignored.
 */
export function isResolutionValid(resolution, cardsByAuthor) {
  if (!resolution) return false;
  const h = key(resolution.hole);
  const basis = resolution.basis ?? {};
  let marking = 0;
  for (const [authorId, card] of Object.entries(cardsByAuthor ?? {})) {
    const hole = card?.holes?.[h];
    if (!hole || !isMarked(hole.entries, resolution.playerId)) continue;
    marking += 1;
    if (basis[authorId] !== hole.v) return false;
  }
  return marking > 0;
}

// One folded snapshot per traversal: folding is O(cards × holes) and would
// otherwise be repeated for every cell.
function contextView(ctx) {
  const cardsByAuthor = ctx?.cardsByAuthor ?? {};
  const myAuthorId = ctx?.myAuthorId ?? null;
  return {
    ctx: ctx ?? {},
    cardsByAuthor,
    myAuthorId,
    folded: foldScorers(cardsByAuthor),
    myScorerKey: scorerKeyOf(cardsByAuthor[myAuthorId], myAuthorId),
  };
}

// Every scorer who marks the cell, mine included, unsorted.
function markersOf(view, playerId, h) {
  const out = [];
  for (const [scorerKey, scorer] of Object.entries(view.folded)) {
    const hole = scorer.holes[h];
    if (!hole || !isMarked(hole.entries, playerId)) continue;
    out.push({ scorerKey, value: hole.entries[playerId], ts: hole.ts ?? 0 });
  }
  return out;
}

function byTsDesc(a, b) {
  if (a.ts !== b.ts) return b.ts - a.ts;
  return a.scorerKey < b.scorerKey ? -1 : a.scorerKey > b.scorerKey ? 1 : 0;
}

function cellFrom(view, playerId, hole) {
  const h = key(hole);
  const markers = markersOf(view, playerId, h);
  const mineMarker = markers.find((m) => m.scorerKey === view.myScorerKey) ?? null;
  const myPublished = mineMarker ? mineMarker.value : null;
  const others = markers.filter((m) => m.scorerKey !== view.myScorerKey).sort(byTsDesc);

  // The draft is my private opinion for the hole I am on. It wins over my
  // published entry on my own screen and is invisible to everyone else.
  const draftHole = view.ctx.draft?.[h];
  let mine = null;
  if (draftHole?.entries && Object.prototype.hasOwnProperty.call(draftHole.entries, playerId)) {
    const dv = draftHole.entries[playerId];
    mine = { value: Number.isFinite(dv) ? dv : null, source: 'draft' };
  } else if (myPublished != null) {
    mine = { value: myPublished, source: 'published' };
  }

  const raw = view.ctx.resolutions?.[playerId]?.[h] ?? null;
  const resolution = raw && isResolutionValid(raw, view.cardsByAuthor) ? raw : null;

  const published = markers.map((m) => m.value);
  const distinct = new Set(published);
  const discrepancy = !resolution && distinct.size >= 2;

  // What renders (R6). A draft value I am typing wins over everything,
  // including a standing agreement — publishing it will lapse that agreement
  // anyway. Otherwise the agreement, then my published entry, then the most
  // recent peer.
  // A cleared draft hides my own published value too: I withdrew my opinion.
  const isDraft = mine?.source === 'draft';
  const shown = isDraft && mine.value != null
    ? mine.value
    : resolution
      ? resolution.value
      : (isDraft ? null : myPublished) ?? others[0]?.value ?? null;

  // Status describes the PUBLISHED state of the cell, except that an unsent
  // draft is reported as 'mine' (pending) rather than as agreed/resolved, so
  // the card never shows a tick next to a number nobody else has seen yet.
  let status;
  if (mine?.source === 'draft' && mine.value != null && (!resolution || mine.value !== resolution.value)) status = 'mine';
  else if (resolution) status = 'resolved';
  else if (discrepancy) status = 'discrepancy';
  else if (mine?.source === 'draft') status = others.length > 0 ? 'unverified' : 'empty'; // cleared, unsent
  else if (myPublished != null) status = others.length > 0 ? 'agreed' : 'mine';
  else if (others.length > 0) status = 'unverified';
  else status = 'empty';

  return { mine, myPublished, others, resolution, shown, status, discrepancy };
}

/** The full view of one cell: mine, the peers', the agreement, and what renders. */
export function cellView(ctx, playerId, hole) {
  return cellFrom(contextView(ctx), playerId, hole);
}

/** cellView for every (player, hole) in the round. */
export function roundCells(ctx, playerIds, holes) {
  const view = contextView(ctx);
  const out = {};
  for (const playerId of playerIds) {
    out[playerId] = {};
    for (const hole of holes) out[playerId][key(hole)] = cellFrom(view, playerId, hole);
  }
  return out;
}

/**
 * What MY phone counts (R6): `shown` per cell, non-null only. Feed this in as
 * `round.scores` to the scoring.js maths to get my points in any mode.
 * Players with nothing shown are omitted.
 */
export function shownScores(ctx, playerIds, holes) {
  const view = contextView(ctx);
  const out = {};
  for (const playerId of playerIds) {
    for (const hole of holes) {
      const { shown } = cellFrom(view, playerId, hole);
      if (shown == null) continue;
      if (!out[playerId]) out[playerId] = {};
      out[playerId][key(hole)] = shown;
    }
  }
  return out;
}

/**
 * What everyone agrees on: a valid resolution, else the value when every
 * scorer who marked the cell (at least one, my draft excluded) said the same.
 * `provisional` flags a round that is not final yet — some cell disagrees, or
 * rests on a single scorer with no agreement recorded.
 */
export function settledScores(ctx, playerIds, holes) {
  const view = contextView(ctx);
  const scores = {};
  let provisional = false;
  for (const playerId of playerIds) {
    for (const hole of holes) {
      const h = key(hole);
      const cell = cellFrom(view, playerId, hole);
      const values = cell.others.map((o) => o.value);
      if (cell.myPublished != null) values.push(cell.myPublished);

      if (cell.discrepancy) provisional = true;
      else if (values.length === 1 && !cell.resolution) provisional = true;

      let value = null;
      if (cell.resolution) value = cell.resolution.value;
      else if (values.length > 0 && new Set(values).size === 1) value = values[0];
      if (value == null) continue;
      if (!scores[playerId]) scores[playerId] = {};
      scores[playerId][h] = value;
    }
  }
  return { scores, provisional };
}

/**
 * Disputed cells grouped by hole for the discrepancy sheet (R4): one row per
 * player, one value per scorer who marked it — mine included — oldest first.
 */
export function discrepancies(ctx, playerIds, holes) {
  const view = contextView(ctx);
  const names = view.ctx.names ?? {};
  const out = [];
  const ordered = [...holes].sort((a, b) => Number(a) - Number(b));
  for (const hole of ordered) {
    const h = key(hole);
    const rows = [];
    for (const playerId of playerIds) {
      const cell = cellFrom(view, playerId, hole);
      if (!cell.discrepancy) continue;
      const values = markersOf(view, playerId, h)
        .map((m) => ({ scorerKey: m.scorerKey, name: names[m.scorerKey] ?? null, value: m.value, ts: m.ts }))
        .sort((a, b) => a.ts - b.ts || (a.scorerKey < b.scorerKey ? -1 : 1));
      rows.push({ playerId, values });
    }
    if (rows.length) out.push({ hole, rows });
  }
  return out;
}

/** Cells only a peer has marked — rendered greyed with the scorer's name (R3). */
export function unverifiedCells(ctx, playerIds, holes) {
  const view = contextView(ctx);
  const out = [];
  for (const hole of [...holes].sort((a, b) => Number(a) - Number(b))) {
    for (const playerId of playerIds) {
      const cell = cellFrom(view, playerId, hole);
      if (cell.status !== 'unverified') continue;
      const top = cell.others[0];
      out.push({ playerId, hole, scorerKey: top.scorerKey, value: top.value });
    }
  }
  return out;
}

/**
 * Cells exactly one scorer marked and nobody agreed on. Listed for
 * information at Finish; they never block it (blank rule).
 */
export function singleScorerCells(ctx, playerIds, holes) {
  const view = contextView(ctx);
  const out = [];
  for (const hole of [...holes].sort((a, b) => Number(a) - Number(b))) {
    for (const playerId of playerIds) {
      const h = key(hole);
      const cell = cellFrom(view, playerId, hole);
      if (cell.resolution) continue;
      const markers = markersOf(view, playerId, h);
      if (markers.length !== 1) continue;
      out.push({ playerId, hole, scorerKey: markers[0].scorerKey, value: markers[0].value });
    }
  }
  return out;
}
