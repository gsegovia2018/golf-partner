// The write side of the card store (plan §3, §4): drafting, publishing,
// agreeing, and naming the scorer.
//
// Every action persists first, then updates the in-memory snapshot, then asks
// the replicator to push. Nothing here waits on the network — an action is
// complete for the user the moment it is on disk (R5, R8).

import { getDeviceAuthorId } from '../../store/deviceId';
import { scorerKeyOf } from '../cards';
import {
  emptyCard,
  identifyScorer,
  makeResolution,
  publishHole as enginePublishHole,
} from '../publish';
import { schedulePush } from './replicator';
import { applyRound, getRoundState, knownRounds, loadRound } from './roundState';
import { getCardStorage } from './storage';

const key = (hole) => String(hole);

// Keep `meta.rounds` (the index pushAll walks) in step with the rounds this
// device has actually written to.
function withRound(meta, roundId) {
  if (meta.rounds?.includes(roundId)) return meta;
  return { ...meta, rounds: [...(meta.rounds ?? []), roundId] };
}

async function mutateDraft(tid, roundId, hole, mutate) {
  const store = getCardStorage();
  const h = key(hole);
  const roundDraft = await store.withTid(tid, async () => {
    const drafts = await store.getDraft(tid);
    const round = { ...(drafts[roundId] ?? {}) };
    const prev = round[h] ?? {};
    round[h] = mutate({
      ...prev,
      entries: { ...(prev.entries ?? {}) },
      ...(prev.shots ? { shots: { ...prev.shots } } : {}),
    });
    await store.setDraft(tid, { ...drafts, [roundId]: round });
    return round;
  });
  applyRound(tid, roundId, { draft: roundDraft });
  return roundDraft;
}

/**
 * Record one private entry for the hole I am on. `value` is a stroke count, or
 * null to clear the cell — a cleared draft is still an opinion ("I withdrew
 * mine") and is distinct from never having touched the cell. Never sent (R1,
 * R2).
 */
export async function setDraftEntry(tid, roundId, hole, playerId, value) {
  await loadRound(tid, roundId);
  return mutateDraft(tid, roundId, hole, (holeDraft) => {
    holeDraft.entries[playerId] = Number.isFinite(value) ? value : null;
    return holeDraft;
  });
}

/** Shot detail (club, distance, …) for one player on the hole I am on. */
export async function setDraftShot(tid, roundId, hole, playerId, detail) {
  await loadRound(tid, roundId);
  return mutateDraft(tid, roundId, hole, (holeDraft) => {
    const shots = { ...(holeDraft.shots ?? {}) };
    if (detail == null) delete shots[playerId];
    else shots[playerId] = detail;
    if (Object.keys(shots).length) holeDraft.shots = shots;
    else delete holeDraft.shots;
    return holeDraft;
  });
}

/**
 * Publish the draft for one hole as a single packet (R7). The whole update of
 * my card row is ONE storage write, so a kill mid-publish leaves either the
 * previous card or the new one — never half a hole.
 *
 * Returns true when a card version was published, false when there was
 * nothing to publish: no draft at all, or a draft that is entirely blank on a
 * hole that was never published (a blank is not an opinion, so there is no
 * empty version worth pushing).
 */
export async function publishHole(tid, roundId, hole, now = Date.now()) {
  await loadRound(tid, roundId);
  const store = getCardStorage();
  const h = key(hole);

  const outcome = await store.withTid(tid, async () => {
    const drafts = await store.getDraft(tid);
    const holeDraft = drafts[roundId]?.[h];
    if (!holeDraft) return null;

    const meta = await store.getMeta(tid);
    const mine = await store.getMine(tid, roundId);
    const base = mine?.card ?? identifyScorer(emptyCard(), meta.scorer ?? {});
    const next = enginePublishHole(base, h, holeDraft, now);

    // Consume the draft either way: the scorer has left the hole.
    const round = { ...(drafts[roundId] ?? {}) };
    delete round[h];
    await store.setDraft(tid, { ...drafts, [roundId]: round });

    if (!next.holes?.[h]) return { published: false, draft: round };

    await store.setMine(tid, roundId, { card: next, pending: true });
    await store.setMeta(tid, withRound(meta, roundId));
    return { published: true, draft: round, card: next };
  });

  if (!outcome) return false;
  if (!outcome.published) {
    applyRound(tid, roundId, { draft: outcome.draft });
    return false;
  }

  await getCardStorage().addPendingTid(tid);
  applyRound(tid, roundId, { draft: outcome.draft, myCard: outcome.card, minePending: true });
  schedulePush();
  return true;
}

/**
 * Agree a cell. The resolution is anchored to the card versions of every
 * author who currently marks it, so it lapses the moment any of them
 * re-publishes the hole (plan §3.3). Throws when nobody marks the cell.
 */
export async function resolve(tid, roundId, { playerId, hole, value, now = Date.now() }) {
  await loadRound(tid, roundId);
  const state = getRoundState(tid, roundId);
  const myAuthorId = getDeviceAuthorId();
  const by = scorerKeyOf(state.cardsByAuthor[myAuthorId], myAuthorId);
  const resolution = makeResolution(state, { roundId, playerId, hole, value, by, ts: now });

  const store = getCardStorage();
  const h = key(hole);
  const forRound = await store.withTid(tid, async () => {
    const all = await store.getResolutions(tid);
    const round = { ...(all[roundId] ?? {}) };
    round[playerId] = { ...(round[playerId] ?? {}), [h]: { ...resolution, pending: true } };
    await store.setResolutions(tid, { ...all, [roundId]: round });
    await store.setMeta(tid, withRound(await store.getMeta(tid), roundId));
    return round;
  });

  await store.addPendingTid(tid);
  applyRound(tid, roundId, { resolutions: forRound });
  schedulePush();
  return resolution;
}

/**
 * Name the scorer this device writes as. Stamped onto every card of mine in
 * this tournament so two devices on one account fold into one scorer
 * (plan §3.1) — each restamped card is a new version of my own row and is
 * pushed like any other.
 */
export async function identify(tid, { playerId = null, userId = null } = {}) {
  const store = getCardStorage();
  const scorer = { playerId, userId };

  const updated = await store.withTid(tid, async () => {
    const meta = await store.getMeta(tid);
    // Idempotent: the screen may call this on every mount. An unchanged
    // scorer must not re-mark every card pending and re-push them all.
    if (meta.scorer?.playerId === scorer.playerId && meta.scorer?.userId === scorer.userId) {
      return [];
    }
    await store.setMeta(tid, { ...meta, scorer });
    const rounds = [...new Set([...(meta.rounds ?? []), ...knownRounds(tid)])];
    const out = [];
    for (const roundId of rounds) {
      const mine = await store.getMine(tid, roundId);
      if (!mine?.card) continue;
      const card = identifyScorer(mine.card, scorer);
      await store.setMine(tid, roundId, { card, pending: true });
      out.push({ roundId, card });
    }
    return out;
  });

  if (updated.length) await store.addPendingTid(tid);
  for (const { roundId, card } of updated) {
    applyRound(tid, roundId, { myCard: card, minePending: true });
  }
  if (updated.length) schedulePush();
  return updated.length;
}
