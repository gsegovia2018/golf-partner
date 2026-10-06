// League rules: pure helpers (no I/O). Plan: docs/superpowers/plans/2026-10-04-league.md
import {
  calcPlayingHandicap, calcExtraShots, calcStablefordPoints, holeCountOf, totalParFromHoles,
} from './scoring';
import { isRatedTee, netDoubleBogeyCap, scoreDifferential } from './handicapIndex';

const MADRID = 'Europe/Madrid';

// Last Sunday of a month, as a UTC day-of-month.
function lastSunday(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

// Fallback for runtimes without timeZone support: CET (UTC+1), CEST (UTC+2)
// from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC.
export function madridMonthManual(date) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  const t = date.getTime();
  const shifted = new Date(t + ((t >= start && t < end) ? 2 : 1) * 3600000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 'YYYY-MM' of an instant in Europe/Madrid (the league's month boundary, D5).
export function cardMonth(dateOrIso) {
  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: MADRID, year: 'numeric', month: '2-digit' })
      .formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const year = get('year');
    const month = get('month');
    if (year && month) return `${year}-${month}`;
  } catch {
    // No timeZone support in this runtime: use the manual offset below.
  }
  return madridMonthManual(date);
}

// One live card per member per month; void cards don't count. A card's
// `month` may be 'YYYY-MM' or a first-of-month date 'YYYY-MM-01'.
export function canAnnounce(cards, userId, month) {
  const taken = (cards ?? []).some((c) => c?.userId === userId
    && c.status !== 'void'
    && String(c.month ?? '').slice(0, 7) === month);
  return taken ? { ok: false, reason: 'already_has_card' } : { ok: true };
}

// True when there was no announcement, or the first shot came before it.
export function isNotAnnounced(card) {
  if (!card?.announcedAt) return true;
  if (card.firstShotAt == null) return false;
  return new Date(card.firstShotAt).getTime() < new Date(card.announcedAt).getTime();
}

export function clampHandicap(value, cap = 30) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(n, cap);
}

const round1 = (n) => Math.round(n * 10) / 10;

// A league card's score, using the league handicap as the index. `holes` =
// { 1: strokes, ... }. `gender` is accepted by callers but the app's tee
// snapshots carry a single slope/rating, so it does not change the maths today.
//
// The league ranks by net differential (lower is better):
//   adjustedGross   = sum of min(strokes, par + 2 + extra) (net double bogey,
//                     as handicapIndex.roundDifferential does)
//   differential    = round1((113 / slope) x (adjustedGross - rating))
//   netDifferential = round1(differential - leagueHandicap)
// Both are null when the tee is not rated (`rated` false) or the card is not
// a full 18 with a score on every hole. Stableford `points` stay as
// secondary information. The server recomputes the net differential from
// the frozen card (league_card_differential), so this is for display.
// perHole: { n, strokes, extra, points, counted, capped } where counted =
// min(strokes, cap) and capped = strokes > cap.
export function scoreCard({ holes, course, leagueHandicap, tee }) {
  const courseHoles = [...(course?.holes ?? [])].sort((a, b) => a.number - b.number);
  const holeCount = holeCountOf(courseHoles);
  const par = tee?.par ?? totalParFromHoles(courseHoles);
  // No tee slope: calcPlayingHandicap returns round(leagueHandicap) (halved on 9 holes).
  const playingHandicap = calcPlayingHandicap(leagueHandicap, tee?.slope, tee?.rating, par, holeCount);
  const rated = isRatedTee(tee);

  let gross = 0;
  let points = 0;
  let adjustedGross = 0;
  const perHole = courseHoles.map((h) => {
    const strokes = Number(holes?.[h.number]) || 0;
    const extra = calcExtraShots(playingHandicap, h.strokeIndex, holeCount);
    const pts = calcStablefordPoints(h.par, strokes, playingHandicap, h.strokeIndex, holeCount);
    const cap = netDoubleBogeyCap(h.par, playingHandicap, h.strokeIndex, holeCount);
    const counted = Math.min(strokes, cap);
    gross += strokes;
    points += pts;
    adjustedGross += counted;
    return { n: h.number, strokes, extra, points: pts, counted, capped: strokes > cap };
  });

  const complete = courseHoles.length === 18 && perHole.every((h) => h.strokes > 0);
  const differential = rated && complete ? scoreDifferential(adjustedGross, tee.slope, tee.rating) : null;
  const index = parseFloat(leagueHandicap);
  const netDifferential = differential == null
    ? null
    : round1(differential - (Number.isFinite(index) ? index : 0));
  return {
    gross, points, playingHandicap, perHole, rated, adjustedGross, differential, netDifferential,
  };
}
