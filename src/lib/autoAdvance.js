// True when every player has a positive stroke count recorded for the hole.
// Pure — drives the optional auto-advance-hole setting on the scorecard.
export function holeComplete(scores, players, holeNumber) {
  if (!scores || !players?.length) return false;
  return players.every((p) => {
    const v = scores[p.id]?.[holeNumber];
    return typeof v === 'number' && v > 0;
  });
}
