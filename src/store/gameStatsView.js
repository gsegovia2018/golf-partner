// Pure data shaping for the Game Stats screen (StatsScreen + components/gamestats).
// Every function takes the screen's scramble-sanitised tournament
// (withoutScrambleScores) and returns plain data: no React, no t(). Text that
// depends on the data comes back as message descriptors ({ key, params }) or
// as small structured values the components turn into copy.
import {
  getPlayingHandicap, calcStablefordPoints, calcExtraShots, roundLeaderboard, roundScoringMode,
} from './tournamentStore';
import { holeCountOf, isRoundFullyScoredBy, resolvePairs } from './scoring';
import {
  tournamentHighlights, hotStretch, skinsLeaderboard, hallOfShame, par3Heartbreak,
  pickupChampion, anchor, zeroHero, bestWorstHoles, chaosHoles, collectiveExtremes,
  headToHead, shotStats,
} from './statsEngine';

// Modes whose round result is a team result when the round carries pairs.
const TEAM_RESULT_MODES = new Set(['stableford', 'bestball', 'pairsmatchplay']);

const hasScores = (round) => !!round?.scores && Object.keys(round.scores).length > 0;

// Indices of the rounds that hold any score (scramble rounds are already
// blanked by withoutScrambleScores, so they drop out here too).
export function scoredRoundIndices(tournament) {
  return (tournament?.rounds ?? []).reduce((acc, r, i) => (hasScores(r) ? [...acc, i] : acc), []);
}

// One player's scored holes in one round, with points and handicap strokes.
function holeEntries(round, player) {
  const mine = round?.scores?.[player.id];
  if (!mine) return [];
  const holeCount = holeCountOf(round);
  const handicap = getPlayingHandicap(round, player);
  return (round.holes ?? []).reduce((acc, hole) => {
    const strokes = mine[hole.number];
    if (!strokes) return acc;
    acc.push({
      hole,
      strokes,
      points: calcStablefordPoints(hole.par, strokes, handicap, hole.strokeIndex, holeCount),
      extra: calcExtraShots(handicap, hole.strokeIndex, holeCount),
    });
    return acc;
  }, []);
}

// Places for a list already sorted best-first: equal keys share a place.
function assignPlaces(rows, keyOf) {
  let place = 0;
  let prev;
  const placed = rows.map((row, i) => {
    const key = keyOf(row);
    if (i === 0 || key !== prev) place = i + 1;
    prev = key;
    return { ...row, place };
  });
  return placed.map((row) => ({
    ...row,
    isTie: placed.filter((r) => r.place === row.place).length > 1,
  }));
}

