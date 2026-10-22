// League play in the app (plan docs/superpowers/plans/2026-10-04-league.md
// §4.3 Setup/Scorecard, build item P6). Pure helpers, no I/O: which leagues
// the Setup switch offers, the strokes the round will give me, and the round
// and course shapes Start writes.
import {
  deriveRoundPlayingHandicap, holeCountOf, resolveRoundTee, totalParFromHoles,
} from './scoring';
import { isRatedTee } from './handicapIndex';
import { middleTee } from './tees';
import { canAnnounce, cardMonth } from './leagueRules';

// 'YYYY-MM-DD' of an instant in Europe/Madrid (the league's calendar, D5).
export function madridDate(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    if (get('year') && get('month') && get('day')) return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    // No timeZone support: fall through to UTC, at worst a day off at midnight.
  }
  return now.toISOString().slice(0, 10);
}

// Where today (Europe/Madrid) falls against a league's season: 'before' its
// first day, 'after' its last, or null inside it.
export function seasonPhase(league, now = new Date()) {
  const today = madridDate(now);
  if (league?.seasonStart && today < String(league.seasonStart).slice(0, 10)) return 'before';
  if (league?.seasonEnd && today > String(league.seasonEnd).slice(0, 10)) return 'after';
  return null;
}

// Leagues the Setup switch can offer right now: not archived, today inside the
// season, and no card of mine this month that takes the month (an admin's
// void still does, R15b). `cards` are my cards (any league) as rowToCard
// returns them.
export function eligibleLeagues({ leagues, cards, userId, now = new Date() }) {
  if (!userId) return [];
  const month = cardMonth(now);
  return (leagues ?? []).filter((l) => {
    if (!l || l.archivedAt) return false;
    if (seasonPhase(l, now)) return false;
    const mine = (cards ?? []).filter((c) => c.leagueId === l.id);
    return canAnnounce(mine, userId, month).ok;
  });
}

// The board's "Play with the app" preselects a league; once the eligible list
// has loaded without it (a card this month already, out of season…), Setup
// turns the switch off rather than switching another league on. Not while
// loading or after a failed read: a retry may still bring it.
export function preselectedLeagueMissing({ leagues, pickId, loading = false, error = false }) {
  if (!pickId || loading || error) return false;
  return !(leagues ?? []).some((l) => l?.id === pickId);
}

// My tee in a setup round: the one picked on the Tees step, else the middle
// tee Start would default to (SetupScreen.handleStart does the same).
export function setupPlayerTee(round, playerId) {
  const picked = round?.playerTees?.[playerId];
  if (picked) return picked;
  const tee = middleTee(round?.tees);
  return tee ? { label: tee.label, slope: tee.slope, rating: tee.rating } : null;
}

// Strokes the round gives me off my league handicap, with the same maths the
// scorecard uses (deriveRoundPlayingHandicap on my tee).
export function leagueStrokes(round, playerId, leagueHandicap) {
  const tee = setupPlayerTee(round, playerId);
  const withTee = { ...round, playerTees: tee ? { ...(round?.playerTees ?? {}), [playerId]: tee } : round?.playerTees };
  return deriveRoundPlayingHandicap(leagueHandicap, withTee, playerId);
}

// League cards are 18 holes (league_canonical_holes refuses anything else).
export function isLeagueLength(round) {
  return Array.isArray(round?.holes) && round.holes.length === 18 && holeCountOf(round) === 18;
}

// The tee my league card would be played off: the setup tee (picked or the
// default middle one), else the round-level slope/rating of a legacy round.
function leagueTee(round, playerId) {
  return setupPlayerTee(round, playerId) ?? resolveRoundTee(round, playerId);
}

// The server scores a league card from my league handicap on a rated tee (R3,
// R4): my tee needs a slope and a course rating, or the card is refused.
export function isLeagueRated(round, playerId) {
  return isRatedTee(leagueTee(round, playerId));
}

// A built round (handleStart's shape, playerTees resolved) with my league
// handicap as the per-round index override and my playing handicap re-derived
// from it. Never manual: the league maths is the point.
export function applyLeagueHandicap(round, playerId, leagueHandicap) {
  const index = Number(leagueHandicap);
  const next = { ...round, playerIndexes: { ...(round.playerIndexes ?? {}), [playerId]: index } };
  return {
    ...next,
    playerHandicaps: {
      ...(round.playerHandicaps ?? {}),
      [playerId]: deriveRoundPlayingHandicap(index, next, playerId),
    },
    manualHandicaps: { ...(round.manualHandicaps ?? {}), [playerId]: false },
  };
}

