// Tie-aware ("competition ranking") placement for leaderboard boards.
//
// A plain array index (i + 1) as "rank" silently breaks ties: two players
// who compare exactly equal under the board's own comparator still get
// distinct numbers and, in the UI, distinct medal colors — implying an
// order the data doesn't support. Standard competition ranking instead has
// tied players SHARE the place at the top of their tie group, and the next
// distinct player resumes counting at place + groupSize (1,2,2,4 — not
// 1,2,2,3).
//
// This module is pure and mode-agnostic: pass it the board's own comparator
// (the same one it was sorted with) so the tie definition here always
// matches the tie definition the board already sorted by.
import { stablefordComparator, isScrambleMode } from './scoring';

// rows must already be sorted by `comparator`. Returns a new array of
// `{ ...row, place, isTie }`. `place` is the 1-based competition rank;
// `isTie` is true for every member of a group of 2+ rows that compare
// equal (comparator(...) === 0) to each other.
export function assignPlacements(rows, comparator) {
  const n = rows.length;
  if (n === 0) return [];

  const places = new Array(n);
  let place = 1;
  for (let i = 0; i < n; i++) {
    if (i === 0 || comparator(rows[i - 1], rows[i]) !== 0) {
      place = i + 1;
    }
    places[i] = place;
  }

  return rows.map((row, i) => {
    const tiedWithPrev = i > 0 && places[i] === places[i - 1];
    const tiedWithNext = i < n - 1 && places[i] === places[i + 1];
    return { ...row, place: places[i], isTie: tiedWithPrev || tiedWithNext };
  });
}

// The comparator a board's entries were sorted with, keyed by board mode —
// mirrors the sort each producer in tournamentStore.js/scoring.js already
// uses, so assignPlacements' tie definition matches the board's own order.
// "stableford", "bestball" and the scramble* modes all tiebreak on fewer
// gross strokes (stablefordComparator) — every other mode (matchplay,
// sindicato, pairsmatchplay) has no strokes tiebreak wired into its
// producer yet, so those still sort purely on points.
export function comparatorForBoardMode(mode) {
  if (mode === 'stableford' || mode === 'bestball' || isScrambleMode(mode)) return stablefordComparator;
  return (a, b) => b.points - a.points;
}
