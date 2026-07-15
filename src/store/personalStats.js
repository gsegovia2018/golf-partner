// Personal cross-tournament statistics.
//
// Every function here is pure. The screen (MyStatsScreen) does the async
// loading and AsyncStorage persistence; this module only transforms data.
//
// Approach: collect the logged-in user's rounds from every tournament, build
// a synthetic single-player "tournament", and reuse the per-player functions
// in statsEngine.js. See docs/superpowers/specs/2026-05-17-my-stats-personal-view-design.md
import { getPlayingHandicap, calcStablefordPoints, roundScoringMode } from './tournamentStore';
import { isScrambleMode } from '../components/scoringModes';
import {
  parTypeSplit, warmupVsClosing, frontBackSplit, playerScoreDistribution,
  playerRoundHistory, playerConsistency, bounceBackRate, shotStats,
  teeShotImpact, scramblingStats,
  lagPuttingQuality, sandSaveRate, upAndDownRate, bunkerVisits,
  sgSeason, driveScoreImpact, approachScoreImpact, puttDeepDive,
  puttingTargetGaps, approachTargetGaps, courseDNA, playerStreaks,
} from './statsEngine';
import { buildCoachInsights } from './coachInsights';
import { shotBenchmarkForHandicap } from './shotBenchmarks';

// Canonical player id used inside the synthetic tournament.
export const CANON_ID = 'me';

// ── buildSyntheticTournament ──
// Produces { id, name, players: [me], rounds } where every round's scores,
// shotDetails, playerHandicaps, manualHandicaps, playerTees and playerIndexes
// are re-keyed from the round's original player id to CANON_ID. This object
// is the input to the existing per-player engine functions.
export function buildSyntheticTournament(myRounds) {
  if (!myRounds || myRounds.length === 0) {
    return { id: 'mystats', name: 'My Stats', players: [], rounds: [] };
  }
  // myRounds is chronological (oldest-first, see collectMyRounds) — the
  // fallback player identity/handicap should reflect who the user is NOW,
  // so it comes from the most recent round, not the oldest.
  const base = myRounds[myRounds.length - 1].player || {};
  const player = {
    id: CANON_ID,
    name: base.name || 'Me',
    handicap: base.handicap ?? 0,
    user_id: base.user_id ?? null,
  };
  const rounds = myRounds.map((mr) => {
    const { round, playerId } = mr;
    const rekey = (obj) => (obj && obj[playerId] != null
      ? { [CANON_ID]: obj[playerId] }
      : {});
    return {
      ...round,
      scores: rekey(round.scores),
      shotDetails: rekey(round.shotDetails),
      playerHandicaps: rekey(round.playerHandicaps),
      manualHandicaps: rekey(round.manualHandicaps),
      // Without this, legacy rounds (no playerHandicaps) would derive the
      // playing handicap from the wrong (missing) tee under CANON_ID.
      playerTees: rekey(round.playerTees),
      // Legacy rounds (no playerHandicaps) fall back to this per-round index
      // override — without rekeying it, getPlayingHandicap can't find it
      // under CANON_ID and silently drops back to the fallback player above.
      playerIndexes: rekey(round.playerIndexes),
      // Carried through so round-total aggregates (computeMetrics,
      // computeFormSeries) can restrict themselves to fully-scored rounds.
      isComplete: !!mr.isComplete,
      holesPlayed: mr.holesPlayed ?? 0,
    };
  });
  return { id: 'mystats', name: 'My Stats', players: [player], rounds };
}

// ── holeDifficultySplit ──
// Buckets a player's holes by printed stroke index into thirds: hard,
// mid, easy. avgPoints is net Stableford points per hole in each band.
//
// Thresholds are derived PER ROUND from that round's own max stroke index
// (e.g. 18 for a full round, 9 for a 9-hole round) rather than a hardcoded
// 1-18 scale — a fixed hard≤6/mid≤12/easy>12 split leaves the "easy" band
// permanently empty for 9-hole rounds (SI only ever reaches 9), skewing
// strength ranking and the report card's "where on the course" group. For
// an 18-hole round with SI 1-18 this reduces to the original 6/12 split
// exactly, so ordinary rounds are unaffected.
function difficultyBand(strokeIndex, maxStrokeIndex) {
  const third = (maxStrokeIndex || 18) / 3;
  return strokeIndex <= third ? 'hard' : strokeIndex <= 2 * third ? 'mid' : 'easy';
}

