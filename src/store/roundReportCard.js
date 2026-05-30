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

// A net-points-per-hole cell needs at least this many holes in the round
// to be callout-eligible — guards against fake insights off tiny samples.
const CALLOUT_MIN_HOLES = 3;

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

function toneFromVerdict(verdict) {
  if (verdict === 'Standout round' || verdict === 'Strong round') return 'good';
  if (verdict === 'Off day' || verdict === 'Tough day') return 'bad';
  return 'neutral';
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

// Build one net-points-per-hole cell. `thisSplit`/`baseSplit` are
// { avgPoints, holes } shaped (parType.parN, difficulty.band, warmup, …).
// Returns null when the round has no holes of this kind.
function hpCell(label, group, thisSplit, baseSplit) {
  if (!thisSplit || thisSplit.holes === 0) return null;
  const value = thisSplit.avgPoints;
  const baseline = (baseSplit && baseSplit.holes > 0) ? baseSplit.avgPoints : null;
  return {
    label,
    group,
    value,
    baseline,
    deltaVsAvg: baseline != null ? +(value - baseline).toFixed(2) : null,
    deltaVs2: +(value - BENCHMARK).toFixed(2),
    holes: thisSplit.holes,
    polarity: 'higher',
  };
}

// The ten net-points-per-hole cells: par types, difficulty bands,
// opening/closing stretch, and the two nines.
function pointsPerHoleCells(thisStats, baseStats) {
  const base = baseStats || {};
  const cells = [
    hpCell('Par 3s', 'course', thisStats.parType.par3, base.parType?.par3),
    hpCell('Par 4s', 'course', thisStats.parType.par4, base.parType?.par4),
    hpCell('Par 5s', 'course', thisStats.parType.par5, base.parType?.par5),
    hpCell('Hard holes (SI 1-6)', 'course', thisStats.difficulty.hard, base.difficulty?.hard),
    hpCell('Mid holes (SI 7-12)', 'course', thisStats.difficulty.mid, base.difficulty?.mid),
    hpCell('Easy holes (SI 13-18)', 'course', thisStats.difficulty.easy, base.difficulty?.easy),
    hpCell('Opening 3', 'timing', thisStats.warmupClosing.warmup, base.warmupClosing?.warmup),
    hpCell('Closing 3', 'timing', thisStats.warmupClosing.closing, base.warmupClosing?.closing),
  ];
  // Front/back nine come from frontBack, which is null for any round that
  // is not a fully-scored 18-hole round.
  if (thisStats.frontBack) {
    const fb = thisStats.frontBack;
    const baseFb = base.frontBack;
    cells.push(hpCell('Front 9', 'timing',
      { avgPoints: fb.frontAvg, holes: 9 },
      baseFb ? { avgPoints: baseFb.frontAvg, holes: 9 } : null));
    cells.push(hpCell('Back 9', 'timing',
      { avgPoints: fb.backAvg, holes: 9 },
      baseFb ? { avgPoints: baseFb.backAvg, holes: 9 } : null));
  }
  return cells.filter(Boolean);
}

// Build a count cell (birdies, blow-ups, …): value is this round's count,
// baseline is the career per-round average count.
function countCell(label, value, baseTotal, baseRounds, polarity) {
  const baseline = baseRounds > 0 && baseTotal != null
    ? +(baseTotal / baseRounds).toFixed(1) : null;
  return {
    label,
    group: 'distribution',
    value,
    baseline,
    deltaVsAvg: baseline != null ? +(value - baseline).toFixed(1) : null,
    deltaVs2: null,
    holes: null,
    polarity,
  };
}

// Build a shot-stat cell. value is this round's figure; baseline is the
// career figure (already per-round in shotStats output).
function shotCell(label, value, baseline, polarity) {
  return {
    label,
    group: 'shots',
    value,
    baseline,
    deltaVsAvg: baseline != null ? +(value - baseline).toFixed(1) : null,
    deltaVs2: null,
    holes: null,
    polarity,
  };
}

// The distribution cells: birdies-or-better, pars, bogeys, blow-ups.
function distributionCells(thisStats, baseStats) {
  const d = thisStats.distribution;
  const bd = baseStats ? baseStats.distribution : null;
  const bRounds = baseStats ? baseStats.roundCount : 0;
  const thisBirdies = d.eagles + d.birdies;
  const thisBlowups = d.doubles + d.worse;
  return [
    countCell('Birdies+', thisBirdies,
      bd ? bd.eagles + bd.birdies : null, bRounds, 'higher'),
    countCell('Pars', d.pars, bd ? bd.pars : null, bRounds, 'higher'),
    countCell('Bogeys', d.bogeys, bd ? bd.bogeys : null, bRounds, 'lower'),
    countCell('Blow-ups', thisBlowups,
      bd ? bd.doubles + bd.worse : null, bRounds, 'lower'),
  ];
}

// The shot-stat cells — only meaningful when the round has shot detail.
function shotCells(thisStats, baseStats) {
  const s = thisStats.shots;
  const bs = baseStats ? baseStats.shots : null;
  const basePenaltiesPerRound = bs && bs.roundsWithData > 0
    ? +(bs.penalties.total / bs.roundsWithData).toFixed(1)
    : null;
  return [
    shotCell('Putts', s.putts.perRound,
      bs ? bs.putts.perRound : null, 'lower'),
    shotCell('Fairways hit %', s.drives.fairwayPct,
      bs ? bs.drives.fairwayPct : null, 'higher'),
    shotCell('Greens in reg %', s.gir.pct,
      bs ? bs.gir.pct : null, 'higher'),
    shotCell('Penalties', s.penalties.total, basePenaltiesPerRound, 'lower'),
  ];
}

// Pick the bright spots / cost-you-points from a cell pool.
function selectCallouts(cells, hasHistory) {
  const rankKey = hasHistory ? 'deltaVsAvg' : 'deltaVs2';
  const sorted = cells
    .filter((c) => c.holes >= CALLOUT_MIN_HOLES && c[rankKey] != null)
    .sort((a, b) => b[rankKey] - a[rankKey]);
  const bright = sorted.filter((c) => c[rankKey] > 0).slice(0, 2);
  const cost = sorted.filter((c) => c[rankKey] < 0).reverse().slice(0, 2);
  return { bright, cost };
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

  const pphCells = pointsPerHoleCells(thisStats, baseStats);
  const callouts = selectCallouts(pphCells, hasHistory);

  const hasShotData = !!thisStats.shots.hasData;

  const groups = [
    { key: 'course', label: 'Where on the course',
      cells: pphCells.filter((c) => c.group === 'course') },
    { key: 'timing', label: 'When in the round',
      cells: pphCells.filter((c) => c.group === 'timing') },
    { key: 'distribution', label: 'Scoring',
      cells: distributionCells(thisStats, baseStats) },
  ];
  if (hasShotData) {
    groups.push({ key: 'shots', label: 'Shot stats',
      cells: shotCells(thisStats, baseStats) });
  }

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
      tone: toneFromVerdict(verdict),
    },
    hasHistory,
    callouts,
    hasShotData,
    groups,
  };
}