// ── Standings ──
// metric 'points': every scored hole counts; a partial round shows its holes
// played. vs = points − 2 per hole played (level with your handicap).
// metric 'gross' | 'net': only rounds the player finished count (a partial
// gross total is not a score); net = gross − playing handicap per round. Rank
// by finished rounds first, then by to-par. A player with no finished round
// is listed unranked.
export function standingsRows(tournament, { metric = 'points' } = {}) {
  const roundIndices = scoredRoundIndices(tournament);
  const players = tournament?.players ?? [];
  const base = players.map((player) => {
    const perRound = roundIndices.map((ri) => {
      const round = tournament.rounds[ri];
      const entries = holeEntries(round, player);
      const holes = entries.length;
      const points = entries.reduce((s, e) => s + e.points, 0);
      const gross = entries.reduce((s, e) => s + e.strokes, 0);
      const par = entries.reduce((s, e) => s + e.hole.par, 0);
      const complete = holes > 0 && isRoundFullyScoredBy(round, player.id);
      const handicap = getPlayingHandicap(round, player);
      return {
        roundIndex: ri, holes, holeCount: round.holes?.length ?? 0, points, gross, par, complete,
        net: gross - handicap,
      };
    });
    return { player, perRound };
  });

  if (metric === 'points') {
    const rows = base.map(({ player, perRound }) => {
      const holes = perRound.reduce((s, r) => s + r.holes, 0);
      const total = perRound.reduce((s, r) => s + r.points, 0);
      return {
        player,
        total: holes > 0 ? total : null,
        holes,
        vs: holes > 0 ? total - 2 * holes : null,
        perRound: perRound.map((r) => ({
          roundIndex: r.roundIndex,
          value: r.holes > 0 ? r.points : null,
          holes: r.holes,
          partial: r.holes > 0 && !r.complete,
        })),
      };
    });
    const ranked = rows.filter((r) => r.holes > 0).sort((a, b) => b.total - a.total);
    const unranked = rows.filter((r) => r.holes === 0).map((r) => ({ ...r, place: null, isTie: false }));
    return { metric, roundIndices, rows: [...assignPlaces(ranked, (r) => r.total), ...unranked] };
  }

  const field = metric === 'net' ? 'net' : 'gross';
  const rows = base.map(({ player, perRound }) => {
    const counted = perRound.filter((r) => r.complete);
    const total = counted.reduce((s, r) => s + r[field], 0);
    const par = counted.reduce((s, r) => s + r.par, 0);
    return {
      player,
      counted: counted.length,
      holes: counted.reduce((s, r) => s + r.holes, 0),
      total: counted.length ? total : null,
      vs: counted.length ? total - par : null,
      perRound: perRound.map((r) => ({
        roundIndex: r.roundIndex,
        value: r.complete ? r[field] : null,
        holes: r.holes,
        partial: r.holes > 0 && !r.complete,
      })),
    };
  });
  const ranked = rows.filter((r) => r.counted > 0)
    .sort((a, b) => (b.counted - a.counted) || (a.vs - b.vs));
  const unranked = rows.filter((r) => r.counted === 0).map((r) => ({ ...r, place: null, isTie: false }));
  return {
    metric,
    roundIndices,
    rows: [...assignPlaces(ranked, (r) => `${r.counted}|${r.vs}`), ...unranked],
  };
}

// ── Progression ──
// Cumulative Stableford points after each scored round, one series per
// player in standings order. `caption` tells the story of the lead:
//   { kind: 'wire', leaderIds }            same sole leader after every round
//   { kind: 'took', leaderIds, round, changes }  sole winner, lead for good from R{round}
//   { kind: 'level', leaderIds }           finished tied at the top
export function progression(tournament) {
  const { roundIndices, rows } = standingsRows(tournament, { metric: 'points' });
  const ranked = rows.filter((r) => r.place != null);
  const series = ranked.map((row) => {
    let cum = 0;
    const values = [0];
    row.perRound.forEach((r) => { cum += r.value ?? 0; values.push(cum); });
    return { player: row.player, values, total: row.total };
  });
  let caption = null;
  if (roundIndices.length >= 2 && series.length >= 2) {
    const leadersAt = roundIndices.map((_, i) => {
      const max = Math.max(...series.map((s) => s.values[i + 1]));
      return series.filter((s) => s.values[i + 1] === max).map((s) => s.player.id);
    });
    const final = leadersAt[leadersAt.length - 1];
    if (final.length > 1) {
      caption = { kind: 'level', leaderIds: final };
    } else {
      const solo = (ids) => (ids.length === 1 ? ids[0] : null);
      const winner = final[0];
      let changes = 0;
      let prev = null;
      leadersAt.forEach((ids) => {
        const s = solo(ids);
        if (s && prev && s !== prev) changes++;
        if (s) prev = s;
      });
      let from = leadersAt.length - 1;
      while (from > 0 && solo(leadersAt[from - 1]) === winner) from--;
      caption = from === 0
        ? { kind: 'wire', leaderIds: [winner] }
        : { kind: 'took', leaderIds: [winner], round: roundIndices[from] + 1, changes };
    }
  }
  return { roundIndices, series, caption };
}

