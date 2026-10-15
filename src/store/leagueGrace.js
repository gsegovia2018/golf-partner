// The grace window: R12 keeps the previous month open until the end of day 3
// of the next one (Europe/Madrid), so for those days the board still owes the
// cards of that month that are not final. Pure helpers, no I/O. Plan:
// docs/superpowers/plans/2026-10-13-league-review-followups.md (R9-R12, R15b).
import {
  isMissed, needsApproval, isMonthClosed, monthClosesAt, resubmitBy,
} from './leagueRules';
import { currentMonthKey } from './leagueView';
import { cardScore, compareScores } from './leagueStandings';

const MINUTE_MS = 60000;

// 'YYYY-MM' of the month before `monthKey` (January -> December of last year).
export function previousMonthKey(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number);
  return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
}

// Where a card stands on its way to counting; null when it is final (confirmed
// and approved, void, or not posted in time). Order matters: a marker or a
// missing photo comes before an admin's approval, since the member can act on
// those. 'approval' is the admin's turn.
//   playing | announced   not posted yet
//   returned              the marker sent it back (resubmit within 24 h)
//   marker                an app card waiting for a named marker
//   noScan                an app card nobody has asked a marker to confirm
//   noProof               an off-app card without its photo
//   check                 an off-app card with its photo, waiting for the check
//   approval              waiting for an admin (not announced, or hand-entered tee)
export function pendingState(card, now = new Date()) {
  if (!card || card.status === 'void' || isMissed(card, now)) return null;
  if (card.status === 'announced' || card.status === 'playing') return card.status;
  if (card.status === 'confirmed') return needsApproval(card) ? 'approval' : null;
  if (card.status !== 'submitted') return null;
  if (card.returnedAt) return 'returned';
  if (card.source === 'offapp') {
    if (!card.proofPath) return 'noProof';
    return needsApproval(card) ? 'approval' : 'check';
  }
  if (card.markerName) return 'marker';
  return needsApproval(card) ? 'approval' : 'noScan';
}

// Why an admin has to approve: a hand-entered tee wins over "not announced"
// (same order as leagueView.cardStatus).
export const approvalReason = (card) => (card.teeVerified === false ? 'handTee' : 'notAnnounced');

// Best ranking value first for the league's format (Stableford points most
// first, medal to par fewest first); a card without one after.
const byScore = (format) => (a, b) => compareScores(cardScore(a.card, format), cardScore(b.card, format), format);

// The previous month while it is still open and has cards that are not final,
// else null. `snapshot` is what getLeague returns ({ league, members,
// cardsByMonth, cards }).
//   monthKey, closesAt  the month and the instant it closes (a Date)
//   pending             every non-final card of an active member, mine first:
//                       { card, userId, state, isMe, resubmitBy (Date|null) }
//   mine                my entry of `pending`, or null
//   toApprove           the entries waiting for an admin (admins only)
//   pendingOthersCount  pending cards that are neither mine nor in toApprove
export function graceMonth(snapshot, now = new Date(), meId = null) {
  if (!snapshot || snapshot.league?.archivedAt) return null;
  const monthKey = previousMonthKey(currentMonthKey(now));
  if (isMonthClosed(monthKey, now)) return null;
  const members = snapshot.members ?? [];
  const active = new Set(members.filter((m) => !m.leftAt).map((m) => m.userId));
  const isAdmin = members.some((m) => m.userId === meId && !m.leftAt && m.role === 'admin');

  const pending = [];
  for (const card of snapshot.cardsByMonth?.[monthKey] ?? []) {
    if (!active.has(card.userId)) continue;
    const state = pendingState(card, now);
    if (!state) continue;
    pending.push({
      card, userId: card.userId, state, isMe: card.userId === meId, resubmitBy: resubmitBy(card),
    });
  }
  if (pending.length === 0) return null;
  const byPoints = byScore(snapshot.league?.format);
  pending.sort((a, b) => (b.isMe - a.isMe) || byPoints(a, b));

  const mine = pending.find((p) => p.isMe) ?? null;
  // R10: an admin approves their own card only when no other admin exists.
  const otherAdmin = members.some((m) => m.userId !== meId && !m.leftAt && m.role === 'admin');
  const toApprove = isAdmin ? pending.filter((p) => needsApproval(p.card) && (!p.isMe || !otherAdmin)) : [];
  const shown = new Set(toApprove);
  const pendingOthersCount = pending.filter((p) => !p.isMe && !shown.has(p)).length;
  return {
    monthKey, closesAt: monthClosesAt(monthKey), pending, mine, toApprove, pendingOthersCount,
  };
}

// The last minute the month is open (23:59 Madrid on day 3), for the labels.
export function lastMinute(closesAt) {
  return closesAt ? new Date(closesAt.getTime() - MINUTE_MS) : null;
}
