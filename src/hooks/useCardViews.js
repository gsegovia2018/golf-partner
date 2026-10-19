// The card engine's derived views for one round: every cell (mine / peers' /
// agreed / disputed), the scores my phone shows, the ghost labels, the
// disputed cells and holes, and my shot detail. Pure memos over the cards
// state from useRoundCards (see engine/cards.js).
import { useMemo } from 'react';
import {
  discrepancies, roundCells, scorerKeyOf, shownScores, unverifiedCells,
} from '../engine/cards';
import { t as tNow } from '../i18n';

// Stable identity for official mode, which never fills it in.
const EMPTY_SHOT_DETAILS = {};

export function useCardViews({ cardState, players, round, official, viewOnly }) {
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const holeNumbers = useMemo(() => (round?.holes ?? []).map((h) => h.number), [round]);
  // scorerKey → display name, for "who said what" in the discrepancy sheet.
  // A card names the roster player it scores as; anything else is a phone we
  // cannot put a name to (plan §3.1).
  const names = useMemo(() => {
    const out = {};
    for (const [authorIdKey, card] of Object.entries(cardState.cardsByAuthor)) {
      const scorerKey = scorerKeyOf(card, authorIdKey);
      const player = players.find((p) => p.id === card?.scorer?.playerId);
      out[scorerKey] = player?.name ?? tNow('scorecard.conflict.anotherPhone');
    }
    return out;
  }, [cardState.cardsByAuthor, players]);
  const ctx = useMemo(() => ({ ...cardState, names }), [cardState, names]);
  // The identity my own card scores under: the signed-in user if known, else
  // this device. The wizard renders it as "You".
  const myScorerKey = useMemo(
    () => scorerKeyOf(cardState.cardsByAuthor[cardState.myAuthorId], cardState.myAuthorId),
    [cardState.cardsByAuthor, cardState.myAuthorId],
  );
  const localAuthorIds = useMemo(() => [myScorerKey].filter(Boolean), [myScorerKey]);

  const cells = useMemo(
    () => roundCells(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  // What MY phone counts in every mode (R6): my draft, then my published
  // entry, then a peer's — see cards.js `shown`.
  const cardScores = useMemo(
    () => shownScores(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  // Cells only a peer has marked. They render as a greyed ghost with the
  // scorer's name, never as a value of mine (R3).
  const unverified = useMemo(
    () => unverifiedCells(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  const disputes = useMemo(
    () => discrepancies(ctx, playerIds, holeNumbers),
    [ctx, playerIds, holeNumbers],
  );
  // The card as I have marked it: `shown` minus the cells only a peer marked.
  // This is what the hole pages render and what score entry steps from, so a
  // peer's value can never pre-fill a cell I still owe.
  const myScores = useMemo(() => {
    // Official has its own self/marker model, and a view-only round is being
    // read, not scored — both keep the merged card with no ghosting.
    if (official || viewOnly) return null;
    const out = {};
    for (const [playerId, byHole] of Object.entries(cells)) {
      for (const [h, cell] of Object.entries(byHole)) {
        if (cell.shown == null || cell.status === 'unverified') continue;
        if (!out[playerId]) out[playerId] = {};
        out[playerId][h] = cell.shown;
      }
    }
    return out;
  }, [official, viewOnly, cells]);
  // Ghost labels, `{ [playerId]: { [hole]: scorerName } }`, alongside the
  // ghost values the hole page reads out of `scores`.
  const ghostAuthors = useMemo(() => {
    const out = {};
    for (const { playerId, hole, scorerKey } of unverified) {
      if (!out[playerId]) out[playerId] = {};
      out[playerId][String(hole)] = names[scorerKey] ?? tNow('scorecard.conflict.anotherPhone');
    }
    return out;
  }, [unverified, names]);
  // Disputed cells and holes. Both are memoised on a content signature, not
  // on `disputes`, so an unrelated tap does not hand every hole page a fresh
  // Set and re-render all 18 of them (see holePagePropsEqual).
  const disputeSignature = disputes
    .map(({ hole, rows }) => rows.map((r) => `${r.playerId}:${hole}`).join(','))
    .join('|');
  const conflictCells = useMemo(
    () => new Set(disputeSignature ? disputeSignature.split(/[|,]/) : []),
    [disputeSignature],
  );
  const conflictHoles = useMemo(
    () => new Set([...conflictCells].map((k) => Number(k.split(':')[1]))),
    [conflictCells],
  );
  // Shot detail for my card: what I published, with the hole I am on
  // overlaid from the draft. Keyed by player like `scores` for generality,
  // though in practice only "me" has entries.
  const shotDetails = useMemo(() => {
    if (official) return EMPTY_SHOT_DETAILS;
    const out = {};
    const put = (h, playerId, detail) => {
      if (detail == null) return;
      if (!out[playerId]) out[playerId] = {};
      out[playerId][h] = detail;
    };
    const myCard = cardState.cardsByAuthor[cardState.myAuthorId];
    for (const [h, holeEntry] of Object.entries(myCard?.holes ?? {})) {
      for (const [playerId, detail] of Object.entries(holeEntry.shots ?? {})) put(h, playerId, detail);
    }
    for (const [h, holeDraft] of Object.entries(cardState.draft ?? {})) {
      for (const [playerId, detail] of Object.entries(holeDraft.shots ?? {})) put(h, playerId, detail);
    }
    return out;
  }, [official, cardState.cardsByAuthor, cardState.myAuthorId, cardState.draft]);

  return {
    playerIds, holeNumbers, names, localAuthorIds, cells, cardScores,
    disputes, myScores, ghostAuthors, conflictCells, conflictHoles, shotDetails,
  };
}