// ── Round race ──
// Running Stableford points hole by hole for everyone who scored in the round.
// A line stops at the player's last scored hole (null after it); a blank hole
// in the middle keeps the running total flat.
export function raceSeries(tournament, roundIndex) {
  const round = tournament?.rounds?.[roundIndex];
  if (!hasScores(round)) return { holes: [], series: [] };
  const holes = (round.holes ?? []).map((h) => h.number);
  const series = (tournament.players ?? []).map((player) => {
    const byHole = new Map(holeEntries(round, player).map((e) => [e.hole.number, e.points]));
    if (byHole.size === 0) return null;
    const lastIdx = holes.reduce((last, n, i) => (byHole.has(n) ? i : last), -1);
    let cum = 0;
    const values = [0];
    holes.forEach((n, i) => {
      cum += byHole.get(n) ?? 0;
      values.push(i <= lastIdx ? cum : null);
    });
    return { player, values, total: cum, holesPlayed: byHole.size };
  }).filter(Boolean).sort((a, b) => b.total - a.total);
  return { holes, series };
}

// ── Round result ──
// Team rounds (pairs + a team mode): each side's total in the round's own
// unit, summed from the same per-mode board the Play screen uses. Otherwise
// the individual board (Stableford points, or holes won in 1v1 match play).
export function roundResult(tournament, roundIndex) {
  const round = tournament?.rounds?.[roundIndex];
  if (!hasScores(round)) return null;
  const mode = roundScoringMode(tournament, round);
  const board = roundLeaderboard(tournament, round);
  const played = (pid) => Object.values(round.scores?.[pid] ?? {}).some((s) => s != null);
  const pairs = resolvePairs(round.pairs ?? [], tournament.players ?? []).filter((p) => p.length >= 2);
  if (TEAM_RESULT_MODES.has(mode) && pairs.length >= 2) {
    const pointsOf = (pid) => board.entries.find((e) => e.player?.id === pid)?.points ?? 0;
    const sides = pairs.map((members) => ({
      members,
      points: members.reduce((s, m) => s + pointsOf(m.id), 0),
    })).sort((a, b) => b.points - a.points);
    return { kind: 'teams', mode, unit: board.unit, sides };
  }
  const entries = board.entries
    .filter((e) => e.player && played(e.player.id))
    .map((e) => ({ player: e.player, points: e.points }));
  return { kind: 'individual', mode, unit: board.unit, entries };
}

// ── Match play rounds ──
// The rounds actually played as match play (1v1 match play or pairs match
// play), each with its real result — the same roundResult the Rounds tab
// shows. Rounds in any other mode never appear here.
const MATCH_PLAY_MODES = new Set(['matchplay', 'pairsmatchplay']);
export function matchPlayRounds(tournament) {
  return scoredRoundIndices(tournament)
    .filter((ri) => MATCH_PLAY_MODES.has(roundScoringMode(tournament, tournament.rounds[ri])))
    .map((ri) => ({ roundIndex: ri, courseName: tournament.rounds[ri].courseName, result: roundResult(tournament, ri) }))
    .filter((r) => r.result && (r.result.kind === 'teams' ? r.result.sides.length >= 2 : r.result.entries.length >= 2));
}

// ── Scorecard ──
// One row per hole with a cell per player (points, strokes, handicap strokes),
// plus Out / In / Tot rows (a 9-hole round has Tot only). A total is null
// for a player with no score in that stretch.
export function scorecardGrid(tournament, roundIndex, playerIds) {
  const round = tournament?.rounds?.[roundIndex];
  if (!round) return { holes: [], totals: [], nine: false };
  const players = playerIds
    .map((id) => (tournament.players ?? []).find((p) => p.id === id))
    .filter(Boolean);
  const byPlayer = new Map(players.map((p) => [p.id, new Map(holeEntries(round, p).map((e) => [e.hole.number, e]))]));
  const holeCount = holeCountOf(round);
  const holes = (round.holes ?? []).map((hole) => ({
    number: hole.number,
    par: hole.par,
    si: hole.strokeIndex,
    cells: players.map((p) => {
      const e = byPlayer.get(p.id).get(hole.number);
      const handicap = getPlayingHandicap(round, p);
      return {
        playerId: p.id,
        points: e ? e.points : null,
        strokes: e ? e.strokes : null,
        extra: calcExtraShots(handicap, hole.strokeIndex, holeCount),
      };
    }),
  }));
  const span = (key, list) => ({
    key,
    par: list.reduce((s, h) => s + h.par, 0),
    values: players.map((_, pi) => {
      const pts = list.map((h) => h.cells[pi].points).filter((v) => v != null);
      return pts.length ? pts.reduce((s, v) => s + v, 0) : null;
    }),
  });
  const nine = holes.length <= 9;
  const totals = nine
    ? [span('tot', holes)]
    : [span('out', holes.slice(0, 9)), span('in', holes.slice(9)), span('tot', holes)];
  return { holes, totals, nine };
}

