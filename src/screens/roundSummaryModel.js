import { classifyHoleResult } from '../components/scorecard/constants';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countPlayedHoles(round) {
  const scores = round?.scores ?? {};
  const holes = asArray(round?.holes);
  const holeNumbers = holes.length
    ? holes.map((hole) => hole?.number)
    : Object.values(scores).flatMap((playerScores) => Object.keys(playerScores ?? {}));

  return new Set(
    holeNumbers.filter((holeNumber) => (
      holeNumber != null
      && Object.values(scores).some((playerScores) => playerScores?.[holeNumber] != null)
    )),
  ).size;
}

export function buildRoundRecap({ round, ranked } = {}) {
  const rows = asArray(ranked);
  const winnerEntry = rows[0] ?? null;
  const runnerUpEntry = rows[1] ?? null;
  const winnerPoints = Number(winnerEntry?.totalPoints) || 0;
  const runnerUpPoints = Number(runnerUpEntry?.totalPoints) || 0;

  return {
    winnerName: winnerEntry?.player?.name ?? '',
    winnerPoints,
    margin: winnerEntry && runnerUpEntry ? Math.max(0, winnerPoints - runnerUpPoints) : 0,
    winnerStrokes: winnerEntry?.totalStrokes ?? 0,
    holesPlayed: countPlayedHoles(round),
    playerCount: rows.length,
  };
}

// Count semantic hole results (same buckets as the scorecard's score-shape
// chips) across every player in the round, for the recap highlights row.
export function buildRoundHighlights({ round } = {}) {
  const counts = { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 };
  const keyByResult = {
    eagle: 'eagles', birdie: 'birdies', par: 'pars', bogey: 'bogeys', double: 'doubles',
  };
  for (const hole of asArray(round?.holes)) {
    for (const playerScores of Object.values(round?.scores ?? {})) {
      const result = classifyHoleResult(hole?.par, playerScores?.[hole?.number]);
      const key = keyByResult[result];
      if (key) counts[key] += 1;
    }
  }
  return counts;
}
