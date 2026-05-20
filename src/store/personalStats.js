// Personal cross-tournament statistics.
//
// Every function here is pure. The screen (MyStatsScreen) does the async
// loading and AsyncStorage persistence; this module only transforms data.
//
// Approach: collect the logged-in user's rounds from every tournament, build
// a synthetic single-player "tournament", and reuse the per-player functions
// in statsEngine.js. See docs/superpowers/specs/2026-05-17-my-stats-personal-view-design.md
import { getPlayingHandicap, calcStablefordPoints } from './tournamentStore';
import {
  parTypeSplit, warmupVsClosing, frontBackSplit, playerScoreDistribution,
  playerRoundHistory, playerConsistency, bounceBackRate, shotStats,
  teeShotImpact, scramblingStats,
  lagPuttingQuality, sandSaveRate, upAndDownRate, bunkerVisits,
  sgSeason,
} from './statsEngine';

// Canonical player id used inside the synthetic tournament.
export const CANON_ID = 'me';

// ── buildSyntheticTournament ──
// Produces { id, name, players: [me], rounds } where every round's scores,
// shotDetails, playerHandicaps and manualHandicaps are re-keyed from the
// round's original player id to CANON_ID. This object is the input to the
// existing per-player engine functions.
export function buildSyntheticTournament(myRounds) {
  if (!myRounds || myRounds.length === 0) {
    return { id: 'mystats', name: 'My Stats', players: [], rounds: [] };
  }
  const base = myRounds[0].player || {};
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
    };
  });
  return { id: 'mystats', name: 'My Stats', players: [player], rounds };
}