// The tournament with every round but one blanked, so the tournament-wide
// engine passes (chaos, extremes) can be asked about a single round without
// shifting any roundIndex.
function onlyRound(tournament, roundIndex) {
  return {
    ...tournament,
    rounds: tournament.rounds.map((r, i) => (i === roundIndex ? r : { ...r, scores: null })),
  };
}

// ── Hole stories (one round) ──
export function holeStories(tournament, roundIndex) {
  const round = tournament?.rounds?.[roundIndex];
  if (!hasScores(round)) return { easiest: null, hardest: null, chaos: null, cruised: [], wrecked: [] };
  const scoredPlayers = (tournament.players ?? []).filter((p) => holeEntries(round, p).length > 0);
  const multi = scoredPlayers.length >= 2;
  const single = onlyRound(tournament, roundIndex);
  const bw = bestWorstHoles(single, { roundIndex, minScores: multi ? 2 : 1 });
  const extremes = multi ? collectiveExtremes(single) : { disasters: [], gimmes: [] };
  return {
    easiest: bw.best[0] ?? null,
    hardest: bw.worst[0] ?? null,
    chaos: multi ? (chaosHoles(single)[0] ?? null) : null,
    cruised: extremes.gimmes,
    wrecked: extremes.disasters,
  };
}

// ── Stroke holes ──
// Points per hole on holes where the player received a handicap stroke vs
// holes where they did not (plus handicaps that give a stroke back count as
// "without").
export function strokeHoleSplit(tournament, playerId) {
  const player = (tournament?.players ?? []).find((p) => p.id === playerId);
  const acc = { with: [], without: [] };
  if (player) {
    tournament.rounds.forEach((round, roundIndex) => {
      holeEntries(round, player).forEach((e) => {
        (e.extra > 0 ? acc.with : acc.without).push({
          roundIndex, courseName: round.courseName, holeNumber: e.hole.number,
          par: e.hole.par, si: e.hole.strokeIndex, strokes: e.strokes, points: e.points, extra: e.extra,
        });
      });
    });
  }
  const sum = (list) => ({
    holes: list.length,
    points: list.reduce((s, e) => s + e.points, 0),
    avg: list.length ? list.reduce((s, e) => s + e.points, 0) / list.length : null,
    breakdown: list,
  });
  return { withStroke: sum(acc.with), withoutStroke: sum(acc.without) };
}

