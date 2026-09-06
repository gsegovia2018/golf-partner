// Writes against the card model: publishing a hole, recording an agreement,
// and naming the scorer. PURE — every function returns a new value and never
// mutates its input.

const key = (hole) => String(hole);

// Structural equality over the JSON the card is made of. Key order differs
// freely between a hole read back from storage and one rebuilt from a draft,
// so a stringify comparison would report false changes.
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

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
 *
 * Re-publishing a hole whose entries and shots are unchanged is also a no-op:
 * the version is what an agreement is anchored to, so a scorer merely walking
 * back through a hole must not lapse the agreements made on it (plan §3.3).
 * The unchanged card is returned BY IDENTITY, which is how callers tell "no
 * version was published" from a real publication.
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
  // Same hole, said twice: keep the version (and the ts) it already carries.
  if (prev && deepEqual(prev.entries ?? {}, entries) && deepEqual(prev.shots ?? null, shots)) {
    return base;
  }

  const next = { v: (prev?.v ?? 0) + 1, entries, ts };
  if (shots) next.shots = shots;

  return { ...base, holes: { ...(base.holes ?? {}), [h]: next } };
}

/**
 * Take an agreed value onto MY OWN card, as a new version of that hole.
 *
 * Agreeing to a peer's number and leaving my card saying mine is not a state
 * the model can hold: the screen seeds a revisited hole's draft from my card,
 * so the value I was overruled on would be re-published and the agreement I
 * had just made would lapse (plan §3.3). Adopting it makes the agreement
 * survive the revisit, because leaving the hole then publishes an identical
 * packet and `publishHole` above is a no-op.
 *
 * A card that does not mark the cell is returned UNCHANGED, by identity: a
 * blank is not an opinion and agreeing must never invent one. Same when the
 * card already holds the agreed value — there is nothing to bump.
 */
export function adoptEntry(card, hole, playerId, value, ts) {
  const h = key(hole);
  const prev = card?.holes?.[h];
  if (!prev || !Number.isFinite(prev.entries?.[playerId])) return card ?? null;
  if (prev.entries[playerId] === value) return card;
  return {
    ...card,
    holes: {
      ...card.holes,
      [h]: { ...prev, v: (prev.v ?? 0) + 1, entries: { ...prev.entries, [playerId]: value }, ts },
    },
  };
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