// ── holeDifficultySplit ──
// Buckets a player's holes by printed stroke index: hard 1-6, mid 7-12,
// easy 13-18. avgPoints is net Stableford points per hole in each band.
export function holeDifficultySplit(tournament, playerId) {
  const bands = { hard: [], mid: [], easy: [] };
  const player = (tournament.players || []).find((p) => p.id === playerId);
  if (player) {
    (tournament.rounds || []).forEach((round, roundIndex) => {
      if (!round.scores?.[playerId]) return;
      const handicap = getPlayingHandicap(round, player);
      (round.holes || []).forEach((hole) => {
        const sc = round.scores[playerId]?.[hole.number];
        if (!sc) return;
        const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        const band = hole.strokeIndex <= 6 ? 'hard'
          : hole.strokeIndex <= 12 ? 'mid' : 'easy';
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
export function computeMetrics(synthetic) {
  const history = playerRoundHistory(synthetic, CANON_ID);
  const rounds = history.length;
  let vsParSum = 0;
  let vsParRounds = 0;
  (synthetic.rounds || []).forEach((round, ri) => {
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
  const totalPoints = history.reduce((s, h) => s + h.points, 0);
  return {
    rounds,
    avgPoints: div(totalPoints, rounds),
    avgVsPar: div(vsParSum, vsParRounds),
    bestRoundPoints: history.reduce((m, h) => Math.max(m, h.points), 0),
    hasShotData: shots.hasData,
    fairwayPct: shots.drives.fairwayPct,
    puttsPerRound: shots.putts.perRound,
    girPct: shots.gir.pct,
    threePuttsPerRound: div(shots.putts.threePuttPlus, shots.roundsWithData),
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
      const myScores = round?.scores?.[me.id];
      if (!myScores || Object.keys(myScores).length === 0) return;
      const holes = round.holes || [];
      const completed = holes.length > 0
        && holes.every((h) => myScores[h.number] != null);
      const handicap = getPlayingHandicap(round, me);
      let points = 0;
      holes.forEach((h) => {
        const sc = myScores[h.number];
        if (sc != null) {
          points += calcStablefordPoints(h.par, sc, handicap, h.strokeIndex);
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
  addCell('Hard holes (SI 1-6)', diff.hard.avgPoints, diff.hard.holes);
  addCell('Mid holes (SI 7-12)', diff.mid.avgPoints, diff.mid.holes);
  addCell('Easy holes (SI 13-18)', diff.easy.avgPoints, diff.easy.holes);

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

// ── computeRecentVsHistory ──
// "Recent" = the last N rounds (chronologically). "History" = every earlier
// round. Disjoint, so the delta is a true improving/declining signal.
export function computeRecentVsHistory(myRounds, n = 5) {
  const all = myRounds || [];
  const recentRounds = all.slice(-n);
  const historyRounds = all.slice(0, Math.max(0, all.length - n));
  const hasHistory = historyRounds.length > 0;
  const recent = computeMetrics(buildSyntheticTournament(recentRounds));
  const history = hasHistory
    ? computeMetrics(buildSyntheticTournament(historyRounds))
    : null;
  const metrics = FORM_METRICS.map((m) => {
    const recentVal = recent[m.key];
    const historyVal = hasHistory ? history[m.key] : null;
    const delta = hasHistory ? +(recentVal - historyVal).toFixed(2) : null;
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

// ── computeFormSeries ──
// Per-round series for the Form-tab charts. Each selected round is sliced into
// a one-round synthetic tournament and run back through the existing engine —
// no parallel per-round math. Shot-derived values are null for rounds with no
// shot detail so charts render a gap rather than a fake zero.
export function computeFormSeries(selectedRounds) {
  const rounds = selectedRounds || [];
  const metrics = {
    avgPoints: [], avgVsPar: [], fairwayPct: [],
    girPct: [], puttsPerRound: [], threePuttsPerRound: [],
  };
  const scoreMix = [];
  let hasShotData = false;

  rounds.forEach((mr, i) => {
    const label = mr.courseName || `R${i + 1}`;
    const synthetic = buildSyntheticTournament([mr]);
    const round = synthetic.rounds[0];
    const hist = playerRoundHistory(synthetic, CANON_ID)[0] || null;
    let parPlayed = 0;
    (round.holes || []).forEach((h) => {
      if (round.scores?.[CANON_ID]?.[h.number] != null) parPlayed += h.par;
    });
    const shots = shotStats(synthetic, CANON_ID);
    if (shots.hasData) hasShotData = true;

    metrics.avgPoints.push({ label, value: hist ? hist.points : 0 });
    metrics.avgVsPar.push({ label, value: hist ? hist.strokes - parPlayed : null });
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

// ── computeMyStats ──
// Single entry point for the screen. `selectedRounds` is the active selection
// (already filtered via resolveSelection). The selection is the universe —
// every selected round counts in metrics, form and ranking alike.
export function computeMyStats(selectedRounds, { n = 5, targetHandicap = 0 } = {}) {
  const rounds = selectedRounds || [];
  const synthetic = buildSyntheticTournament(rounds);
  return {
    roundCount: rounds.length,
    metrics: computeMetrics(synthetic),
    form: computeRecentVsHistory(rounds, n),
    ranking: rankStrengths(synthetic),
    parType: parTypeSplit(synthetic, CANON_ID),
    difficulty: holeDifficultySplit(synthetic, CANON_ID),
    frontBack: frontBackSplit(synthetic)[0] ?? null,
    warmupClosing: warmupVsClosing(synthetic, CANON_ID),
    distribution: playerScoreDistribution(synthetic, CANON_ID),
    teeShot: teeShotImpact(synthetic, CANON_ID),
    shots: shotStats(synthetic, CANON_ID),
    bounceBack: bounceBackRate(synthetic)[0] ?? null,
    scrambling: scramblingStats(synthetic)[0] ?? null,
    history: playerRoundHistory(synthetic, CANON_ID),
    formSeries: computeFormSeries(rounds),
    // Phase A:
    lagPutting:   lagPuttingQuality(synthetic.rounds, CANON_ID),
    sandSaves:    sandSaveRate(synthetic.rounds, CANON_ID),
    upAndDown:    upAndDownRate(synthetic.rounds, CANON_ID),
    bunkerVisits: bunkerVisits(synthetic.rounds, CANON_ID),
    // Phase B:
    strokesGained: sgSeason(synthetic.rounds, CANON_ID, targetHandicap),
  };
}