// ── Awards ──
// The Summary strip: glory first, then shame. Each award carries the players
// it names, a value and a detail descriptor, and the engine record (`data`)
// its detail sheet is built from.
export function awardsList(tournament, { teams = false } = {}) {
  const players = tournament?.players ?? [];
  const multi = players.length > 1;
  const out = [];
  const push = (award) => out.push(award);
  const uniquePlayers = (list) => [...new Map(list.map((p) => [p.id, p])).values()];
  const placeDetail = (e) => ({
    key: 'stats.game.award.where', params: { round: e.roundIndex + 1, course: e.courseName, hole: e.holeNumber },
  });
  const tiedDetail = (count) => ({ key: 'stats.game.award.tied', params: { count } });

  const net = tournamentHighlights(tournament, { metric: 'points' });
  const gross = tournamentHighlights(tournament, { metric: 'strokes' });

  if (net.bestRound) {
    const e = net.bestRound.entries;
    push({
      id: 'bestRound', icon: 'award', tone: 'glory', players: e.map((x) => x.player),
      value: { key: 'stats.game.award.pts', params: { count: net.bestRound.value } },
      detail: e.length === 1
        ? { key: 'stats.game.award.roundCourse', params: { round: e[0].roundIndex + 1, course: e[0].courseName } }
        : tiedDetail(e.length),
      data: net.bestRound,
    });
  }
  const hot = hotStretch(tournament)[0];
  if (hot) {
    push({
      id: 'hotStretch', icon: 'trending-up', tone: 'glory', players: [hot.player],
      value: { key: 'stats.game.award.pts', params: { count: hot.points } },
      detail: { key: 'stats.game.award.stretch', params: { round: hot.roundIndex + 1, from: hot.startHole, to: hot.endHole } },
      data: hot,
    });
  }
  if (net.mostBirdies) {
    push({
      id: 'birdiesNet', icon: 'feather', tone: 'glory', players: net.mostBirdies.entries.map((x) => x.player),
      value: { key: 'stats.game.award.birdies', params: { count: net.mostBirdies.value } },
      detail: net.mostBirdies.entries.length > 1 ? tiedDetail(net.mostBirdies.entries.length) : { key: 'stats.game.award.birdiesNetDetail' },
      data: net.mostBirdies,
    });
  }
  if (gross.mostBirdies) {
    push({
      id: 'birdiesGross', icon: 'feather', tone: 'glory', players: gross.mostBirdies.entries.map((x) => x.player),
      value: { key: 'stats.game.award.birdies', params: { count: gross.mostBirdies.value } },
      detail: gross.mostBirdies.entries.length > 1 ? tiedDetail(gross.mostBirdies.entries.length) : { key: 'stats.game.award.birdiesGrossDetail' },
      data: gross.mostBirdies,
    });
  }
  if (net.longestParStreak && net.longestParStreak.value >= 3) {
    push({
      id: 'parStreak', icon: 'activity', tone: 'glory', players: net.longestParStreak.entries.map((x) => x.player),
      value: { key: 'stats.game.award.holes', params: { count: net.longestParStreak.value } },
      detail: { key: 'stats.game.award.parStreakDetail' },
      data: net.longestParStreak,
    });
  }
  if (multi) {
    const skins = skinsLeaderboard(tournament, { metric: 'points' });
    const top = skins.leaderboard[0];
    if (skins.totalSkins > 0 && top?.skins > 0) {
      const kings = skins.leaderboard.filter((r) => r.skins === top.skins);
      push({
        id: 'skins', icon: 'disc', tone: 'glory', players: kings.map((r) => r.player),
        value: { key: 'stats.game.award.skins', params: { count: top.skins } },
        detail: { key: 'stats.game.award.skinsDetail', params: { count: skins.totalSkins } },
        data: skins,
      });
    }
  }

  // Shame.
  const shame = hallOfShame(tournament, { metric: 'points' });
  if (shame.blowup || shame.tripleBogey) {
    const lead = shame.blowup ?? shame.tripleBogey;
    const e = lead.entries;
    push({
      id: 'worstHole', icon: 'alert-triangle', tone: 'shame', players: uniquePlayers(e.map((x) => x.player)),
      value: shame.blowup
        ? (e.length === 1
          ? { key: 'stats.game.award.blowup', params: { strokes: e[0].strokes, par: e[0].par } }
          : { key: 'stats.game.award.strokes', params: { n: lead.value } })
        : { key: 'stats.game.award.overNet', params: { n: lead.value } },
      detail: e.length === 1 ? placeDetail(e[0]) : tiedDetail(e.length),
      data: { blowup: shame.blowup, tripleBogey: shame.tripleBogey },
    });
  }
  const zero = zeroHero(tournament);
  const streaks = [
    ['pointless', shame.pointlessStreak],
    ['double', shame.doubleBogeyStreak],
    ['bogey', shame.bogeyStreak],
  ].filter(([, s]) => s);
  if (streaks.length || zero) {
    const [kind, lead] = streaks.reduce((best, cur) => (cur[1].value > best[1].value ? cur : best), streaks[0] ?? [null, null]);
    push({
      id: 'coldStreak', icon: 'trending-down', tone: 'shame',
      players: lead ? uniquePlayers(lead.entries.map((x) => x.player)) : [zero.entries[0].player],
      value: lead
        ? { key: 'stats.game.award.holes', params: { count: lead.value } }
        : { key: 'stats.game.award.zeroValue', params: { count: zero.entries[0].count } },
      detail: lead
        ? { key: `stats.game.award.cold.${kind}` }
        : { key: 'stats.game.award.zeroDetail', params: { round: zero.entries[0].roundIndex + 1 } },
      data: {
        pointless: shame.pointlessStreak, double: shame.doubleBogeyStreak, bogey: shame.bogeyStreak, zero,
      },
    });
  }
  if (multi && shame.gift) {
    const e = shame.gift.entries;
    push({
      id: 'gift', icon: 'gift', tone: 'shame', players: uniquePlayers(e.map((x) => x.player)),
      value: { key: 'stats.game.award.gift', params: { count: shame.gift.value } },
      detail: e.length === 1 ? placeDetail(e[0]) : tiedDetail(e.length),
      data: shame.gift,
    });
  }
  if (shame.collapse) {
    const e = shame.collapse.entries;
    push({
      id: 'collapse', icon: 'corner-right-down', tone: 'shame', players: uniquePlayers(e.map((x) => x.player)),
      value: { key: 'stats.game.award.collapse', params: { count: shame.collapse.value } },
      detail: e.length === 1
        ? { key: 'stats.game.award.collapseDetail', params: { round: e[0].roundIndex + 1, front: e[0].front, back: e[0].back } }
        : tiedDetail(e.length),
      data: shame.collapse,
    });
  }
  const par3 = par3Heartbreak(tournament);
  if (par3) {
    push({
      id: 'par3', icon: 'target', tone: 'shame', players: par3.entries.map((x) => x.player),
      value: { key: 'stats.game.award.par3', params: { avg: par3.value } },
      detail: par3.entries.length === 1
        ? { key: 'stats.game.award.par3Detail', params: { count: par3.entries[0].holes } }
        : tiedDetail(par3.entries.length),
      data: par3,
    });
  }
  const pickup = pickupChampion(tournament);
  if (pickup) {
    push({
      id: 'pickup', icon: 'x-circle', tone: 'shame', players: pickup.entries.map((x) => x.player),
      value: { key: 'stats.game.award.pickups', params: { count: pickup.value } },
      detail: pickup.entries.length > 1 ? tiedDetail(pickup.entries.length) : { key: 'stats.game.award.pickupDetail' },
      data: pickup,
    });
  }
  if (teams) {
    const anchorStat = anchor(tournament);
    if (anchorStat) {
      push({
        id: 'anchor', icon: 'anchor', tone: 'shame', players: anchorStat.entries.map((x) => x.player),
        value: { key: 'stats.game.award.anchor', params: { n: anchorStat.value } },
        detail: { key: 'stats.game.award.anchorDetail' },
        data: anchorStat,
      });
    }
  }
  return out;
}

