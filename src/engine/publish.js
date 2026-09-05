// Writes against the card model: publishing a hole, recording an agreement,
// and naming the scorer. PURE — every function returns a new value and never
// mutates its input.

const key = (hole) => String(hole);

/** A card nobody has scored on yet. */
export function emptyCard() {
  return { scorer: { playerId: null, userId: null }, holes: {} };
}

/** Stamp the card with the identity this device scores under. */
export function identifyScorer(card, { playerId = null, userId = null } = {}) {
  const base = card ?? emptyCard();
  return { ...base, scorer: { playerId, userId }, holes: { ...(base.holes ?? {}) } };
}

/**
 * Publish one hole as a single packet (R7): the whole hole or nothing. The
 * hole's version counter increments on every publication, which is what a
 * resolution basis is anchored to. Blanks are dropped — not marking a player
 * is not an opinion. Publishing nothing onto a hole that was never published
 * is a no-op; clearing a hole that WAS published publishes the empty hole.
 */
export function publishHole(card, hole, draftHole, ts) {
  const base = card ?? emptyCard();
  const h = key(hole);
  const prev = base.holes?.[h] ?? null;

  const entries = {};
  for (const [playerId, value] of Object.entries(draftHole?.entries ?? {})) {
    if (Number.isFinite(value)) entries[playerId] = value;
  }
  const shots = draftHole?.shots && Object.keys(draftHole.shots).length
    ? { ...draftHole.shots }
    : null;
  // Nothing to say and nothing said before: no version. Shot detail alone
  // (a logged drive, no score yet) is still worth a version — it is the
  // player's own record and must not be lost when they leave the hole.
  if (Object.keys(entries).length === 0 && !shots && !prev) return base;

  const next = { v: (prev?.v ?? 0) + 1, entries, ts };
  if (shots) next.shots = shots;

  return { ...base, holes: { ...(base.holes ?? {}), [h]: next } };
}

/**
 * Record an agreement, anchored to the card versions of every author who
 * currently marks the cell (per device, so two devices of one scorer both
 * anchor). Throws when nobody marks it — there is nothing to agree about.
 */
export function makeResolution(ctx, { roundId, playerId, hole, value, by, ts }) {
  const h = key(hole);
  const basis = {};
  for (const [authorId, card] of Object.entries(ctx?.cardsByAuthor ?? {})) {
    const holeEntry = card?.holes?.[h];
    if (!holeEntry || !Number.isFinite(holeEntry.entries?.[playerId])) continue;
    basis[authorId] = holeEntry.v;
  }
  if (Object.keys(basis).length === 0) {
    throw new Error(`No card marks player ${playerId} on hole ${h}; nothing to resolve`);
  }
  return { roundId, playerId, hole, value, by, ts, basis };
}
