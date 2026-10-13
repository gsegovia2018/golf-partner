// Several league cards per game (R16) and tournament rounds (R17), plan
// docs/superpowers/plans/2026-10-13-league-review-followups.md, D5 B. Pure
// helpers, no I/O: the "League cards" list rows in Setup and on Start Round N,
// whether this phone offers the one-time "Count this round?" sheet, and the
// scorecard strip / LEAGUE chips.
import { isScrambleMode, roundScoringMode } from './scoring';
import { isLeagueLength, isLeagueRated, leagueCardOf, leagueCardsOf, setupPlayerTee } from './leagueSetup';
import { takesMonth } from './leagueRules';

// Index of a round in the tournament, 0 when it can't be found (a card from a
// build before R17 is always round 0's).
export function leagueRoundIndex(tournament, roundId) {
  const i = (tournament?.rounds ?? []).findIndex((r) => r.id === roundId);
  return i < 0 ? 0 : i;
}

// The league links recorded on one round of the tournament (every phone adds
// its own, see leagueSetup.leagueCardsOf).
export function roundLeagueCards(tournament, roundId) {
  if (!roundId) return [];
  return leagueCardsOf(tournament).filter((e) => e.roundId === roundId);
}

// Setup has no game on the server yet, so the members' month status comes from
// the league itself: active members and their cards this month. Returns the
// shape get_league_game_status gives later ({ userId, hasCard, thisRound }).
export function membersFromMonth(members, monthCards, { tournamentId = null, roundId = null } = {}) {
  return (members ?? []).map((m) => {
    const cards = (monthCards ?? []).filter((c) => c.userId === m.userId && takesMonth(c));
    const thisRound = cards.some((c) => tournamentId && c.tournamentId === tournamentId && c.roundId === roundId);
    return { userId: m.userId, hasCard: cards.length > 0, thisRound };
  });
}

// Display order: me, then the members who count or are asked, then those who
// can't (a card already, an unrated tee), then the players outside the league.
const ORDER = { me: 0, counts: 1, asked: 2, hasCard: 3, unrated: 4, notMember: 5 };

// One row per player of the round:
//   kind 'me'        my own row (the screen puts my switch on it)
//        'counts'    another member whose card for this round exists
//        'asked'     another member, free this month: decides on their phone
//        'hasCard'   another member whose month is taken by another card
//        'unrated'   another member whose tee has no slope/rating
//        'notMember' not linked to an account, or not in the league
// `members` is [{ userId, hasCard, thisRound }] (membersFromMonth, or
// leagueStore.getLeagueGameStatus rows). `tournament`, when given, adds the
// cards recorded on the round (known offline too).
export function leagueCardRows({ players, userId, members, round, tournament = null }) {
  const byUser = new Map((members ?? []).filter((m) => m?.userId).map((m) => [m.userId, m]));
  const recorded = roundLeagueCards(tournament, round?.id);
  const rows = (players ?? []).map((p) => {
    const base = { playerId: p.id, name: p.name ?? '', userId: p.user_id ?? null };
    if (userId && p.user_id === userId) return { ...base, kind: 'me', isMe: true };
    const m = p.user_id ? byUser.get(p.user_id) : null;
    if (!m) return { ...base, kind: 'notMember' };
    if (m.thisRound || recorded.some((e) => e.playerId === p.id)) return { ...base, kind: 'counts' };
    if (m.hasCard) return { ...base, kind: 'hasCard' };
    if (round && !isLeagueRated(round, p.id)) {
      return { ...base, kind: 'unrated', tee: setupPlayerTee(round, p.id)?.label ?? null };
    }
    return { ...base, kind: 'asked' };
  });
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (ORDER[a.r.kind] - ORDER[b.r.kind]) || (a.i - b.i))
    .map(({ r }) => r);
}

// The list replaces the single switch once 2+ players of the game are in the
// league (me included); with only me it folds back to the switch.
export function showsLeagueList(rows) {
  return (rows ?? []).filter((r) => r.kind !== 'notMember').length >= 2;
}

