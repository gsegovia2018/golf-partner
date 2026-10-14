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

// The Europe/Madrid calendar day of an instant: { year, month (1-12), day },
// null for an invalid date. Same zone rule and fallback as cardMonth.
export function madridDay(dateOrIso) {
  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    if (year && month && day) return { year, month, day };
  } catch {
    // No timeZone support in this runtime: use the manual offset below.
  }
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  const t = date.getTime();
  const shifted = new Date(t + ((t >= start && t < end) ? 2 : 1) * 3600000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// Does this card use up its month? Every card does except a void one, and an
// admin's void still does (R15b, 20261016000000), as does a withdrawn card
// that was played anyway ('withdrawn_after_play'): only a withdrawal (by hand
// or the sweep's) and voids from before that migration (voidKind null) free it.
const MONTH_TAKING_VOIDS = ['admin', 'withdrawn_after_play'];
export function takesMonth(card) {
  if (!card) return false;
  return card.status !== 'void' || MONTH_TAKING_VOIDS.includes(card.voidKind);
}

// One card per member per month (see takesMonth). A card's `month` may be
// 'YYYY-MM' or a first-of-month date 'YYYY-MM-01'.
export function canAnnounce(cards, userId, month) {
  const taken = (cards ?? []).some((c) => c?.userId === userId
    && takesMonth(c)
    && String(c.month ?? '').slice(0, 7) === month);
  return taken ? { ok: false, reason: 'already_has_card' } : { ok: true };
}

// True when there was no announcement, or the first shot came before it.
export function isNotAnnounced(card) {
  if (!card?.announcedAt) return true;
  if (card.firstShotAt == null) return false;
  return new Date(card.firstShotAt).getTime() < new Date(card.announcedAt).getTime();
}

// A card must be posted within 8 hours of its tee time; a reminder goes out
// 2 hours before that. Plan: docs/superpowers/plans/2026-10-06-league-post-deadline.md
export const POST_WINDOW_HOURS = 8;
export const REMINDER_LEAD_HOURS = 2;
const HOUR_MS = 3600000;

const LIVE = ['announced', 'playing'];

// The post deadline for a tee time (Date), or null for no/invalid tee time.
export function postByFor(teeTime) {
  if (teeTime == null) return null;
  const t = new Date(teeTime).getTime();
  return Number.isNaN(t) ? null : new Date(t + POST_WINDOW_HOURS * HOUR_MS);
}

// Not posted in time: swept to 'missed', or still live past its deadline (the
// server sweep runs every 15 minutes, so the client doesn't wait for it).
export function isMissed(card, now = new Date()) {
  if (card?.status === 'missed') return true;
  if (!LIVE.includes(card?.status) || !card.postBy) return false;
  return new Date(now).getTime() >= new Date(card.postBy).getTime();
}

// An unannounced card, or one whose tee was entered by hand (not found in the
// course library, teeVerified false), scores nothing until an admin approves it.
export function needsApproval(card) {
  return (!!card?.notAnnounced || card?.teeVerified === false) && !card.approvedAt
    && (card.status === 'submitted' || card.status === 'confirmed');
}

// The countdown on a live card: { postBy: Date, msLeft, urgent } (urgent under
// 2 hours); null with no deadline or once the card isn't live.
export function deadlineInfo(card, now = new Date()) {
  if (!card?.postBy || !LIVE.includes(card.status)) return null;
  const postBy = new Date(card.postBy);
  if (Number.isNaN(postBy.getTime())) return null;
  const msLeft = postBy.getTime() - new Date(now).getTime();
  return { postBy, msLeft, urgent: msLeft < REMINDER_LEAD_HOURS * HOUR_MS };
}

// Integrity rules (docs/superpowers/plans/2026-10-13-league-review-followups.md,
// 20261016000000_league_integrity.sql). The server enforces every one; these
// let a screen say so before the round trip.
export const OFFAPP_NOTICE_HOURS = 2;    // R7: off-app tee time at least 2 h ahead
export const MIN_ROUND_HOURS = 3;        // R8: posted from tee time + 3 h
export const AUTO_WITHDRAW_HOURS = 24;   // R6: an unplayed app card goes 24 h after Start
export const RESUBMIT_HOURS = 24;        // R11: one resubmission within 24 h of a return
export const MONTH_CLOSE_DAYS = 3;       // R12: a month closes at the end of day 3 of the next
export const MAX_RESCHEDULES = 2;        // R7: an off-app card moves at most twice

const ms = (t) => (t == null ? NaN : new Date(t).getTime());
const plusHours = (t, h) => {
  const v = ms(t);
  return Number.isNaN(v) ? null : new Date(v + h * HOUR_MS);
};

// R7: the earliest tee time an off-app announcement (or a reschedule) accepts.
export function earliestOffAppTeeTime(now = new Date()) {
  return plusHours(now, OFFAPP_NOTICE_HOURS);
}

// R7: an announced off-app card can move while its tee time is >= 2 h away,
// at most MAX_RESCHEDULES times.
export function canReschedule(card, now = new Date()) {
  if (card?.source !== 'offapp' || card.status !== 'announced' || !card.teeTime) return false;
  if ((card.reschedules ?? 0) >= MAX_RESCHEDULES) return false;
  return ms(card.teeTime) - ms(now) >= OFFAPP_NOTICE_HOURS * HOUR_MS;
}

// R8: when an announced off-app card can first be posted (tee time + 3 h);
// null for any other card.
export function postOpensAt(card) {
  if (card?.source !== 'offapp' || card.status !== 'announced' || !card.teeTime) return null;
  return plusHours(card.teeTime, MIN_ROUND_HOURS);
}

// R9: the owner may withdraw a live card before its tee time (off-app) or
// before its first shot (app).
export function canWithdraw(card, now = new Date()) {
  if (!LIVE.includes(card?.status)) return false;
  if (card.source === 'offapp') return !!card.teeTime && ms(now) < ms(card.teeTime);
  return card.firstShotAt == null;
}

// R6: an app card with no first shot is withdrawn 24 h after Start; null once
// it has one (or for any other card).
export function autoWithdrawAt(card) {
  if (card?.source !== 'app' || !LIVE.includes(card.status) || card.firstShotAt != null || card.postBy) return null;
  return plusHours(card.announcedAt, AUTO_WITHDRAW_HOURS);
}

// R11: until when the owner may resubmit a card a marker sent back, when that
// matters (past post_by); null with no open return, or once the card has used
// its one post-return resubmission.
export function resubmitBy(card) {
  if (card?.status !== 'submitted' || !card.returnedAt || (card.returnedResubmits ?? 0) >= 1) return null;
  return plusHours(card.returnedAt, RESUBMIT_HOURS);
}

// Is an instant in Madrid summer time? Same rule as madridMonthManual: from
// the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC.
function madridOffsetHours(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1);
  return utcMs >= start && utcMs < end ? 2 : 1;
}