// ── Head-to-head grid ──
// Net hole wins on Stableford points between every two players: cell [i][j]
// is row player i against column player j, null on the diagonal and when they
// never scored the same hole.
export function h2hGrid(tournament) {
  const players = tournament?.players ?? [];
  return players.map((a, i) => players.map((b, j) => {
    if (i === j) return null;
    const { points, totals } = headToHead(tournament, a.id, b.id);
    if (totals.holesCompared === 0) return null;
    return { net: points.p1Wins - points.p2Wins, wins: points.p1Wins, losses: points.p2Wins, ties: points.ties };
  }));
}

// ── Shot comparison ──
// One row per player who logged shot detail. Null where they logged nothing
// for that column (no drives → no FIR %).
export function shotComparison(tournament) {
  return (tournament?.players ?? []).map((player) => {
    const st = shotStats(tournament, player.id);
    if (!st.hasData) return null;
    return {
      player,
      firPct: st.drives.recorded > 0 ? st.drives.fairwayPct : null,
      girPct: st.gir.eligible > 0 ? st.gir.pct : null,
      puttsPerHole: st.putts.holes > 0 ? st.putts.perHole : null,
      threePutts: st.putts.holes > 0 ? st.putts.threePuttPlus : null,
      penalties: st.penalties.total,
    };
  }).filter(Boolean);
}