export function holeDifficultySplit(tournament, playerId) {
  const bands = { hard: [], mid: [], easy: [] };
  const player = (tournament.players || []).find((p) => p.id === playerId);
  if (player) {
    (tournament.rounds || []).forEach((round, roundIndex) => {
      if (!round.scores?.[playerId]) return;
      const handicap = getPlayingHandicap(round, player);
      const holes = round.holes || [];
      const maxSI = holes.reduce((m, h) => Math.max(m, h.strokeIndex || 0), 0);
      holes.forEach((hole) => {
        const sc = round.scores[playerId]?.[hole.number];
        if (!sc) return;
        const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        const band = difficultyBand(hole.strokeIndex, maxSI);
        bands[band].push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
          strokes: sc, points,
        });
      });
    });
  }
  const summarize = (arr) => ({
    holes: arr.length,
    avgPoints: arr.length
      ? +(arr.reduce((s, e) => s + e.points, 0) / arr.length).toFixed(2)
      : 0,
    breakdown: arr,
  });
  return {
    hard: summarize(bands.hard),
    mid: summarize(bands.mid),
    easy: summarize(bands.easy),
  };
}

// ── computeMetrics ──
// Round-level aggregates over a synthetic tournament. Used for the Snapshot
// card and for both sides of the recent-vs-history comparison.
//
// `rounds` counts every round the user has any score in (informational —
// "rounds played"). avgPoints/avgVsPar/bestRoundPoints are ROUND-TOTAL
// aggregates: averaging a round's whole-round total alongside full rounds
// gives an early-finished 6-hole game the same weight as an 18-hole round,
// silently dragging the average down. They only ever look at rounds where
// every hole was scored (`isComplete`); per-hole metrics elsewhere in this
// file are unaffected and keep seeing every round.
//
// When NO selected round is complete, those three are null, not 0 — the
// same convention as the shot metrics below: consumers print '-' for null
// (PerformanceSnapshot, CoachTab, orDash in FormTab), and
// computeRecentVsHistory turns a null side into a null delta / flat
// direction instead of a fabricated "declining" trend against a 0-point
// recent window.
export function computeMetrics(synthetic) {
  const history = playerRoundHistory(synthetic, CANON_ID);
  const rounds = history.length;
  const completeHistory = history.filter((h) => synthetic.rounds[h.roundIndex]?.isComplete);
  let vsParSum = 0;
  let vsParRounds = 0;
  (synthetic.rounds || []).forEach((round, ri) => {
    if (!round.isComplete) return;
    const h = history.find((x) => x.roundIndex === ri);
    if (!h) return;
    let parPlayed = 0;
    (round.holes || []).forEach((hole) => {
      if (round.scores?.[CANON_ID]?.[hole.number] != null) parPlayed += hole.par;
    });
    vsParSum += h.strokes - parPlayed;
    vsParRounds += 1;
  });
  const shots = shotStats(synthetic, CANON_ID);
  const div = (a, b) => (b > 0 ? +(a / b).toFixed(2) : 0);
  const totalPoints = completeHistory.reduce((s, h) => s + h.points, 0);
  return {
    rounds,
    avgPoints: completeHistory.length > 0
      ? div(totalPoints, completeHistory.length)
      : null,
    avgVsPar: vsParRounds > 0 ? div(vsParSum, vsParRounds) : null,
    bestRoundPoints: completeHistory.length > 0
      ? completeHistory.reduce((m, h) => Math.max(m, h.points), 0)
      : null,
    hasShotData: shots.hasData,
    // Shot metrics are null (not 0) when the slice has no sample for them, so
    // recent-vs-history never shows a fake delta against an untracked slice.
    fairwayPct: shots.drives.recorded > 0 ? shots.drives.fairwayPct : null,
    puttsPerRound: shots.roundsWithPuttData > 0 ? shots.putts.perRound : null,
    girPct: shots.gir.eligible > 0 ? shots.gir.pct : null,
    threePuttsPerRound: shots.roundsWithPuttData > 0
      ? div(shots.putts.threePuttPlus, shots.roundsWithPuttData)
      : null,
  };
}

