// Where the player is in the round lifecycle, for the Play tab (Home list).
// Pure: no I/O, no language. Spec: the "Home round focus" design, option B.
//
// homePhase(tournaments, { userId, now, lastActivityByKey }) → {
//   phase:  'live' | 'before' | 'after' | 'idle'   first match wins, in that order
//   live:   { tournament, round, roundIndex } | null
//   before: { tournament, round, roundIndex, next } | null   next: the round after a finished one
//   after:  { tournament, round, roundIndex, endedAt } | null  kept when Before wins (one line)
// }
// `lastActivityByKey` maps `${tournamentId}:${roundId}` → ms of the last hole
// published; a missing entry is "unknown", which isRoundLive does not demote.
import { isTournamentFinished, isRoundComplete, roundLeaderboard } from './tournamentStore';
import { roundEndedAt, parseFinishedAt } from './finishStamp';
import { isRoundLive } from './liveRound';
import { getPlayingHandicap, resolvePairs } from './scoring';

export const PHASE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function myPlayerIn(tournament, userId) {
  const players = tournament?.players ?? [];
  return players.find((p) => userId && p.user_id === userId)
    ?? players.find((p) => tournament?.meId && p.id === tournament.meId)
    ?? null;
}

// Most holes any one player has entered on the round.
export function holesPlayed(round, players) {
  let max = 0;
  for (const p of players) {
    const n = Object.values(round?.scores?.[p.id] ?? {}).filter((v) => v != null).length;
    if (n > max) max = n;
  }
  return max;
}

const within = (ms, now) => ms != null && ms <= now && now - ms <= PHASE_WINDOW_MS;
const latest = (list, key) => list.reduce((best, c) => (best == null || c[key] > best[key] ? c : best), null);

export function homePhase(tournaments, { userId = null, now = Date.now(), lastActivityByKey = null } = {}) {
  const lives = [];
  const befores = [];
  const afters = [];
  for (const t of tournaments ?? []) {
    // Official tournaments have their own model and screens; viewers don't play.
    if (!t || t.kind === 'official' || t._role === 'viewer') continue;
    const me = myPlayerIn(t, userId);
    if (!me) continue;
    const players = t.players ?? [];
    const rounds = t.rounds ?? [];
    const finished = isTournamentFinished(t);

    rounds.forEach((round, roundIndex) => {
      const endedAt = roundEndedAt(t, round);
      const mine = Object.values(round?.scores?.[me.id] ?? {}).some((v) => v != null);
      if (mine && within(endedAt, now)) afters.push({ tournament: t, round, roundIndex, endedAt });
    });
    if (finished) continue;

    const c = Math.min(Math.max(Number(t.currentRound) || 0, 0), Math.max(rounds.length - 1, 0));
    const round = rounds[c];
    if (!round) continue;
    const played = holesPlayed(round, players);
    const endedAt = roundEndedAt(t, round);
    const lastAt = lastActivityByKey?.get?.(`${t.id}:${round.id}`) ?? null;
    if (isRoundLive({
      finished: endedAt != null, holesPlayed: played, totalHoles: round.holes?.length ?? 18, lastActivityAt: lastAt, now,
    })) {
      lives.push({ tournament: t, round, roundIndex: c, at: lastAt ?? 0 });
      continue;
    }

    if (played === 0) {
      // Not started: fresh game, or the previous round of a tournament just ended.
      const prevEnded = c > 0 ? roundEndedAt(t, rounds[c - 1]) : null;
      const created = parseFinishedAt(t.createdAt);
      const at = [created, prevEnded].filter((ms) => within(ms, now)).sort((a, b) => b - a)[0];
      if (at != null) befores.push({ tournament: t, round, roundIndex: c, next: false, at });
    } else if (c < rounds.length - 1 && (endedAt != null || isRoundComplete(round, players))
      && within(endedAt, now) && holesPlayed(rounds[c + 1], players) === 0) {
      // Current round done, next one waits for NextRound (teams, then start).
      befores.push({ tournament: t, round: rounds[c + 1], roundIndex: c + 1, next: true, at: endedAt });
    }
  }

  const strip = (x) => (x ? { tournament: x.tournament, round: x.round, roundIndex: x.roundIndex, ...(x.next != null ? { next: x.next } : {}) } : null);
  const live = strip(latest(lives, 'at'));
  const before = strip(latest(befores, 'at'));
  const afterPick = latest(afters, 'endedAt');
  const after = afterPick ? { ...strip(afterPick), endedAt: afterPick.endedAt } : null;
  const phase = live ? 'live' : before ? 'before' : after ? 'after' : 'idle';
  return { phase, live, before, after };
}

