// Pure data shaping for the Game Stats screen (StatsScreen + components/gamestats).
// Every function takes the screen's scramble-sanitised tournament
// (withoutScrambleScores) and returns plain data: no React, no t(). Text that
// depends on the data comes back as message descriptors ({ key, params }) or
// as small structured values the components turn into copy.
import {
  getPlayingHandicap, calcStablefordPoints, calcExtraShots, roundLeaderboard, roundScoringMode,
  tournamentLeaderboardResolved,
} from './tournamentStore';
import { assignPlacements, comparatorForBoardMode } from './leaderboardPlacement';
import {
  holeCountOf, isRoundFullyScoredBy, isFullLengthRound, resolvePairs,
} from './scoring';
import {
  tournamentHighlights, hotStretch, skinsLeaderboard, hallOfShame, par3Heartbreak,
  pickupChampion, anchor, zeroHero, bestWorstHoles, chaosHoles, collectiveExtremes,
  headToHead, shotStats, playerStreaks, withoutScrambleScores, playerScoreDistribution,
} from './statsEngine';
import { scorecardModel, grossResult } from './scorecardView';

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

// ── Result standings ──
// The game's real result: the very board the Play screen leaderboard shows
// (HomeScreen's resolvedBoard: a casual game → its round's board in the
// round's own mode; a tournament → tournamentLeaderboardResolved, which is the
// Stableford total for mixed modes), placed with that board's own comparator.
// Takes the RAW tournament, not the scramble-sanitised one, so a scramble
// round counts exactly as Play counts it. `sameAsStableford` is true when the
// board is the individual Stableford total the Points view already shows
// (individual, Stableford with partners), so Summary needs no Result view.
export function resultStandings(tournament) {
  const rounds = tournament?.rounds ?? [];
  const board = tournament?.kind === 'game'
    ? roundLeaderboard(tournament, rounds[0] ?? null)
    : tournamentLeaderboardResolved(tournament);
  const rows = assignPlacements(board.entries.filter((e) => e.player), comparatorForBoardMode(board.mode));
  let sameAsStableford = false;
  if (board.mode === 'individual' || board.mode === 'stableford') {
    const points = new Map(
      standingsRows(withoutScrambleScores(tournament)).rows.map((r) => [r.player.id, r.total ?? 0]),
    );
    sameAsStableford = rows.every((r) => (points.get(r.player.id) ?? 0) === r.points);
  }
  return { mode: board.mode, unit: board.unit, rows, sameAsStableford };
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

// ── Competitors of a round's story (lead, comeback) ──
// The same sides the round result card shows: pairs when the card shows pair
// totals (Stableford with partners: a pair's running points are the sum of its
// members', carried flat once a member stops), players when it shows an
// individual board. Rounds whose card is a match play or best/worst-ball
// scoreline have no running-points story, so they return null rather than
// contradict the card.
function storyCompetitors(tournament, roundIndex) {
  const result = roundResult(tournament, roundIndex);
  if (!result) return null;
  const race = raceSeries(tournament, roundIndex);
  if (result.kind === 'teams') {
    if (result.mode !== 'stableford') return null;
    const carried = (x) => {
      let last = 0;
      return x.values.slice(1).map((v) => { if (v != null) last = v; return v ?? last; });
    };
    const lines = new Map(race.series.map((x) => [x.player.id, x]));
    const series = result.sides.map((side) => {
      const mine = side.members.map((m) => lines.get(m.id)).filter(Boolean);
      if (!mine.length) return null;
      const flat = mine.map(carried);
      const values = [0, ...race.holes.map((_, h) => (
        mine.some((x) => x.values[h + 1] != null) ? flat.reduce((s, f) => s + f[h], 0) : null
      ))];
      return { players: side.members, team: true, values, total: values.filter((v) => v != null).pop() ?? 0 };
    }).filter(Boolean).sort((a, b) => b.total - a.total);
    return { holes: race.holes, series };
  }
  if (MATCH_PLAY_MODES.has(result.mode)) return null;
  return {
    holes: race.holes,
    series: race.series.map((x) => ({ players: [x.player], team: false, values: x.values, total: x.total })),
  };
}

function leadersByHole(story) {
  const leaders = [];
  story.holes.forEach((_, h) => {
    const live = story.series.filter((x) => x.values[h + 1] != null);
    if (live.length === 0) return;
    const top = Math.max(...live.map((x) => x.values[h + 1]));
    const at = live.filter((x) => x.values[h + 1] === top);
    leaders.push(at.length === 1 ? at[0] : null);
  });
  return leaders;
}

// { team, total, leaders: [{ players, led }] (most holes led first, only sides
// that led), changes } — null with fewer than two sides on the card.
export function leadStory(tournament, roundIndex) {
  const story = storyCompetitors(tournament, roundIndex);
  if (!story || story.series.length < 2) return null;
  const sequence = leadersByHole(story);
  const led = new Map();
  let changes = 0;
  let prev = null;
  sequence.forEach((side) => {
    if (!side) return;
    led.set(side, (led.get(side) ?? 0) + 1);
    if (prev && side !== prev) changes++;
    prev = side;
  });
  const leaders = story.series
    .filter((x) => led.has(x))
    .map((x) => ({ players: x.players, led: led.get(x) }))
    .sort((a, b) => b.led - a.led);
  return { team: story.series[0].team, total: sequence.length, leaders, changes };
}

// ── Comeback (one round) ──
// The round's winning side(s) and the biggest gap they faced to the best
// running total of any other side, with the hole it was first reached after.
// Only a deficit of COMEBACK_MIN or more counts.
const COMEBACK_MIN = 3;
export function roundComeback(tournament, roundIndex) {
  const story = storyCompetitors(tournament, roundIndex);
  if (!story || story.series.length < 2) return null;
  const topTotal = story.series[0].total;
  let best = null;
  story.series.filter((x) => x.total === topTotal).forEach((winner) => {
    story.holes.forEach((_, h) => {
      const mine = winner.values[h + 1];
      if (mine == null) return;
      const others = story.series.filter((x) => x !== winner && x.values[h + 1] != null).map((x) => x.values[h + 1]);
      if (!others.length) return;
      const deficit = Math.max(...others) - mine;
      if (deficit >= COMEBACK_MIN && (!best || deficit > best.deficit)) {
        best = { players: winner.players, team: winner.team, deficit, afterHole: story.holes[h] };
      }
    });
  });
  if (!best) return null;
  return { ...best, roundIndex, courseName: tournament.rounds[roundIndex].courseName };
}

// ── Personal best runs (net) ──
// Longest runs within a round, net of handicap strokes. A par run needs 2+
// holes to be worth showing, a birdie run 1+.
export function playerBestRuns(tournament, playerId) {
  const st = playerStreaks(tournament, playerId);
  return {
    par: st.bestParStreak >= 2 ? st.bestParStreak : 0,
    birdie: st.bestBirdieStreak >= 1 ? st.bestBirdieStreak : 0,
  };
}

// ── Weekend holes ──
// Average Stableford points per physical hole across every scored round (a
// hole is keyed by courseId, else course name, plus its number); holes with
// fewer than 2 scores are left out. Easiest (highest average) first.
export function weekendHoleRanking(tournament) {
  const map = new Map();
  scoredRoundIndices(tournament).forEach((ri) => {
    const round = tournament.rounds[ri];
    (tournament.players ?? []).forEach((player) => {
      holeEntries(round, player).forEach((e) => {
        const key = `${round.courseId ?? round.courseName}|${e.hole.number}`;
        const rec = map.get(key) ?? {
          key, courseName: round.courseName, holeNumber: e.hole.number, par: e.hole.par,
          roundIndex: ri, rounds: [], total: 0, scores: 0,
        };
        if (!rec.rounds.includes(ri)) rec.rounds.push(ri);
        rec.total += e.points;
        rec.scores += 1;
        map.set(key, rec);
      });
    });
  });
  return [...map.values()]
    .filter((h) => h.scores >= 2)
    .map((h) => ({ ...h, avgPoints: Math.round((h.total / h.scores) * 100) / 100 }))
    .sort((a, b) => (b.avgPoints - a.avgPoints) || (a.roundIndex - b.roundIndex) || (a.holeNumber - b.holeNumber));
}

// Every finished round per player, with points, gross strokes and par.
function finishedRounds(tournament) {
  const rows = [];
  scoredRoundIndices(tournament).forEach((ri) => {
    const round = tournament.rounds[ri];
    (tournament.players ?? []).forEach((player) => {
      if (!isRoundFullyScoredBy(round, player.id)) return;
      const entries = holeEntries(round, player);
      rows.push({
        player, roundIndex: ri, courseName: round.courseName, full: isFullLengthRound(round),
        points: entries.reduce((s, e) => s + e.points, 0),
        strokes: entries.reduce((s, e) => s + e.strokes, 0),
        par: entries.reduce((s, e) => s + e.hole.par, 0),
      });
    });
  });
  return rows;
}

// Finished rounds, lowest gross first. Full-length rounds only, unless there
// are none: then nine-hole rounds, with `nine` set.
export function grossRounds(tournament) {
  const all = finishedRounds(tournament);
  const full = all.filter((r) => r.full);
  const pool = full.length ? full : all;
  return {
    nine: full.length === 0 && pool.length > 0,
    rows: pool.map((r) => ({ ...r, vs: r.strokes - r.par }))
      .sort((a, b) => (a.strokes - b.strokes) || (a.roundIndex - b.roundIndex)),
  };
}

// Per player with 2+ finished full-length rounds: points gained from the first
// to the last one, biggest gain first.
export function improvementRows(tournament) {
  const byPlayer = new Map();
  finishedRounds(tournament).filter((r) => r.full).forEach((r) => {
    byPlayer.set(r.player.id, [...(byPlayer.get(r.player.id) ?? []), r]);
  });
  return [...byPlayer.values()]
    .filter((list) => list.length >= 2)
    .map((list) => {
      const from = list[0];
      const to = list[list.length - 1];
      return { player: from.player, from, to, gain: to.points - from.points };
    })
    .sort((a, b) => b.gain - a.gain);
}

// ── Awards ──
// The Summary strip: glory first, then shame. Each award carries the players
// it names, a value and a detail descriptor, and the engine record (`data`)
// its detail sheet is built from. A one-round game drops Best round (it is
// the winner) and every round / course prefix from the details.
export function awardsList(tournament, { teams = false } = {}) {
  const players = tournament?.players ?? [];
  const multi = players.length > 1;
  const single = singleRoundIndex(tournament) != null;
  const out = [];
  const push = (award) => out.push(award);
  const uniquePlayers = (list) => [...new Map(list.map((p) => [p.id, p])).values()];
  const placeDetail = (e) => (single
    ? { key: 'stats.game.award.holePar', params: { hole: e.holeNumber, par: e.par } }
    : { key: 'stats.game.award.where', params: { round: e.roundIndex + 1, course: e.courseName, hole: e.holeNumber } });
  const tiedDetail = (count) => ({ key: 'stats.game.award.tied', params: { count } });

  const net = tournamentHighlights(tournament, { metric: 'points' });
  const gross = tournamentHighlights(tournament, { metric: 'strokes' });

  if (net.bestRound && !single) {
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
      detail: single
        ? { key: 'stats.game.award.stretchSingle', params: { from: hot.startHole, to: hot.endHole } }
        : { key: 'stats.game.award.stretch', params: { round: hot.roundIndex + 1, from: hot.startHole, to: hot.endHole } },
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

  // Weekend-wide glory.
  const grossBest = grossRounds(tournament);
  if (grossBest.rows.length) {
    const top = grossBest.rows.filter((r) => r.strokes === grossBest.rows[0].strokes);
    const vs = top[0].vs === 0 ? 'E' : `${top[0].vs > 0 ? '+' : '−'}${Math.abs(top[0].vs)}`;
    push({
      id: 'bestGross', icon: 'flag', tone: 'glory', players: uniquePlayers(top.map((r) => r.player)),
      titleKey: single ? 'stats.game.award.title.bestGrossSingle' : undefined,
      value: { key: grossBest.nine ? 'stats.game.award.grossNine' : 'stats.game.award.gross', params: { strokes: top[0].strokes, vs } },
      detail: top.length > 1 ? tiedDetail(top.length)
        : single ? { key: 'stats.game.award.grossSingleDetail' }
          : { key: 'stats.game.award.roundCourse', params: { round: top[0].roundIndex + 1, course: top[0].courseName } },
      data: grossBest,
    });
  }
  const comebacks = scoredRoundIndices(tournament).map((ri) => roundComeback(tournament, ri)).filter(Boolean)
    .sort((a, b) => b.deficit - a.deficit);
  if (comebacks.length) {
    const top = comebacks.filter((c) => c.deficit === comebacks[0].deficit);
    push({
      id: 'comeback', icon: 'rotate-ccw', tone: 'glory', players: uniquePlayers(top.flatMap((c) => c.players)),
      value: { key: 'stats.game.award.comebackValue' },
      detail: top.length > 1 ? tiedDetail(top.length)
        : single ? { key: 'stats.game.sheet.comebackRow', params: { count: top[0].deficit, hole: top[0].afterHole } }
          : { key: 'stats.game.award.comebackDetail', params: { round: top[0].roundIndex + 1, count: top[0].deficit, hole: top[0].afterHole } },
      data: comebacks,
    });
  }
  const improved = improvementRows(tournament);
  if (improved.length && improved[0].gain >= 3) {
    const top = improved.filter((r) => r.gain === improved[0].gain);
    push({
      id: 'improved', icon: 'arrow-up-right', tone: 'glory', players: top.map((r) => r.player),
      value: { key: 'stats.game.award.improvedValue', params: { count: top[0].gain } },
      detail: top.length === 1
        ? {
          key: 'stats.game.award.improvedDetail',
          params: { from: top[0].from.roundIndex + 1, a: top[0].from.points, to: top[0].to.roundIndex + 1, b: top[0].to.points },
        }
        : tiedDetail(top.length),
      data: improved,
    });
  }
  // Easiest / hardest hole of the weekend: no player, so the card is labelled
  // by the hole. Needs 2+ played rounds (one round is Rounds → Hole stories).
  const holeRanking = scoredRoundIndices(tournament).length >= 2 ? weekendHoleRanking(tournament) : [];
  const holeAward = (id, tone, icon, ranked) => {
    const lead = ranked[0];
    const tied = ranked.filter((h) => h.avgPoints === lead.avgPoints).length - 1;
    const many = lead.rounds.length > 1;
    push({
      id, icon, tone, players: [],
      label: { key: 'stats.game.award.holeLabel', params: { hole: lead.holeNumber } },
      value: { key: 'stats.game.story.avg', params: { n: lead.avgPoints } },
      detail: {
        key: `stats.game.award.${many ? 'holeWhereMany' : 'holeWhere'}${tied > 0 ? 'Tied' : ''}`,
        params: {
          round: lead.roundIndex + 1, course: lead.courseName, hole: lead.holeNumber, par: lead.par, count: many ? lead.rounds.length : tied, tied,
        },
      },
      data: ranked.slice(0, 10),
    });
  };
  if (holeRanking.length) holeAward('easiestHole', 'glory', 'smile', holeRanking);

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
        : single ? { key: 'stats.game.award.cold.pointless' }
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
      detail: e.length > 1 ? tiedDetail(e.length)
        : single ? { key: 'stats.game.award.collapseSingle', params: { front: e[0].front, back: e[0].back } }
          : { key: 'stats.game.award.collapseDetail', params: { round: e[0].roundIndex + 1, front: e[0].front, back: e[0].back } },
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
  if (holeRanking.length) {
    const hardest = [...holeRanking].sort((a, b) => (a.avgPoints - b.avgPoints) || (a.roundIndex - b.roundIndex) || (a.holeNumber - b.holeNumber));
    holeAward('hardestHole', 'shame', 'frown', hardest);
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

// ── Single-round mode ──
// The index of the one played round when the game has exactly one (a casual
// game, or a tournament with a single scored round); null otherwise. The
// screen then drops every view that only makes sense across rounds.
export function singleRoundIndex(tournament) {
  const scored = scoredRoundIndices(tournament);
  return scored.length === 1 ? scored[0] : null;
}

// Gross result of one hole against par (the scorecard's classes).
export { grossResult };

const GROSS_LEVEL = { eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0 };

// Heat level (0–4, the heatColors scale) of a ledger cell. 'strokes': the
// gross result (eagle+ 4 · birdie 3 · par 2 · bogey 1 · double+ 0).
// 'points': Stableford points, 3+ capped at 3.
export function cellLevel(mode, cell) {
  if (cell?.strokes == null) return null;
  if (mode === 'points') return Math.min(cell.points, 3);
  return GROSS_LEVEL[cell.gross];
}

// Score mix for the shared Strokes | Points switch: 'strokes' classifies
// gross (birdie = one under par), 'points' net of handicap strokes.
export function scoreMix(tournament, playerId, mode) {
  return playerScoreDistribution(tournament, playerId, { metric: mode === 'points' ? 'points' : 'strokes' });
}

// ── Scorecard (one round) ──
// The round's scorecard for Game Stats: Stableford points (the stats unit),
// rows for `playerIds` in roster order with `meId` first. One player's row
// is the hole-by-hole ledger (`rows[0]`): per hole strokes, points, gross
// result, handicap strokes, putts, drive (par 4s and 5s), tee penalties, GIR,
// and a total per nine.
export function roundCard(tournament, roundIndex, playerIds, meId = null) {
  const round = tournament?.rounds?.[roundIndex];
  const wanted = new Set(playerIds);
  const players = (tournament?.players ?? []).filter((p) => wanted.has(p.id));
  if (!round || players.length === 0) return null;
  return scorecardModel({ round, players, meId });
}

// Longest run of consecutive scored holes that are gross par or better
// ('strokes') or worth 2+ points ('points'). Null under 2 holes.
export function ledgerBestRun(ledger, mode) {
  const cells = (ledger?.nines ?? []).flatMap((n) => n.cells);
  const good = (c) => c.strokes != null && (mode === 'points' ? c.points >= 2 : c.strokes <= c.par);
  let best = null;
  let start = null;
  cells.forEach((c, i) => {
    if (!good(c)) { start = null; return; }
    if (start == null) start = i;
    const length = i - start + 1;
    if (!best || length > best.length) best = { length, from: cells[start].number, to: c.number };
  });
  return best && best.length >= 2 ? best : null;
}

// ── Where you score ──
// Points per hole by par type, by nine (18-hole rounds only) and by handicap
// stroke, around the 2 pts/hole of playing to handicap. Empty buckets and
// groups drop out.
export function scoringSplits(tournament, playerId) {
  const player = (tournament?.players ?? []).find((p) => p.id === playerId);
  const buckets = {};
  const add = (key, points) => {
    const b = buckets[key] ?? { holes: 0, points: 0 };
    b.holes += 1;
    b.points += points;
    buckets[key] = b;
  };
  if (player) {
    (tournament.rounds ?? []).forEach((round) => {
      const full = (round.holes?.length ?? 0) >= 18;
      holeEntries(round, player).forEach((e) => {
        if (e.hole.par >= 3 && e.hole.par <= 5) add(`par${e.hole.par}`, e.points);
        if (full) add(e.hole.number <= 9 ? 'front' : 'back', e.points);
        add(e.extra > 0 ? 'withStroke' : 'withoutStroke', e.points);
      });
    });
  }
  const item = (key) => (buckets[key] ? { key, holes: buckets[key].holes, avg: buckets[key].points / buckets[key].holes } : null);
  return [
    { key: 'par', items: ['par3', 'par4', 'par5'].map(item).filter(Boolean) },
    { key: 'nine', items: ['front', 'back'].map(item).filter(Boolean) },
    { key: 'stroke', items: ['withStroke', 'withoutStroke'].map(item).filter(Boolean) },
  ].filter((g) => g.items.length > 0);
}

// ── Putts histogram ──
// Holes by putts taken: 0 (holed from off the green), 1, 2, 3+.
export function puttBuckets(tournament, playerId) {
  const out = { zero: 0, one: 0, two: 0, three: 0, holes: 0, total: 0 };
  (tournament?.rounds ?? []).forEach((round) => {
    const byHole = round.shotDetails?.[playerId];
    if (!byHole) return;
    (round.holes ?? []).forEach((hole) => {
      const p = byHole[hole.number]?.putts;
      if (p == null) return;
      out.holes += 1;
      out.total += p;
      if (p <= 0) out.zero += 1;
      else if (p === 1) out.one += 1;
      else if (p === 2) out.two += 1;
      else out.three += 1;
    });
  });
  return out;
}

// ── Compare with the group ──
// Dot plots for the players who logged shots, one axis per metric. Empty
// unless 2+ players logged; a metric needs 2+ values to be worth a plot.
export function shotComparePlots(tournament) {
  const rows = shotComparison(tournament);
  if (rows.length < 2) return [];
  const metric = (key, field, max) => ({
    key,
    max,
    values: rows.filter((r) => r[field] != null).map((r) => ({ player: r.player, value: r[field] })),
  });
  return [
    metric('fir', 'firPct', 100),
    metric('gir', 'girPct', 100),
    metric('putts', 'puttsPerHole', 3),
  ].filter((m) => m.values.length >= 2);
}