// ── Form metrics ──
// Each carries a polarity so the UI colors the trend arrow correctly.
// `shot: true` metrics need shot-tracking data to be meaningful.
export const FORM_METRICS = [
  { key: 'avgPoints',          label: 'Points / round',   polarity: 'higher', shot: false },
  { key: 'avgVsPar',           label: 'Strokes vs par',   polarity: 'lower',  shot: false },
  { key: 'fairwayPct',         label: 'Fairways hit %',   polarity: 'higher', shot: true },
  { key: 'girPct',             label: 'Greens in reg %',  polarity: 'higher', shot: true },
  { key: 'puttsPerRound',      label: 'Putts / round',    polarity: 'lower',  shot: true },
  { key: 'threePuttsPerRound', label: '3-putts / round',  polarity: 'lower',  shot: true },
];

// ── resolveMyPlayer ──
// Finds the logged-in user's player slot inside a tournament or game.
// The primary signal is the linked account (`user_id`), but solo games and
// guest-added players often have no `user_id` — that link is only stamped on
// via the tournament claim/join flow, which single games never use. So we
// fall back to a case-insensitive display-name match, then to the lone
// player of a single-player game. Both fallbacks are safe here: collectMyRounds
// only ever sees the current user's own visible tournaments.
function resolveMyPlayer(tournament, userId, displayName) {
  const players = tournament.players || [];
  if (userId) {
    const byId = players.find((p) => p.user_id === userId);
    if (byId) return byId;
  }
  const name = displayName?.trim().toLowerCase();
  if (name) {
    const byName = players.find((p) => (p.name || '').trim().toLowerCase() === name);
    if (byName) return byName;
  }
  if (tournament.kind === 'game' && players.length === 1) return players[0];
  return null;
}

// ── collectMyRounds ──
// Flattens every tournament's rounds into MyRound records for the user.
// `tournaments` arrive newest-first (id desc) from the loaders, so we reverse
// to get chronological (oldest-first) order. `displayName` is the optional
// profile name used to recognise unlinked (guest) player slots — see
// resolveMyPlayer.
export function collectMyRounds(tournaments, userId, displayName) {
  const result = [];
  const chrono = [...(tournaments || [])].reverse();
  chrono.forEach((t) => {
    const me = resolveMyPlayer(t, userId, displayName);
    if (!me) return;
    (t.rounds || []).forEach((round, roundIndex) => {
      // Scramble rounds carry a team ball under the captain, not an
      // individual score — exclude per round, not per tournament.
      if (isScrambleMode(roundScoringMode(t, round))) return;
      const myScores = round?.scores?.[me.id];
      if (!myScores || Object.keys(myScores).length === 0) return;
      const holes = round.holes || [];
      // isComplete is the honest signal: every round hole actually has a
      // score. `completed` is looser — it also trusts an explicit
      // tournament finish (finishedAt) even when the round itself stopped
      // early, e.g. a game called after 6 of 18 holes. That looseness is
      // fine for "should this round be selected by default", but round-total
      // metrics (avgPoints, bestRoundPoints, …) need isComplete or a 6-hole
      // game gets averaged in as if it were a full round.
      const isComplete = holes.length > 0 && holes.every((h) => myScores[h.number] != null);
      const completed = !!t.finishedAt || isComplete;
      const handicap = getPlayingHandicap(round, me);
      let points = 0;
      let holesPlayed = 0;
      holes.forEach((h) => {
        const sc = myScores[h.number];
        if (sc != null) {
          points += calcStablefordPoints(h.par, sc, handicap, h.strokeIndex);
          holesPlayed += 1;
        }
      });
      result.push({
        key: `${t.id}:${roundIndex}`,
        round,
        tournamentId: t.id,
        tournamentName: t.name || 'Tournament',
        tournamentDate: t.createdAt ?? null,
        courseName: round.courseName || `Round ${roundIndex + 1}`,
        roundIndex,
        playerId: me.id,
        player: me,
        completed,
        isComplete,
        holesPlayed,
        // Total Stableford points; partial for in-progress (incomplete) rounds.
        points,
      });
    });
  });
  return result;
}