// Before hero: who plays with whom and the strokes each one gets.
export function beforeModel({ tournament, round, roundIndex }, userId) {
  const players = tournament.players ?? [];
  const me = myPlayerIn(tournament, userId);
  const row = (p) => ({ id: p.id, name: p.name ?? '', strokes: getPlayingHandicap(round, p), me: p.id === me?.id });
  const pairs = resolvePairs(round.pairs, players);
  const teams = Array.isArray(pairs) && pairs.length === 2 && pairs.every((pr) => Array.isArray(pr) && pr.length > 0)
    ? pairs.map((pr) => pr.filter((m) => m?.id).map(row))
    : null;
  return {
    name: tournament.name ?? '',
    kind: tournament.kind ?? 'tournament',
    roundNumber: roundIndex + 1,
    roundCount: (tournament.rounds ?? []).length,
    courseName: round.courseName || round.course?.name || '',
    tee: (me && round.playerTees?.[me.id]?.label) || '',
    teams,
    players: teams ? null : players.map(row),
  };
}

// Live hero: my points, the group's board and the next hole.
export function liveModel({ tournament, round, roundIndex }, userId) {
  const players = tournament.players ?? [];
  const me = myPlayerIn(tournament, userId);
  const thruOf = (id) => Object.values(round.scores?.[id] ?? {}).filter((v) => v != null).length;
  const { unit, entries } = roundLeaderboard(tournament, round);
  const board = entries.map((e) => ({
    id: e.player?.id, name: e.player?.name ?? '', points: e.points, thru: thruOf(e.player?.id), me: e.player?.id === me?.id,
  }));
  const thru = me ? thruOf(me.id) : holesPlayed(round, players);
  const holes = round.holes ?? [];
  const nextHole = me
    ? holes.find((h) => round.scores?.[me.id]?.[h.number] == null) ?? null
    : holes[thru] ?? null;
  return {
    name: tournament.name ?? '',
    roundNumber: roundIndex + 1,
    courseName: round.courseName || round.course?.name || '',
    unit,
    myPoints: board.find((b) => b.me)?.points ?? null,
    thru,
    holeCount: holes.length || 18,
    next: nextHole ? { number: nextHole.number, par: nextHole.par ?? null, strokeIndex: nextHole.strokeIndex ?? null, distance: nextHole.distance ?? null } : null,
    board,
  };
}

// After hero: my result, place and the winner.
export function afterModel({ tournament, round, roundIndex, endedAt }, userId) {
  const me = myPlayerIn(tournament, userId);
  const { unit, entries } = roundLeaderboard(tournament, round);
  const mine = entries.find((e) => e.player?.id === me?.id) ?? null;
  const place = mine ? 1 + entries.filter((e) => e.points > mine.points).length : null;
  const top = entries[0] ?? null;
  return {
    tournamentId: tournament.id,
    roundId: round.id,
    roundKey: `${tournament.id}:${roundIndex}`,
    name: tournament.name ?? '',
    courseName: round.courseName || round.course?.name || '',
    endedAt,
    unit,
    myPoints: mine?.points ?? null,
    place,
    count: entries.length,
    // null when I won (or tied for first): the card says so instead.
    winner: top && place !== 1 ? { name: top.player?.name ?? '', points: top.points } : null,
  };
}
