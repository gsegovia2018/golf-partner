// True when every player has a positive stroke count recorded for the hole.
// Pure — drives the optional auto-advance-hole setting on the scorecard.
export function holeComplete(scores, players, holeNumber) {
  if (!scores || !players?.length) return false;
  return players.every((p) => {
    const v = scores[p.id]?.[holeNumber];
    return typeof v === 'number' && v > 0;
  });
}

// Decision for a single score write against the pending auto-advance timer:
//   'schedule' — the viewed hole just became fully scored; (re)arm the timer.
//   'cancel'   — the viewed hole was edited but the timer should not fire
//                (disabled, last hole, or the hole is no longer complete —
//                e.g. a score was cleared mid-countdown).
//   'ignore'   — the write was for a hole other than the one on screen (a
//                Grid-view edit elsewhere, or a synced remote write); any
//                countdown already pending for the viewed hole must be left
//                alone.
// Pure — testable independent of the screen's timer/ref plumbing.
export function autoAdvanceAction({ enabled, holeNumber, currentHole, maxHole, scores, players }) {
  if (holeNumber !== currentHole) return 'ignore';
  if (!enabled) return 'cancel';
  if (holeNumber >= maxHole) return 'cancel';
  return holeComplete(scores, players, holeNumber) ? 'schedule' : 'cancel';
}