// Minimum holes for a hole-level cell to be eligible for ranking — guards
// against fake insights from tiny samples.
const HOLE_SAMPLE_MIN = 12;
const IMPACT_SAMPLE_MIN = 3;
const DRIVE_LABELS = {
  super: 'Super drives',
  fairway: 'Fairway drives',
  left: 'Left misses',
  right: 'Right misses',
  short: 'Short drives',
};

const round2 = (n) => Math.round(n * 100) / 100;

function pushImpact(cells, {
  area, label, score, sample, sampleUnit, unit, value, basis,
}) {
  if (!Number.isFinite(score) || sample < IMPACT_SAMPLE_MIN) return;
  cells.push({
    area,
    label,
    score: round2(score),
    sample,
    ...(sampleUnit ? { sampleUnit } : {}),
    unit,
    value: value ?? round2(score),
    ...(basis ? { basis } : {}),
  });
}

export function buildActionPlan({
  driveImpact, approachTarget, puttingTarget, strokesGained,
}) {
  const cells = [];

  if (driveImpact?.hasData) {
    const bucketEntries = Object.entries(driveImpact.buckets)
      .filter(([, b]) => b.holes >= IMPACT_SAMPLE_MIN);
    const totalHoles = bucketEntries.reduce((sum, [, b]) => sum + b.holes, 0);
    const totalPoints = bucketEntries.reduce((sum, [, b]) => sum + (b.avgPoints * b.holes), 0);
    const baseline = totalHoles > 0 ? totalPoints / totalHoles : null;
    if (baseline != null) {
      bucketEntries.forEach(([key, bucket]) => {
        pushImpact(cells, {
          area: 'Driving',
          label: DRIVE_LABELS[key] ?? `${key} drives`,
          score: bucket.avgPoints - baseline,
          sample: bucket.holes,
          unit: 'pts / hole',
          value: bucket.avgPoints,
          basis: 'vs your avg',
        });
      });
    }
  }

  Object.entries(approachTarget?.buckets ?? {}).forEach(([bucket, row]) => {
    pushImpact(cells, {
      area: 'Approach',
      label: `${bucket} m approaches`,
      score: row.avgSg,
      sample: row.holes,
      unit: 'SG / shot',
      value: row.avgSg,
      basis: 'vs target hcp',
    });
  });

  Object.entries(puttingTarget?.buckets ?? {}).forEach(([bucket, row]) => {
    pushImpact(cells, {
      area: 'Putting',
      label: `${bucket} m putts`,
      score: row.sgPerPutt,
      sample: row.attempts,
      unit: 'SG / putt',
      value: row.sgPerPutt,
      basis: 'vs target hcp',
    });
  });

  Object.entries(strokesGained?.byCategory ?? {}).forEach(([key, value]) => {
    const label = {
      approach: 'Approach',
      aroundGreen: 'Around the green',
      putting: 'Putting',
    }[key] ?? key;
    const categorySample = strokesGained.sampleHolesByCategory?.[key]
      ?? strokesGained.sampleHoles
      ?? 0;
    pushImpact(cells, {
      area: 'Strokes Gained',
      label,
      score: value,
      sample: categorySample,
      sampleUnit: 'holes',
      unit: 'SG / round',
      value,
      basis: 'vs target hcp',
    });
  });

  const strengths = cells
    .filter((cell) => cell.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const improvements = cells
    .filter((cell) => cell.score < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
  return {
    keep: strengths[0] ?? null,
    improve: improvements[0] ?? null,
    practice: improvements.find((cell) => cell.area !== improvements[0]?.area) ?? improvements[0] ?? null,
    strengths,
    improvements,
  };
}

// ── rankStrengths ──
// Every candidate cell is reduced to one comparable number: net points per
// hole. The baseline is the player's overall mean points/hole. Cells far
// above baseline are strengths; far below are pain points.
export function rankStrengths(synthetic) {
  const consistency = playerConsistency(synthetic)[0];
  const baseline = consistency?.mean ?? null;
  if (baseline == null) {
    return { baseline: null, strengths: [], weaknesses: [] };
  }

  const cells = [];
  const addCell = (label, avgPoints, holes) => {
    if (holes >= HOLE_SAMPLE_MIN) {
      cells.push({ label, avgPoints, sample: holes, unit: 'holes' });
    }
  };

  const pt = parTypeSplit(synthetic, CANON_ID);
  addCell('Par 3s', pt.par3.avgPoints, pt.par3.holes);
  addCell('Par 4s', pt.par4.avgPoints, pt.par4.holes);
  addCell('Par 5s', pt.par5.avgPoints, pt.par5.holes);

  const diff = holeDifficultySplit(synthetic, CANON_ID);
  addCell('Hard holes', diff.hard.avgPoints, diff.hard.holes);
  addCell('Mid holes', diff.mid.avgPoints, diff.mid.holes);
  addCell('Easy holes', diff.easy.avgPoints, diff.easy.holes);

  const wc = warmupVsClosing(synthetic, CANON_ID);
  addCell('Opening 3 holes', wc.warmup.avgPoints, wc.warmup.holes);
  addCell('Closing 3 holes', wc.closing.avgPoints, wc.closing.holes);

  const fb = frontBackSplit(synthetic)[0];
  if (fb) {
    addCell('Front nine', fb.frontAvg, fb.rounds.length * 9);
    addCell('Back nine', fb.backAvg, fb.rounds.length * 9);
  }

  const tee = teeShotImpact(synthetic, CANON_ID);
  addCell('Tee shot on the fairway', tee.fairway.avgPoints, tee.fairway.holes);
  addCell('Tee shot missing the fairway', tee.missed.avgPoints, tee.missed.holes);
  addCell('After a tee penalty', tee.teePenalty.avgPoints, tee.teePenalty.holes);

  const scored = cells.map((c) => ({
    ...c,
    deviation: +(c.avgPoints - baseline).toFixed(2),
  }));
  const strengths = scored
    .filter((c) => c.deviation > 0)
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, 3);
  const weaknesses = scored
    .filter((c) => c.deviation < 0)
    .sort((a, b) => a.deviation - b.deviation)
    .slice(0, 3);
  return { baseline: +baseline.toFixed(2), strengths, weaknesses };
}

// ── resolveSelection ──
// Given the full MyRound list and a stored override map ({ [key]: boolean }),
// returns the rounds that are active. Default (no override) = the round's
// `completed` flag. Storing only overrides means newly-played completed
// rounds are auto-included.
export function resolveSelection(myRounds, overrides = {}) {
  return (myRounds || []).filter((r) => (
    Object.prototype.hasOwnProperty.call(overrides, r.key)
      ? overrides[r.key]
      : r.completed
  ));
}

// A history slice smaller than this is one or two rounds — a single noisy
// round (an off day, an unusually easy course) then drives the whole
// improving/declining verdict, which flowed straight into Coach
// formInsight (it keys off `delta`, not `direction`). Below this minimum
// we still surface the raw recent/history values (informational), but
// suppress delta/direction into null/'flat' — no confident claim.
const MIN_FORM_HISTORY_ROUNDS = 3;

// ── computeRecentVsHistory ──
// "Recent" = the last N rounds (chronologically). "History" = every earlier
// round. Disjoint, so the delta is a true improving/declining signal —
// but only once history has MIN_FORM_HISTORY_ROUNDS rounds behind it.
export function computeRecentVsHistory(myRounds, n = 5) {
  const all = myRounds || [];
  const recentRounds = all.slice(-n);
  const historyRounds = all.slice(0, Math.max(0, all.length - n));
  const hasHistory = historyRounds.length > 0;
  const confidentHistory = historyRounds.length >= MIN_FORM_HISTORY_ROUNDS;
  const recent = computeMetrics(buildSyntheticTournament(recentRounds));
  const history = hasHistory
    ? computeMetrics(buildSyntheticTournament(historyRounds))
    : null;
  const metrics = FORM_METRICS.map((m) => {
    const recentVal = recent[m.key];
    const historyVal = hasHistory ? history[m.key] : null;
    // Shot metrics can be null on either side (untracked slice) — no delta
    // then. Below MIN_FORM_HISTORY_ROUNDS the history slice itself is too
    // thin to trust for a delta, even when both values are present.
    const delta = confidentHistory && recentVal != null && historyVal != null
      ? +(recentVal - historyVal).toFixed(2)
      : null;
    let direction = 'flat';
    if (delta != null && delta !== 0) {
      const improved = m.polarity === 'higher' ? delta > 0 : delta < 0;
      direction = improved ? 'up' : 'down';
    }
    return { ...m, recent: recentVal, history: historyVal, delta, direction };
  });
  return {
    n,
    recentCount: recentRounds.length,
    historyCount: historyRounds.length,
    hasHistory,
    hasShotData: recent.hasShotData || (history?.hasShotData ?? false),
    metrics,
  };
}

// "12 May" — short day+month from an ISO date string. Matches the round
// selector's date format (MyStatsRoundSelector.formatRoundDate).
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── computeFormSeries ──
// Per-round series for the Form-tab charts. Each selected round is sliced into
// a one-round synthetic tournament and run back through the existing engine —
// no parallel per-round math. Shot-derived values are null for rounds with no
// shot detail so charts render a gap rather than a fake zero. Course name
// alone can be ambiguous across a season of repeat visits, so the label
// appends a short date when the round's tournament carries one.
export function computeFormSeries(selectedRounds) {
  const rounds = selectedRounds || [];
  const metrics = {
    avgPoints: [], avgVsPar: [], fairwayPct: [],
    girPct: [], puttsPerRound: [], threePuttsPerRound: [],
  };
  const scoreMix = [];
  let hasShotData = false;

  rounds.forEach((mr, i) => {
    const baseLabel = mr.courseName || `R${i + 1}`;
    const dateLabel = shortDate(mr.tournamentDate);
    const label = dateLabel ? `${baseLabel} · ${dateLabel}` : baseLabel;
    const synthetic = buildSyntheticTournament([mr]);
    const round = synthetic.rounds[0];
    const hist = playerRoundHistory(synthetic, CANON_ID)[0] || null;
    let parPlayed = 0;
    (round.holes || []).forEach((h) => {
      if (round.scores?.[CANON_ID]?.[h.number] != null) parPlayed += h.par;
    });
    const shots = shotStats(synthetic, CANON_ID);
    if (shots.hasData) hasShotData = true;

    // avgPoints/avgVsPar are round-total figures — an incomplete round's
    // partial total isn't a meaningful "points this round" point, so it
    // renders as a gap rather than a misleadingly low value.
    const roundTotal = round.isComplete && hist;
    metrics.avgPoints.push({ label, value: roundTotal ? hist.points : null });
    metrics.avgVsPar.push({ label, value: roundTotal ? hist.strokes - parPlayed : null });
    metrics.fairwayPct.push({ label, value: shots.drives.recorded > 0 ? shots.drives.fairwayPct : null });
    metrics.girPct.push({ label, value: shots.gir.eligible > 0 ? shots.gir.pct : null });
    // `total` equals per-round here because shotStats runs on a one-round synthetic slice.
    metrics.puttsPerRound.push({ label, value: shots.putts.holes > 0 ? shots.putts.total : null });
    metrics.threePuttsPerRound.push({ label, value: shots.putts.holes > 0 ? shots.putts.threePuttPlus : null });

    const d = playerScoreDistribution(synthetic, CANON_ID);
    scoreMix.push({
      label,
      birdie: d.eagles + d.birdies,
      par: d.pars,
      bogey: d.bogeys + d.doubles + d.worse,
    });
  });

  return { metrics, scoreMix, hasShotData };
}

// ── courseMastery ──
// Per-course rounds/avgPoints/bestPoints/trend, built on courseDNA over a
// complete-rounds-only slice of the synthetic tournament (Task 15's
// isComplete) — an early-finished round's partial total would otherwise
// drag a course's average down, inflate/deflate its best, and fake a trend.
// avgPoints/bestPoints are ROUND-TOTAL figures (same scale as
// computeMetrics.avgPoints/bestRoundPoints), not per-hole averages.
// bestPoints/trend come from courseDNA's own chronological `roundTotals`,
// so they always share courseDNA's course keying (courseId ?? courseName,
// `R{n}` fallback for unnamed rounds) — no second grouping that can
// silently miss (e.g. courseName '' vs the 'R{n}' display key).
// trend is the sign of the latest complete round here vs the one before
// it, and null — not a fake "flat" 0 — when there is no previous round
// to compare against. A swing smaller than COURSE_TREND_BAND (a single
// stray stroke on one hole) reads as noise, not a real trend, so it's
// clamped to 0 ("flat") rather than painting a confident arrow.
const COURSE_TREND_BAND = 2;
export function courseMastery(synthetic) {
  const completeRounds = (synthetic.rounds || []).filter((r) => r.isComplete);
  const dna = courseDNA({ ...synthetic, rounds: completeRounds })[0];
  if (!dna || dna.courses.length === 0) return [];
  return dna.courses.map((c) => {
    const totals = c.roundTotals;
    const bestPoints = totals.reduce((m, e) => Math.max(m, e.points), 0);
    let trend = null;
    if (totals.length >= 2) {
      const diff = totals[totals.length - 1].points - totals[totals.length - 2].points;
      trend = Math.abs(diff) < COURSE_TREND_BAND ? 0 : Math.sign(diff);
    }
    return {
      courseName: c.courseName,
      rounds: c.rounds,
      avgPoints: c.roundPoints,
      bestPoints,
      trend,
    };
  }).sort((a, b) => b.avgPoints - a.avgPoints);
}

// ── careerMilestones ──
// Career-wide feats across the current selection. birdies/eagles/
// longestParStreak are per-hole feats (same convention as
// holeDifficultySplit) and see every scored hole, including holes from an
// early-finished round — a birdie doesn't need the rest of the round
// played. longestParStreak reuses playerStreaks' adjacency-aware run
// (Task 5): a streak never crosses a round boundary or an unscored hole.
// bestNine/bestRound are ROUND-TOTAL metrics and only look at complete
// rounds (Task 15), returning null — not a fabricated 0 — when none
// qualify, matching computeMetrics' convention.
export function careerMilestones(synthetic) {
  const dist = playerScoreDistribution(synthetic, CANON_ID);
  const streaks = playerStreaks(synthetic, CANON_ID);
  const completeRounds = (synthetic.rounds || []).filter((r) => r.isComplete);
  const completeSynthetic = { ...synthetic, rounds: completeRounds };
  // frontBackSplit already only ever pushes a round whose front AND back
  // nine are both fully scored (fc>=9 && bc>=9 on an 18-hole round), so
  // pre-filtering to isComplete here is belt-and-braces, not load-bearing.
  const fb = frontBackSplit(completeSynthetic)[0] ?? null;
  const bestNine = fb
    ? fb.rounds.reduce((m, r) => Math.max(m, r.front, r.back), -Infinity)
    : null;
  return {
    birdies: dist.birdies,
    eagles: dist.eagles,
    longestParStreak: streaks.bestParStreak,
    bestNine: bestNine === -Infinity ? null : bestNine,
    bestRound: computeMetrics(synthetic).bestRoundPoints,
  };
}

// ── computeMyStats ──
// Single entry point for the screen. `selectedRounds` is the active selection
// (already filtered via resolveSelection). The selection is the universe —
// every selected round counts in metrics, form and ranking alike.
//
// `baselineOnly: true` short-circuits after the split-aggregate baseline —
// distribution/shots/parType/difficulty/warmupClosing/frontBack/history/
// roundCount — and skips the rest of the pipeline (ranking, drive/approach/
// putt impact & target-gap analysis, strokes-gained, the action plan, the
// per-round form series, course mastery, career milestones and coach
// insights). Callers like roundReportCard that only read the split
// aggregates get the same values back without paying for the discarded
// work. The baseline fields returned here are computed identically (same
// functions, same args) to the full path, so they are value-identical for
// any selection.
export function computeMyStats(selectedRounds, { n = 5, targetHandicap = 0, baselineOnly = false } = {}) {
  const rounds = selectedRounds || [];
  const synthetic = buildSyntheticTournament(rounds);
  const shotBenchmark = shotBenchmarkForHandicap(targetHandicap);

  const baseline = {
    roundCount: rounds.length,
    parType: parTypeSplit(synthetic, CANON_ID),
    difficulty: holeDifficultySplit(synthetic, CANON_ID),
    frontBack: frontBackSplit(synthetic)[0] ?? null,
    warmupClosing: warmupVsClosing(synthetic, CANON_ID),
    // Net (Stableford-adjusted) — BreakdownTab, roundReportCard and
    // formSeries.scoreMix all report net and must agree with each other.
    distribution: playerScoreDistribution(synthetic, CANON_ID),
    shots: shotStats(synthetic, CANON_ID),
    history: playerRoundHistory(synthetic, CANON_ID),
    targetHandicap,
    shotBenchmark,
  };

  if (baselineOnly) {
    return baseline;
  }

  const ranking = rankStrengths(synthetic);
  const driveImpact = driveScoreImpact(synthetic, CANON_ID);
  const approachImpact = approachScoreImpact(synthetic, CANON_ID);
  const puttDive = puttDeepDive(synthetic, CANON_ID);
  const puttingTarget = puttingTargetGaps(synthetic.rounds, CANON_ID, targetHandicap);
  const approachTarget = approachTargetGaps(synthetic.rounds, CANON_ID, targetHandicap);
  const strokesGained = sgSeason(synthetic.rounds, CANON_ID, targetHandicap);
  const baseStats = {
    ...baseline,
    metrics: computeMetrics(synthetic),
    form: computeRecentVsHistory(rounds, n),
    ranking,
    // Gross vs-par twin, ONLY for the ShotsTab scoring-mix benchmark rows —
    // the benchmark tables (birdies/pars/bogeys per round) come from
    // real-world gross scoring data. Net birdies inflate with handicap and
    // would always read green against a gross target.
    distributionGross: playerScoreDistribution(synthetic, CANON_ID, { metric: 'strokes' }),
    teeShot: teeShotImpact(synthetic, CANON_ID),
    driveImpact,
    approachImpact,
    puttDive,
    puttingTarget,
    approachTarget,
    actionPlan: buildActionPlan({
      driveImpact, approachTarget, puttingTarget, strokesGained,
    }),
    bounceBack: bounceBackRate(synthetic)[0] ?? null,
    scrambling: scramblingStats(synthetic)[0] ?? null,
    formSeries: computeFormSeries(rounds),
    // Phase A:
    lagPutting:   lagPuttingQuality(synthetic.rounds, CANON_ID),
    sandSaves:    sandSaveRate(synthetic.rounds, CANON_ID),
    upAndDown:    upAndDownRate(synthetic.rounds, CANON_ID),
    bunkerVisits: bunkerVisits(synthetic.rounds, CANON_ID),
    // Phase B:
    strokesGained,
    courseMastery: courseMastery(synthetic),
    careerMilestones: careerMilestones(synthetic),
  };
  return { ...baseStats, coach: buildCoachInsights(baseStats) };
}