// Can this round of this tournament be a league card at all? Not an official
// tournament (the server refuses 'official_round'), not a scramble (one ball
// per team, 'scramble_round'), and 18 holes (league_canonical_holes).
export function roundCanCount(tournament, round, { official = false } = {}) {
  if (official || !tournament || tournament.kind === 'official' || !round) return false;
  if (isScrambleMode(roundScoringMode(tournament, round))) return false;
  return isLeagueLength(round);
}

// Has my player any score in the round (the server's 'round_started')?
export function hasScoreIn(scores, playerId) {
  const mine = scores?.[playerId];
  return !!mine && Object.values(mine).some((v) => v != null && v !== '');
}

// The one-time "Count this round for <league>?" sheet on a member's phone.
// Returns { kind, league } with kind:
//   'none'      nothing to offer (not a member, a card already, round can't count…)
//   'offer'     show the sheet
//   'dismissed' I said "Not this round"; the strip offers "Count mine"
//   'tooLate'   I already scored in this round, so it can't be my card
// `leagues` are my leagues with a free month (leagueSetup.eligibleLeagues);
// `statusByLeague` is { [leagueId]: getLeagueGameStatus rows } for those I
// could read. A league is relevant only when another member plays the game.
export function leagueOptInState({
  tournament, round, meId, official = false, leagues, statusByLeague, scores, dismissed = false,
}) {
  const none = { kind: 'none', league: null };
  if (!meId || !roundCanCount(tournament, round, { official })) return none;
  if (leagueCardOf(tournament, meId, round.id)) return none;
  if (!isLeagueRated(round, meId)) return none;
  const league = (leagues ?? []).find((l) => {
    const rows = statusByLeague?.[l.id];
    if (!Array.isArray(rows)) return false;
    const me = rows.find((r) => r.isMe);
    if (!me || me.hasCard) return false;
    return rows.some((r) => !r.isMe);
  }) ?? null;
  if (!league) return none;
  if (hasScoreIn(scores, meId)) return { kind: dismissed ? 'none' : 'tooLate', league };
  return { kind: dismissed ? 'dismissed' : 'offer', league };
}

// The scorecard strip and LEAGUE chips. `playerIds` are the players whose card
// counts on this round (chips). Returns null when there is nothing to say.
//   kind 'cards'      "N league cards in this game: you and Javier"
//   'othersOnly'      "Marcos's card counts for the league." (+ Count mine)
//   'tooLate'         "You've already started this round…"
// `names` lists the counting players, "you" first as { me: true }.
export function leagueStripState({ tournament, round, meId, optIn = null }) {
  const cards = roundLeagueCards(tournament, round?.id);
  const players = tournament?.players ?? [];
  const ids = [];
  for (const e of cards) if (e.playerId && !ids.includes(e.playerId)) ids.push(e.playerId);
  const mine = !!meId && ids.includes(meId);
  const names = [
    ...(mine ? [{ me: true }] : []),
    ...ids.filter((id) => id !== meId).map((id) => ({ name: players.find((p) => p.id === id)?.name ?? '' })),
  ];
  const kind = optIn?.kind;
  if (kind === 'tooLate') return { kind: 'tooLate', playerIds: ids, names, count: ids.length, mine };
  if (ids.length === 0) return null;
  if (mine) return { kind: 'cards', playerIds: ids, names, count: ids.length, mine };
  return {
    kind: 'othersOnly', playerIds: ids, names, count: ids.length, mine, canOptIn: kind === 'dismissed',
  };
}

// "Javier", "you and Javier", "you, Javier and Carlos". `you` and `and` are
// the translated words.
export function listText(items, { you = 'you', and = 'and' } = {}) {
  const words = (items ?? []).map((x) => (x?.me ? you : (x?.name ?? ''))).filter(Boolean);
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${and} ${words[words.length - 1]}`;
}
