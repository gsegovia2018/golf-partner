// Shared fixture builders for stats-engine / personal-stats / leaderboard
// specs. Mirrors the tournament shape used throughout statsEngine.test.js:
// players `{id, name, handicap}`, rounds with `courseName`, `holes`
// (`{number, par, strokeIndex}`), `scores` (`{playerId: {holeNumber: strokes}}`),
// `playerHandicaps`, optional `pairs`, and an optional per-round
// `scoringMode` override — read via `roundScoringMode` in
// `src/store/scoring.js`, which resolves `round.scoringMode ??
// tournament.settings.scoringMode ?? 'stableford'`.

// 18 holes with a deterministic 4/3/5 par rotation (hole 1 = par 4, hole 2 =
// par 3, hole 3 = par 5, repeating) and strokeIndex == hole number.
export function holes18() {
  const pars = [4, 3, 5];
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: pars[i % pars.length],
    strokeIndex: i + 1,
  }));
}

// Assembles a tournament object in the shape statsEngine/personalStats/
// scoring consume. Only `players`/`rounds` are required — the rest default
// to sane values so callers can pass just `{ players, rounds }`.
export function buildTournament({
  players,
  rounds,
  id = 't-fixture',
  name = 'Fixture Tournament',
  settings = { scoringMode: 'stableford' },
  currentRound,
} = {}) {
  return {
    id,
    name,
    players,
    rounds,
    settings,
    currentRound: currentRound ?? rounds.length - 1,
  };
}

// Fills every hole in `holes` with the same strokes for one player.
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}

// Same as evenScores, but skips `skipHole` (used to punch a deliberate gap
// in an otherwise-complete set of hole scores).
function evenScoresWithGap(holes, strokes, skipHole) {
  const o = {};
  holes.forEach((h) => {
    if (h.number === skipHole) return;
    o[h.number] = strokes;
  });
  return o;
}

// The canonical mixed-mode fixture reused across the stats-audit tasks.
//
// 4 players (handicaps 8/12/18/24). R1 is a fully-scored plain `stableford`
// round. R2 is a `scramblepairs` round — a per-round override of the
// tournament's default `stableford` mode — with pairs [[p1,p2],[p3,p4]] and
// team-ball scores stored ONLY under the two captains, p1 and p3; later
// tasks assert scramble data does not leak into personal-stats aggregation.
// R3 is a normal round scored on the front nine only (holes 10-18
// unscored), with a deliberate gap: player p2 has no score on hole 5.
export function mixedModeTournament() {
  const players = [
    { id: 'p1', name: 'Alice', handicap: 8 },
    { id: 'p2', name: 'Bob', handicap: 12 },
    { id: 'p3', name: 'Cara', handicap: 18 },
    { id: 'p4', name: 'Dan', handicap: 24 },
  ];
  const playerHandicaps = Object.fromEntries(players.map((p) => [p.id, p.handicap]));
  const pairs = [[players[0], players[1]], [players[2], players[3]]];
  const h = holes18();
  const front9 = h.slice(0, 9);

  const round1 = {
    courseName: 'Northwood',
    holes: h,
    playerHandicaps,
    pairs,
    scores: {
      p1: evenScores(h, 4),
      p2: evenScores(h, 4),
      p3: evenScores(h, 4),
      p4: evenScores(h, 4),
    },
  };

  const round2 = {
    courseName: 'Southlinks',
    scoringMode: 'scramblepairs',
    holes: h,
    playerHandicaps,
    pairs,
    scores: {
      p1: evenScores(h, 4), // team p1/p2 ball, stored only under captain p1
      p3: evenScores(h, 5), // team p3/p4 ball, stored only under captain p3
    },
  };

  const round3 = {
    courseName: 'Eastview',
    holes: h,
    playerHandicaps,
    pairs,
    scores: {
      p1: evenScores(front9, 4),
      p2: evenScoresWithGap(front9, 4, 5), // no score recorded on hole 5
      p3: evenScores(front9, 4),
      p4: evenScores(front9, 4),
    },
  };

  return buildTournament({
    id: 't-mixed-mode',
    name: 'Mixed Mode Tournament',
    players,
    rounds: [round1, round2, round3],
  });
}