// R12: when a month's cards stop changing, as a Date: midnight (Madrid) at
// the start of day 4 of the next month. monthKey 'YYYY-MM' (or 'YYYY-MM-01').
// Never a DST changeover day (those are last Sundays), so one offset holds.
export function monthClosesAt(monthKey) {
  const m = /^(\d{4})-(\d{2})/.exec(String(monthKey ?? ''));
  if (!m) return null;
  const local = Date.UTC(Number(m[1]), Number(m[2]), MONTH_CLOSE_DAYS + 1);   // month index m[2] = the next month
  return new Date(local - madridOffsetHours(local - 2 * HOUR_MS) * HOUR_MS);
}

export function isMonthClosed(monthKey, now = new Date()) {
  const at = monthClosesAt(monthKey);
  return !!at && ms(now) >= at.getTime();
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
// The league ranks by net Stableford `points` (more is better). The net
// differential is secondary information:
//   adjustedGross   = sum of min(strokes, par + 2 + extra) (net double bogey,
//                     as handicapIndex.roundDifferential does)
//   differential    = round1((113 / slope) x (adjustedGross - rating))
//   netDifferential = round1(differential - leagueHandicap)
// Both are null when the tee is not rated (`rated` false) or the card is not
// a full 18 with a score on every hole. This is a preview only: the server
// scores the frozen card itself (league_card_score / league_card_differential
// in 20261015000000_league_server_scoring.sql, the same maths) and ignores
// the values the client sends, taking a library tee from course_tees.
// perHole: { n, strokes, extra, points, counted, capped } where counted =
// min(strokes, cap) and capped = strokes > cap.
export function scoreCard({ holes, course, leagueHandicap, tee }) {
  const courseHoles = [...(course?.holes ?? [])].sort((a, b) => a.number - b.number);
  const holeCount = holeCountOf(courseHoles);
  // The sum of the hole pars, as the server's league_card_score uses.
  const par = totalParFromHoles(courseHoles);
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
