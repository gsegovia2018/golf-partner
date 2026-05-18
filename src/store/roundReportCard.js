// Per-round personal Report Card.
//
// Pure module: given the user's collected rounds (MyRound[] from
// collectMyRounds) and one round's key, it diffs that round against the
// player's career average and the fixed Stableford benchmark.
//
// All heavy lifting is delegated to computeMyStats — this module only
// selects rounds, diffs the two results, and shapes the output.
// See docs/superpowers/specs/2026-05-19-round-report-card-design.md
import { computeMyStats } from './personalStats';

// Stableford points per hole when a player plays exactly to handicap.
const BENCHMARK = 2.0;

// Verdict from points-per-round delta vs the player's career average.
function verdictFromVsAvg(vsAvg) {
  if (vsAvg >= 6) return 'Standout round';
  if (vsAvg >= 2) return 'Strong round';
  if (vsAvg > -2) return 'Solid round';
  if (vsAvg > -6) return 'Off day';
  return 'Tough day';
}

// Verdict when the player has no prior rounds — judged against the benchmark.
// Tops out at 'Strong round' — 'Standout round' needs a career baseline.
function verdictFromPerHole(perHole) {
  if (perHole >= 2.4) return 'Strong round';
  if (perHole >= 2.0) return 'Solid round';
  if (perHole >= 1.6) return 'Off day';
  return 'Tough day';
}

// Career points-per-hole across every round in `history` (a stats object
// from computeMyStats). Returns null when there is no history or no scored holes.
function careerPerHole(baseStats) {
  if (!baseStats) return null;
  const totals = (baseStats.history || []).reduce(
    (acc, h) => ({ pts: acc.pts + h.points, holes: acc.holes + h.holesPlayed }),
    { pts: 0, holes: 0 },
  );
  return totals.holes > 0 ? totals.pts / totals.holes : null;
}

export function buildRoundReportCard(myRounds, roundKey) {
  const all = myRounds || [];
  const selected = all.find((r) => r.key === roundKey);
  if (!selected) return null;

  // History = every OTHER completed round — the career-average baseline.
  const history = all.filter((r) => r.key !== roundKey && r.completed);
  const hasHistory = history.length > 0;

  const thisStats = computeMyStats([selected]);
  const baseStats = hasHistory ? computeMyStats(history) : null;

  const hist = thisStats.history[0] || { points: 0, strokes: 0, holesPlayed: 0 };
  const points = hist.points;
  const holesPlayed = hist.holesPlayed;
  const perHole = holesPlayed > 0 ? +(points / holesPlayed).toFixed(2) : 0;

  const baseline = careerPerHole(baseStats);
  // vsAvg is a round-sized figure: per-hole delta projected over 18 holes,
  // which keeps it fair for 9-hole and incomplete rounds.
  const vsAvg = baseline != null ? +(((perHole - baseline) * 18)).toFixed(1) : null;

  const verdict = vsAvg != null
    ? verdictFromVsAvg(vsAvg)
    : verdictFromPerHole(perHole);

  return {
    round: {
      key: selected.key,
      courseName: selected.courseName,
      tournamentName: selected.tournamentName,
      tournamentDate: selected.tournamentDate,
      holesPlayed,
      complete: !!selected.completed,
    },
    headline: {
      points,
      perHole,
      vsAvg,
      clearedBenchmark: perHole >= BENCHMARK,
      verdict,
    },
    hasHistory,
  };
}
