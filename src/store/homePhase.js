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
import { getPlayingHandicap, resolvePairs, calcExtraShots, holeCountOf, roundScoringMode } from './scoring';
import { pairBoard } from './homePairs';
import { scorecardModel } from './scorecardView';

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

// Rounds whose card-engine state Home should read: the current round of
// every open game I'm in that is started, or new enough to be Before.
export function cardCandidates(tournaments, userId, now = Date.now()) {
  const out = [];
  for (const t of tournaments ?? []) {
    if (!t || t.kind === 'official' || t._role === 'viewer' || isTournamentFinished(t)) continue;
    if (!myPlayerIn(t, userId)) continue;
    const rounds = t.rounds ?? [];
    const c = Number(t.currentRound) || 0;
    const round = rounds[c];
    if (!round?.id) continue;
    const recent = within(parseFinishedAt(t.createdAt), now) || (c > 0 && within(roundEndedAt(t, rounds[c - 1]), now));
    if (recent || holesPlayed(round, t.players ?? []) > 0) out.push({ tournament: t, round });
  }
  return out;
}

// Scores live in the card engine first (my draft, my published holes, the
// peers' cards) and reach the tournament blob only after the server projects
// them. Overlay what this phone shows (engine/cards.js `shownScores`) on the
// current round, cell by cell, so Home sees a hole the moment it is scored.
export function withCardScores(tournaments, cardScoresByKey, cardShotsByKey = null) {
  const none = (m) => !m || m.size === 0;
  if (none(cardScoresByKey) && none(cardShotsByKey)) return tournaments;
  const merge = (base, over) => {
    const out = { ...(base ?? {}) };
    for (const [pid, byHole] of Object.entries(over ?? {})) out[pid] = { ...(out[pid] ?? {}), ...byHole };
    return out;
  };
  return (tournaments ?? []).map((t) => {
    const c = Number(t?.currentRound) || 0;
    const round = t?.rounds?.[c];
    const key = round ? `${t.id}:${round.id}` : null;
    const shown = key ? cardScoresByKey?.get(key) : null;
    const shots = key ? cardShotsByKey?.get(key) : null;
    const hasShown = shown && Object.keys(shown).length > 0;
    const hasShots = shots && Object.keys(shots).length > 0;
    if (!hasShown && !hasShots) return t;
    const rounds = t.rounds.slice();
    rounds[c] = {
      ...round,
      ...(hasShown ? { scores: merge(round.scores, shown) } : {}),
      ...(hasShots ? { shotDetails: merge(round.shotDetails, shots) } : {}),
    };
    return { ...t, rounds };
  });
}

// Shot detail (putts, tee shot, ...) from my own card: what I published, with
// the hole I am on overlaid from the draft. Same rule as useCardViews.
export function cardShotDetails(state) {
  const out = {};
  const put = (h, playerId, detail) => {
    if (detail == null) return;
    if (!out[playerId]) out[playerId] = {};
    out[playerId][h] = detail;
  };
  const myCard = state?.cardsByAuthor?.[state?.myAuthorId];
  for (const [h, entry] of Object.entries(myCard?.holes ?? {})) {
    for (const [pid, d] of Object.entries(entry?.shots ?? {})) put(h, pid, d);
  }
  for (const [h, draft] of Object.entries(state?.draft ?? {})) {
    for (const [pid, d] of Object.entries(draft?.shots ?? {})) put(h, pid, d);
  }
  return out;
}

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

// A tee set the course never named ("Default") says nothing on the card.
const teeName = (label) => (label && label.trim().toLowerCase() !== 'default' ? label : '');

// Before hero: who plays with whom and the strokes each one gets. Teams come
// my pair first; `side` keeps the round's own pair (0 = A, 1 = B) for colour.
// A solo round names the holes where I get my shots, when there are one or two.
export function beforeModel({ tournament, round, roundIndex }, userId) {
  const players = tournament.players ?? [];
  const me = myPlayerIn(tournament, userId);
  const row = (p) => ({ id: p.id, name: p.name ?? '', strokes: getPlayingHandicap(round, p), me: p.id === me?.id });
  const pairs = resolvePairs(round.pairs, players);
  let teams = Array.isArray(pairs) && pairs.length === 2 && pairs.every((pr) => Array.isArray(pr) && pr.length > 0)
    ? pairs.map((pr, side) => ({ side, members: pr.filter((m) => m?.id).map(row) }))
    : null;
  if (teams && teams[1].members.some((m) => m.me)) teams = [teams[1], teams[0]];
  let shotHoles = null;
  if (players.length === 1 && me) {
    const strokes = getPlayingHandicap(round, me);
    const holeCount = holeCountOf(round);
    const list = (round.holes ?? [])
      .filter((h) => calcExtraShots(strokes, h.strokeIndex, holeCount) > 0)
      .map((h) => ({ number: h.number, strokeIndex: h.strokeIndex }));
    if (list.length > 0 && list.length <= 2) shotHoles = list;
  }
  return {
    name: tournament.name ?? '',
    kind: tournament.kind ?? 'tournament',
    roundNumber: roundIndex + 1,
    roundCount: (tournament.rounds ?? []).length,
    courseName: round.courseName || round.course?.name || '',
    tee: teeName(me && round.playerTees?.[me.id]?.label),
    teams,
    players: teams ? null : players.map(row),
    shotHoles,
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

// After hero: my result, place and the winner; a tie for first names everyone
// on it. A two-pair game adds the pair result (`pairs`, as the scorecard's
// match panel scores it); a solo round adds my card (`card`) and its shot totals.
export function afterModel({ tournament, round, roundIndex, endedAt }, userId) {
  const me = myPlayerIn(tournament, userId);
  const players = tournament.players ?? [];
  const { unit, entries } = roundLeaderboard(tournament, round);
  const mine = entries.find((e) => e.player?.id === me?.id) ?? null;
  const place = mine ? 1 + entries.filter((e) => e.points > mine.points).length : null;
  const top = entries[0] ?? null;
  const tiedTop = top ? entries.filter((e) => e.points === top.points) : [];
  const solo = players.length === 1 && me
    ? soloCard(tournament, round, me)
    : null;
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
    // null when I won, or when first place is shared (`tied` says who).
    winner: top && place !== 1 && tiedTop.length === 1 ? { name: top.player?.name ?? '', points: top.points } : null,
    tied: tiedTop.length > 1
      ? { points: top.points, players: tiedTop.map((e) => ({ id: e.player?.id, name: e.player?.name ?? '', me: e.player?.id === me?.id })) }
      : null,
    pairs: pairBoard(tournament, round, me?.id ?? null),
    card: solo?.card ?? null,
    shots: solo?.shots ?? null,
  };
}

// My card for a solo round and what my shot detail adds up to: fairways hit
// of those logged, greens in regulation of those known, tee penalties.
function soloCard(tournament, round, me) {
  const card = scorecardModel({ round, players: [me], meId: me.id, mode: roundScoringMode(tournament, round) });
  const row = card.rows[0];
  if (!row) return { card, shots: null };
  const add = (pick) => row.nines.reduce((sum, n) => sum + pick(n), 0);
  const penalties = row.nines.reduce((sum, n) => sum + n.cells.reduce((s, c) => s + (c.penalties ?? 0), 0), 0);
  const shots = row.hasShots
    ? {
      fairways: { hit: add((n) => n.fairways.hit), of: add((n) => n.fairways.of) },
      greens: { hit: add((n) => n.gir.hit), of: add((n) => n.gir.of) },
      penalties,
    }
    : null;
  return { card, shots };
}
