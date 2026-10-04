// The December Final (plan docs/superpowers/plans/2026-10-04-league.md §9 P12,
// D6): a normal Stableford tournament where each player's playing handicap is
// raised by extra strokes the admin sets from the final standings. Pure
// helpers, no I/O.
import { deriveRoundPlayingHandicap } from './scoring';

export const MAX_FINAL_STROKES = 10;

export function clampFinalStrokes(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(MAX_FINAL_STROKES, v));
}

// Suggested extra strokes per user id from seasonTable rows (in order): 1st
// place 0, each lower place one more than the place above, capped at 10. Tied
// members share a place, so they share the strokes. Without cards yet there
// are no places: rows fall back to their position.
export function suggestFinalStrokes(table) {
  const out = {};
  let rank = -1;
  let lastPlace;
  (table ?? []).forEach((row, i) => {
    const place = row.place ?? i + 1;
    if (place !== lastPlace) { rank += 1; lastPlace = place; }
    out[row.userId] = clampFinalStrokes(rank);
  });
  return out;
}

// Players with extra strokes, for the Setup note: [{ player, extra }].
export function finalStrokeList(players, strokesByUserId) {
  return (players ?? [])
    .map((player) => ({ player, extra: clampFinalStrokes(strokesByUserId?.[player.user_id]) }))
    .filter((r) => r.extra > 0);
}

// Round 0 with each player's playing handicap raised by their extra strokes.
// `round.playerHandicaps` is what Setup already computed (tee-derived, or an
// edit from the Tees step); it is derived here only when missing. Raised
// players are flagged manual so later recomputes keep the strokes.
export function applyFinalStrokes(round, players, strokesByUserId) {
  const playerHandicaps = { ...(round.playerHandicaps ?? {}) };
  const manualHandicaps = { ...(round.manualHandicaps ?? {}) };
  for (const { player, extra } of finalStrokeList(players, strokesByUserId)) {
    const base = playerHandicaps[player.id] ?? deriveRoundPlayingHandicap(player.handicap, round, player.id);
    playerHandicaps[player.id] = Number(base) + extra;
    manualHandicaps[player.id] = true;
  }
  return { ...round, playerHandicaps, manualHandicaps };
}

// What record_league_final stores: extra strokes by user id for everyone in
// the tournament who has an account (zeros included).
export function finalStrokesRecord(players, strokesByUserId) {
  return Object.fromEntries(
    (players ?? []).filter((p) => p.user_id)
      .map((p) => [p.user_id, clampFinalStrokes(strokesByUserId?.[p.user_id])]),
  );
}