// The course snapshot announce_league_card stores:
// {course_id, name, tee, slope, rating, par, holes:[{n,par,si}]}. The server
// scores the card from it; with a library course_id it takes the tee's
// slope/rating/par/holes from the library instead (tee_verified).
export function leagueCourse(round, playerId) {
  const tee = round?.playerTees?.[playerId] ?? setupPlayerTee(round, playerId);
  const { slope, rating } = tee ?? resolveRoundTee(round, playerId);
  return {
    course_id: round?.courseId ?? null,
    name: String(round?.courseName ?? '').trim(),
    tee: tee?.label ?? null,
    slope: slope ?? null,
    rating: rating ?? null,
    par: totalParFromHoles(round?.holes),
    holes: (round?.holes ?? []).map((h) => ({ n: h.number, par: h.par, si: h.strokeIndex })),
  };
}

// The league links on a tournament (the repo files extra keys under props,
// and get_game_tournament spreads props back onto the object):
// - `league` — { leagueId, cardId, playerId }: the one card Setup's Start
//   announced, for round 0 (builds before 20261016000000).
// - `leagueCards` — { '<roundId>:<playerId>': { leagueId, cardId, playerId,
//   roundId } }: every member's own card, any round (R16, R17). Each phone
//   adds only its own key; tournament.updateProfile (and the server's
//   patch_game_tournament) merge an object one level deep, so two phones
//   adding their keys at once never drop each other's.
export function leagueCardKey(roundId, playerId) {
  return `${roundId}:${playerId}`;
}

// Every league link on the tournament, legacy `league` first (its roundId is
// round 0's).
export function leagueCardsOf(tournament) {
  const out = [];
  const legacy = tournament?.league ?? tournament?.props?.league ?? null;
  if (legacy?.cardId) {
    out.push({ ...legacy, roundId: legacy.roundId ?? tournament?.rounds?.[0]?.id ?? null });
  }
  const map = tournament?.leagueCards ?? tournament?.props?.leagueCards ?? null;
  for (const entry of Object.values(map ?? {})) {
    if (entry?.cardId && !out.some((e) => e.cardId === entry.cardId)) out.push(entry);
  }
  return out;
}

// My league link on this tournament: the card of my player, for `roundId`
// when given (else the first one found). A partner's phone sees null.
export function leagueCardOf(tournament, meId, roundId = null) {
  const lg = tournament?.league ?? tournament?.props?.league ?? null;
  const legacyMine = lg?.cardId && (!lg.playerId || lg.playerId === meId);
  // Same object as before for a tournament with only the legacy link.
  if (legacyMine && !(tournament?.leagueCards ?? tournament?.props?.leagueCards)
      && (roundId == null || roundId === (lg.roundId ?? tournament?.rounds?.[0]?.id))) {
    return lg;
  }
  return leagueCardsOf(tournament).find((e) => (!e.playerId || e.playerId === meId)
    && (roundId == null || e.roundId === roundId)) ?? null;
}

// A league card plays off the league handicap only, on the tee it was
// announced with. The players of `round` holding a league card, as
// RoundTeeAssignments' leagueLocks: { [playerId]: { leagueHandicap, teeLocked } }.
// The handicap is the one Start (or the opt-in) froze on the round as the
// per-round index (applyLeagueHandicap); null if the round lacks it.
export function leagueLocksForRound(tournament, round) {
  const locks = {};
  if (!round?.id) return locks;
  for (const e of leagueCardsOf(tournament)) {
    if (e.roundId !== round.id || !e.playerId) continue;
    const index = parseFloat(round.playerIndexes?.[e.playerId]);
    locks[e.playerId] = { leagueHandicap: Number.isFinite(index) ? index : null, teeLocked: true };
  }
  return locks;
}

// The patch for tournament.updateProfile that records my card on a round:
// { leagueCards: { '<roundId>:<playerId>': entry } } (merged, see above).
export function leagueCardsPatch({ leagueId, cardId, playerId, roundId }) {
  return { leagueCards: { [leagueCardKey(roundId, playerId)]: { leagueId, cardId, playerId, roundId } } };
}
