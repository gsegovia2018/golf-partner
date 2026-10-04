// League play in the app (plan docs/superpowers/plans/2026-10-04-league.md
// §4.3 Setup/Scorecard, build item P6). Pure helpers, no I/O: which leagues
// the Setup switch offers, the strokes the round will give me, and the round
// and course shapes Start writes.
import { deriveRoundPlayingHandicap, holeCountOf, totalParFromHoles } from './scoring';
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

// Leagues the Setup switch can offer right now: not archived, today inside the
// season, and no live card of mine this month. `cards` are my cards (any
// league) as rowToCard returns them.
export function eligibleLeagues({ leagues, cards, userId, now = new Date() }) {
  if (!userId) return [];
  const month = cardMonth(now);
  const today = madridDate(now);
  return (leagues ?? []).filter((l) => {
    if (!l || l.archivedAt) return false;
    if (l.seasonStart && today < String(l.seasonStart).slice(0, 10)) return false;
    if (l.seasonEnd && today > String(l.seasonEnd).slice(0, 10)) return false;
    const mine = (cards ?? []).filter((c) => c.leagueId === l.id);
    return canAnnounce(mine, userId, month).ok;
  });
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

// The course snapshot announce_league_card stores: {name, tee, holes:[{n,par,si}]}.
export function leagueCourse(round, playerId) {
  const tee = round?.playerTees?.[playerId] ?? setupPlayerTee(round, playerId);
  return {
    name: String(round?.courseName ?? '').trim(),
    tee: tee?.label ?? null,
    par: totalParFromHoles(round?.holes),
    holes: (round?.holes ?? []).map((h) => ({ n: h.number, par: h.par, si: h.strokeIndex })),
  };
}

// The league link on a tournament: Setup writes `league` (the repo files
// extra keys under props, and get_game_tournament spreads props back onto the
// object). Only the card owner's player gets it; a partner's phone sees null.
export function leagueCardOf(tournament, meId) {
  const lg = tournament?.league ?? tournament?.props?.league ?? null;
  if (!lg?.cardId) return null;
  if (lg.playerId && lg.playerId !== meId) return null;
  return lg;
}
