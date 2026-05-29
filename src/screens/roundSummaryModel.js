function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function scoreValue(scores, playerId, holeNumber) {
  const value = scores?.[playerId]?.[holeNumber];
  return value == null ? null : value;
}

function scoreTotal(scores) {
  return scores.reduce((sum, value) => (
    Number.isFinite(Number(value)) ? sum + Number(value) : sum
  ), 0);
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

export function buildScorecardSections({ round, ranked } = {}) {
  const holes = asArray(round?.holes);
  const rows = asArray(ranked);
  const scores = round?.scores ?? {};
  const sectionDefs = [
    { label: 'Front', holes: holes.slice(0, 9) },
    { label: 'Back', holes: holes.slice(9, 18) },
  ];

  return sectionDefs
    .filter((section) => section.holes.length > 0)
    .map((section) => ({
      ...section,
      parTotal: section.holes.reduce((sum, hole) => sum + (Number(hole?.par) || 0), 0),
      playerRows: rows.map((entry) => {
        const playerId = entry?.player?.id;
        const playerScores = section.holes.map((hole) => scoreValue(scores, playerId, hole?.number));

        return {
          playerId: playerId ?? null,
          name: entry?.player?.name ?? '',
          scores: playerScores,
          total: scoreTotal(playerScores),
        };
      }),
    }));
}
