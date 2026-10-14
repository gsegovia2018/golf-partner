// League screens: presentational helpers (no I/O). Wording and number
// formats live here so the Play tab, board and members screens agree.
import {
  cardMonth, isMissed, needsApproval, deadlineInfo, takesMonth, canReschedule, canWithdraw, autoWithdrawAt,
  isMonthClosed, OFFAPP_NOTICE_HOURS, MAX_RESCHEDULES, POST_WINDOW_HOURS, madridDay,
} from './leagueRules';
import { seasonTable, monthResults } from './leagueStandings';
import { isRatedTee, netDoubleBogeyCap } from './handicapIndex';
import { calcExtraShots, calcStablefordPoints } from './scoring';
import { formatNumber, formatOrdinal, formatDate } from '../i18n';
import { splitVoidReason } from './leagueTimeline';

// 'YYYY-MM' (or 'YYYY-MM-01') -> 'October' / 'Oct' ('octubre' / 'oct'), in
// the language active when called (call it at render time).
export function monthName(key, short = false) {
  const k = String(key ?? '').slice(0, 7);
  const idx = Number(k.slice(5, 7)) - 1;
  if (!/^\d{4}-\d{2}$/.test(k) || idx < 0 || idx > 11) return '';
  return short ? formatDate(`${k}-01`, 'day').split(' ')[1] : formatDate(`${k}-01`, 'monthName');
}

export const ordinal = (n) => formatOrdinal(n);

// 2340 -> '2,340' / '2.340'; a shared tie can be fractional (233.3 / 233,3).
export function formatPoints(n) {
  const v = Number(n) || 0;
  return formatNumber(v, { decimals: Number.isInteger(v) ? 0 : 1 });
}

// A net differential in words (lower is better): -2.4 -> '2.4 better',
// 3.1 -> '3.1 worse', 0 -> 'level', null -> '—'.
export function formatNetDiff(n) {
  if (n == null || n === '') return '—';
  const v = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return 'level';
  return `${Math.abs(v).toFixed(1)} ${v < 0 ? 'better' : 'worse'}`;
}

// Which way a net differential points: 'better' (below 0), 'worse' (above 0)
// or null (level / unknown). Same rounding as formatNetDiff.
export function netDiffTone(n) {
  if (n == null || n === '') return null;
  const v = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(v) || v === 0) return null;
  return v < 0 ? 'better' : 'worse';
}

// The signed number behind the words: -2.4 -> '−2.4', 3.1 -> '+3.1', 0 -> '0.0'
// (Spanish: '−2,4').
export function formatNetDiffSigned(n) {
  const v = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(v)) return '—';
  const num = formatNumber(Math.abs(v), { decimals: 1 });
  if (v === 0) return num;
  return `${v < 0 ? '−' : '+'}${num}`;
}

// 3000 -> '30 €', 3050 -> '30,50 €'.
export function formatEuros(cents) {
  const c = Number(cents) || 0;
  const whole = Math.floor(c / 100);
  const rest = c % 100;
  return rest === 0 ? `${whole} €` : `${whole},${String(rest).padStart(2, '0')} €`;
}

// Pot = paid members x entry fee (tracking only, D7).
export function potCents(members, entryFeeCents) {
  const paid = (members ?? []).filter((m) => m.feePaid && !m.leftAt).length;
  return paid * (entryFeeCents ?? 0);
}

// The most recent month with a confirmed card: the one the "+245 Sep" deltas
// in the season table refer to (same rule as seasonTable).
export function lastScoredMonth(cardsByMonth) {
  return Object.keys(cardsByMonth ?? {}).sort().reverse()
    .find((m) => (cardsByMonth[m] ?? []).some((c) => c.status === 'confirmed' && !needsApproval(c))) ?? null;
}

// '+245 Sep' under a season row; '' when nothing scored yet or 0 earned.
export function deltaLabel(delta, month) {
  if (!month || !delta) return '';
  return `+${formatPoints(delta)} ${monthName(month, true)}`;
}

// "T2nd" for a tie, "4th" otherwise.
export const placeLabel = (place, isTie) => `${isTie ? 'T' : ''}${formatOrdinal(place)}`;

// League points as shown on the board: 135 -> '135', 111.67 -> '111.7'.
export const leaguePointsText = (n) => formatNumber(n, { maxDecimals: 1 });

// The places a tie group occupies: "2nd + 3rd" for two, "4th–6th" for more.
export function tiePlaces(place, size) {
  const first = formatOrdinal(place);
  const last = formatOrdinal(place + size - 1);
  return size === 2 ? `${first} + ${last}` : `${first}–${last}`;
}

// Why a ranked row's league points are what they are: who it shares the
// places with, and whether the participation floor lifted it. Message
// descriptors (see docs/i18n.md); takes a monthResults / monthBoard row.
export function rankNotes(row) {
  const notes = [];
  if (row?.isTie && row.tieSize > 1) {
    notes.push({ key: 'league.board.shares', params: { places: tiePlaces(row.place, row.tieSize) } });
  }
  if (row?.floored) notes.push({ key: 'league.board.forPlaying' });
  return notes;
}

// "4th of 18 · 1,045 league pts" for the Play tab row, as a message
// descriptor; null until anyone has a card.
export function positionMessage(table, userId, cardsByMonth) {
  if (!lastScoredMonth(cardsByMonth)) return null;
  const row = (table ?? []).find((r) => r.userId === userId);
  if (!row) return null;
  return {
    key: 'league.play.position',
    params: { place: placeLabel(row.place, row.isTie), total: table.length, points: leaguePointsText(row.total) },
  };
}

const STATUS_RANK = { confirmed: 0, submitted: 1, playing: 2, announced: 3, missed: 4 };

// "Announced · today 10:10" / "Announced · 4 Oct 10:10", as a descriptor.
function announcedMsg(iso, now) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'league.view.status.announced' };
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString()
    ? { key: 'league.view.status.announcedToday', params: { time } }
    : { key: 'league.view.status.announcedOn', params: { date: formatDate(d, 'day'), time } };
}

const V = (key, params) => (params ? { key: `league.view.${key}`, params } : { key: `league.view.${key}` });

// One member's line for the current month: { msg, tone, flag, lead, leadTone }.
// msg and flag are descriptors (render with tr()). tone: 'done' (counts),
// 'live' (in progress), 'muted' (no card, or not posted in time:
// `missed: true`). Live cards carry `deadline` (deadlineInfo). `lead` is the
// card's Stableford points ('38 pts'), the value the month ranks by, that
// `msg` starts with; leadTone is null (points carry no better/worse).
export function cardStatus(card, now = new Date()) {
  if (!card) return { msg: V('status.noCard'), tone: 'muted', flag: null };
  if (isMissed(card, now)) return { msg: V('status.notPosted'), tone: 'muted', flag: null, missed: true };
  let flag = card.notAnnounced ? V('flag.notAnnounced') : null;
  if (needsApproval(card)) {
    flag = card.teeVerified === false ? V('flag.handTee') : V('flag.awaitingApproval');
  }
  const offApp = card.source === 'offapp';
  const points = card.points != null ? formatPoints(card.points) : null;
  const lead = points != null ? `${points} pts` : null;
  switch (card.status) {
    case 'confirmed':
      if (lead == null) return { msg: V('status.unrated'), tone: 'muted', flag, lead: 'unrated', leadTone: null };
      return { msg: V('status.confirmed', { points }), tone: 'done', flag, lead, leadTone: null };
    case 'submitted': {
      const how = offApp ? 'status.addedAfter' : 'status.submitted';
      return { msg: lead ? V(`${how}Pts`, { points }) : V(how), tone: 'done', flag, lead, leadTone: null };
    }
    case 'playing':
      return { msg: V('status.playing'), tone: 'live', flag, deadline: deadlineInfo(card, now) };
    case 'announced':
      return { msg: announcedMsg(card.announcedAt, now), tone: 'live', flag, deadline: deadlineInfo(card, now) };
    default:
      return { msg: V('status.noCard'), tone: 'muted', flag: null };
  }
}

// Members with this month's card, best first: confirmed by Stableford points
// (most first, unscored after), then submitted, playing, announced, not posted, then nobody.
export function monthRows(members, cardsByMonth, month, now = new Date()) {
  const cards = cardsByMonth?.[month] ?? [];
  const rows = (members ?? []).filter((m) => !m.leftAt).map((m) => {
    const card = cards.find((c) => c.userId === m.userId && c.status !== 'void') ?? null;
    return { member: m, card, ...cardStatus(card, now) };
  });
  const rank = (r) => (r.card ? STATUS_RANK[r.card.status] ?? 4 : 5);
  const pts = (r) => (r.card?.points == null ? -Infinity : Number(r.card.points));
  return rows.sort((a, b) => rank(a) - rank(b) || (pts(a) === pts(b) ? 0 : pts(b) - pts(a)));
}

// The month's cards that can be opened read-only: scored (submitted or
// confirmed, so `holes` is set), never void. Same order as monthRows.
export function viewableCards(members, cardsByMonth, month) {
  return monthRows(members, cardsByMonth, month)
    .map((r) => r.card)
    .filter((c) => c && (c.status === 'confirmed' || c.status === 'submitted') && c.holes);
}

const HOW_CONFIRMED = new Set(['partner', 'marker', 'qr', 'photo', 'official']);

// Why a submitted card is not counting yet, as a descriptor.
function waitingReasonMsg(card) {
  if (card.markerName && card.source !== 'offapp') return V('waiting.marker', { name: card.markerName });
  if (card.source === 'offapp') return V(card.proofPath ? 'waiting.check' : 'waiting.photo');
  return V(card.returnedAt ? 'waiting.sentBack' : 'waiting.noScan');
}

// The month board, grouped for the board's month view. Only the confirmed
// group ranks, by Stableford points (most first); an unscored confirmed card
// is listed after the ranked ones with place null and `unrated: true`.
// `seasonPoints` is the table points the place earns if the month ended now
// (at least `participationPoints`). waiting = submitted, onCourse = playing or announced
// (playing first), noCard = active members with nothing this month.
// awaiting = scored cards (submitted or confirmed) of a not-announced round an
// admin hasn't approved: they don't rank. missed = not posted in time (a live
// card past its deadline counts), listed apart from onCourse and noCard.
// voided = no live card but a void one that still takes the month (pass them
// as options.voidCards; cardsByMonth leaves void out).
export function monthBoard(members, cardsByMonth, month, pointsTable, now = new Date(), { participationPoints = 0, voidCards = [] } = {}) {
  const active = (members ?? []).filter((m) => !m.leftAt);
  const cards = (cardsByMonth?.[month] ?? []).filter((c) => c.status !== 'void');
  // Most points first; a card without points after.
  const pts = (c) => (c.points == null ? -Infinity : Number(c.points));
  const byPoints = (a, b) => (pts(a) === pts(b) ? 0 : pts(b) - pts(a));
  const bestCard = (userId, ok) => cards.filter((c) => c.userId === userId && ok(c)).sort(byPoints)[0] ?? null;
  const confirmed = [];
  for (const r of monthResults(cards, active, pointsTable, { participationPoints })) {
    const member = (members ?? []).find((m) => m.userId === r.userId);
    if ((r.place == null && !r.unrated) || !member) continue;
    const card = bestCard(r.userId, (c) => c.status === 'confirmed' && !needsApproval(c));
    confirmed.push({
      member, card, place: r.place, isTie: r.isTie, unrated: !!r.unrated,
      netDifferential: r.netDifferential, cardPoints: r.cardPoints, seasonPoints: r.seasonPoints,
      tieSize: r.tieSize, floored: !!r.floored,
      howMsg: HOW_CONFIRMED.has(card.confirmation) ? V(`how.${card.confirmation}`) : null,
    });
  }
  const placed = new Set(confirmed.map((r) => r.member.userId));
  const waiting = [];
  const onCourse = [];
  const noCard = [];
  const awaiting = [];
  const missed = [];
  const voided = [];
  for (const member of active) {
    if (placed.has(member.userId)) continue;
    const card = bestCard(member.userId, () => true);
    if (card && needsApproval(card)) awaiting.push({ member, card });
    else if (card && isMissed(card, now)) missed.push({ member, card });
    else if (card?.status === 'submitted') waiting.push({ member, card, reasonMsg: waitingReasonMsg(card) });
    else if (card?.status === 'playing' || card?.status === 'announced') onCourse.push({ member, card });
    else {
      // An admin's void (or a played-after-withdraw card) still takes the month:
      // listed as voided, not as "no card yet".
      const v = (voidCards ?? []).find((c) => c.userId === member.userId && c.status === 'void'
        && (c.monthKey ?? String(c.month ?? '').slice(0, 7)) === month && takesMonth(c));
      if (v) voided.push({ member, card: v });
      else noCard.push(member);
    }
  }
  waiting.sort((a, b) => byPoints(a.card, b.card));
  onCourse.sort((a, b) => (a.card.status === 'playing' ? 0 : 1) - (b.card.status === 'playing' ? 0 : 1));
  return { confirmed, waiting, onCourse, noCard, awaiting, missed, voided };
}

// Days left in the league's month (Europe/Madrid, like currentMonthKey), for
// the "27 days left" caption.
export function daysLeftInMonth(now = new Date()) {
  const d = madridDay(now);
  if (!d) return 0;
  return new Date(Date.UTC(d.year, d.month, 0)).getUTCDate() - d.day;
}

export function currentMonthKey(now = new Date()) {
  return cardMonth(now);
}

// A member's name as shown: their own name (a string), or a descriptor for
// "You" / "Golfer" / "Former member". Screens use lib/leagueNames (text);
// stores put it in descriptor params, rendered nested (leagueStats).
export function memberNameMsg(members, userId, meId) {
  const m = (members ?? []).find((x) => x.userId === userId);
  if (!m) return V('formerMember');
  if (m.userId === meId) return V('you');
  return m.displayName || m.username || V('golfer');
}

// Votes needed to pass: ceil(2/3 of active members), decision D2. Display
// only; the server decides.
// The delete sheet's guard: the typed text must be the league's name, ignoring
// case and runs of spaces.
export function leagueNameMatches(typed, name) {
  const norm = (x) => String(x ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(name).length > 0 && norm(typed) === norm(name);
}

export function voteThreshold(activeMemberCount) {
  return Math.ceil((activeMemberCount * 2) / 3);
}

// 'Javi Ortega' -> 'Javi'.
export function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

// 'Nacho Pérez' -> 'NP'; one word -> its first letter. '?' when empty.
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const pair = parts.length === 1 ? parts[0][0] : parts[0][0] + parts[parts.length - 1][0];
  return pair.toUpperCase();
}

// "Asked 2 min ago · until 19 Oct" for a pending marker request. No pronouns.
// A list of descriptors: render each with tr() and join them with ' · '.
export function markerAskedLine(requestedAt, expiresAt, now = new Date()) {
  const parts = [];
  const asked = new Date(requestedAt);
  if (requestedAt && !Number.isNaN(asked.getTime())) {
    const mins = Math.max(0, Math.floor((now.getTime() - asked.getTime()) / 60000));
    parts.push(mins < 1 ? V('asked.justNow') : mins < 60 ? V('asked.minutes', { count: mins })
      : mins < 1440 ? V('asked.hours', { count: Math.floor(mins / 60) }) : V('asked.days', { count: Math.floor(mins / 1440) }));
  }
  const until = new Date(expiresAt);
  if (expiresAt && !Number.isNaN(until.getTime())) parts.push(V('asked.until', { date: formatDate(until, 'day') }));
  return parts;
}

// The "Your <Month> card" block: what state my card is in and what it shows.
// kind: 'none' | 'announced' | 'playing' | 'submitted' | 'confirmed' | 'voided'
// A withdrawn card (or a void from before voidKind) is 'none': the month is
// free. An admin's void, or a withdrawn card that was played anyway, keeps the
// month taken (R15b), so the board shows that card instead of offering Announce.
export function yourCardState(card) {
  if (!card) return { kind: 'none' };
  if (card.status === 'void') {
    if (!takesMonth(card)) return { kind: 'none' };
    return {
      kind: 'voided',
      voidKind: card.voidKind,
      course: card.course?.name ?? null,
      pts: card.points != null ? { key: 'league.scoring.pts', params: { points: formatPoints(card.points) } } : null,
      reason: card.voidedReason ?? null,
      card,
    };
  }
  const course = card.course?.name ?? null;
  // Message descriptor (render with tr()).
  const pts = card.points != null ? { key: 'league.scoring.pts', params: { points: formatPoints(card.points) } } : null;
  const hasNet = card.netDifferential != null;
  return {
    kind: card.status,
    course,
    pts,
    // Secondary information since the league ranks by points.
    net: hasNet ? formatNetDiff(card.netDifferential) : null,
    netTone: hasNet ? netDiffTone(card.netDifferential) : null,
    unrated: card.status === 'confirmed' && pts == null,
    // Asked a signed-in marker who hasn't answered yet (submitted app cards only).
    waitingFor: card.status === 'submitted' && card.markerName && card.source !== 'offapp' ? firstName(card.markerName) : null,
    offApp: card.source === 'offapp',
    card,
  };
}

// My card of a month for the board: the live one, else a void one that still
// takes the month (so the board shows it and does not offer Announce).
export function myMonthCard(cardsByMonth, cards, month, userId) {
  const live = (cardsByMonth?.[month] ?? []).find((c) => c.userId === userId);
  if (live) return live;
  return (cards ?? []).find((c) => c.userId === userId && c.monthKey === month && c.status === 'void' && takesMonth(c)) ?? null;
}

// The cards the card screen flicks through for a month: the board's live cards
// (same order), then void cards that still take the month (admin voids and
// withdrawn-after-play), then the viewer's own withdrawn card (so they see the
// outcome and "Announce another card"). One card per member: a live card hides
// that member's void ones.
export function monthCardsView(snapshot, month, viewerId, now = new Date()) {
  const { members, cardsByMonth, cards } = snapshot ?? {};
  const live = monthRows(members, cardsByMonth, month, now).map((r) => r.card).filter(Boolean);
  const seen = new Set(live.map((c) => c.userId));
  const active = new Set((members ?? []).filter((m) => !m.leftAt).map((m) => m.userId));
  const extra = [];
  for (const c of cards ?? []) {
    if (c.status !== 'void' || c.monthKey !== month || seen.has(c.userId) || !active.has(c.userId)) continue;
    const own = c.userId === viewerId && (c.voidKind === 'withdrawn' || c.voidKind === 'auto_withdrawn');
    if (!takesMonth(c) && !own) continue;
    seen.add(c.userId);
    extra.push(c);
  }
  return [...live, ...extra];
}

// Why a void card is void, as a message for the card screen and the board.
export function voidedNote(card, { isOwner, who }) {
  const { reason, note } = splitVoidReason(card.voidedReason);
  const params = { monthKey: card.monthKey ?? String(card.month ?? '').slice(0, 7), name: who, reason: reason ?? note };
  switch (card.voidKind) {
    case 'withdrawn':
      return { key: isOwner ? 'league.void.withdrawnYou' : 'league.void.withdrawnOther', params };
    case 'auto_withdrawn':
      return { key: isOwner ? 'league.void.autoYou' : 'league.void.autoOther', params };
    case 'withdrawn_after_play':
      return { key: 'league.void.afterPlay', params };
    default:
      return { key: params.reason ? 'league.void.adminReason' : 'league.void.admin', params };
  }
}

// The reasons an admin can pick when voiding a card.
export const VOID_REASONS = [
  { id: 'wrongTee', key: 'league.void.reason.wrongTee' },
  { id: 'scoreMismatch', key: 'league.void.reason.scoreMismatch' },
  { id: 'notEighteen', key: 'league.void.reason.notEighteen' },
  { id: 'notConfirmed', key: 'league.void.reason.notConfirmed' },
  { id: 'other', key: 'league.void.reason.other' },
];

// What goes to void_league_card: the reason's text, plus ": <note>" when the
// admin wrote one. The timeline splits it again (leagueTimeline).
export function voidReasonText(reasonLabel, note) {
  const n = String(note ?? '').trim();
  return n ? `${reasonLabel}: ${n}` : reasonLabel;
}

// The ⋯ "Card actions" menu of a card screen. viewer = { isOwner, isAdmin,
// otherAdmin } (otherAdmin: another active admin exists; an admin acts on their
// own card only without one: R10). Each item says its deadline or consequence;
// a disabled one says why. `when(date)` formats an instant for the text (the
// screen passes a localised one) and `clock(date)` an instant's time of day. Returns [] when there is nothing to offer,
// so the screen hides the button.
export function cardActions(card, viewer, league, now = new Date(), { when = (d) => d.toISOString(), clock = (d) => d.toISOString().slice(11, 16) } = {}) {
  if (!card || card.status === 'void' || league?.archivedAt) return [];
  const { isOwner, isAdmin, otherAdmin } = viewer ?? {};
  const monthKey = String(card.monthKey ?? card.month ?? '').slice(0, 7);
  const closed = monthKey ? isMonthClosed(monthKey, now) : false;
  const closedMsg = { key: 'league.actions.monthClosed', params: { monthKey } };
  const items = [];
  const nowMs = new Date(now).getTime();
  const teeMs = card.teeTime ? new Date(card.teeTime).getTime() : NaN;
  const live = card.status === 'announced' || card.status === 'playing';

  if (isOwner && card.source === 'offapp' && card.status === 'announced') {
    const enabled = canReschedule(card, now) && !closed;
    let sub;
    if (closed) sub = closedMsg;
    else if (nowMs >= teeMs) sub = { key: 'league.actions.reschedule.passed' };
    else if ((card.reschedules ?? 0) >= MAX_RESCHEDULES) sub = { key: 'league.actions.reschedule.limit', params: { count: MAX_RESCHEDULES } };
    else if (!enabled) sub = { key: 'league.actions.reschedule.tooClose', params: { hours: OFFAPP_NOTICE_HOURS } };
    else {
      sub = {
        key: 'league.actions.reschedule.until',
        params: {
          until: when(new Date(teeMs - OFFAPP_NOTICE_HOURS * 3600000)),
          hours: OFFAPP_NOTICE_HOURS,
          count: MAX_RESCHEDULES - (card.reschedules ?? 0),
        },
      };
    }
    items.push({ kind: 'reschedule', icon: 'edit-2', title: { key: 'league.actions.reschedule.title' }, sub, enabled });
  }

  if (isOwner && live) {
    const can = canWithdraw(card, now) && !closed;
    let sub;
    if (closed) sub = closedMsg;
    else if (can) sub = { key: 'league.actions.withdraw.sub', params: { monthKey } };
    else if (card.source === 'offapp') sub = { key: 'league.actions.withdraw.teePassed', params: { time: clock(new Date(card.teeTime)) } };
    else sub = { key: 'league.actions.withdraw.started' };
    items.push({ kind: 'withdraw', icon: 'log-out', title: { key: 'league.actions.withdraw.title' }, sub, enabled: can, tone: 'danger' });
  }

  // Admins: their own card only while they are the only admin.
  if (isAdmin && (!isOwner || !otherAdmin)) {
    items.push({
      kind: 'void', icon: 'slash', title: { key: 'league.actions.void.title' },
      sub: closed ? closedMsg : { key: 'league.actions.void.sub' }, enabled: !closed, tone: 'danger',
    });
    const missed = isMissed(card, now);
    // reopen_league_card refuses a card of an earlier month (past_month),
    // even while that month is still open for the rest (R12).
    const pastMonth = !!monthKey && monthKey < currentMonthKey(now);
    let reopenSub;
    if (closed) reopenSub = closedMsg;
    else if (!missed) reopenSub = { key: 'league.actions.reopen.notMissed' };
    else if (pastMonth) reopenSub = { key: 'league.actions.reopen.pastMonth', params: { monthKey } };
    else reopenSub = { key: 'league.actions.reopen.sub', params: { hours: POST_WINDOW_HOURS } };
    items.push({
      kind: 'reopen', icon: 'rotate-ccw', title: { key: 'league.actions.reopen.title' },
      sub: reopenSub,
      enabled: missed && !closed && !pastMonth,
    });
    if (needsApproval(card)) {
      items.push({
        kind: 'approve', icon: 'user-check', title: { key: 'league.actions.approve.title' },
        sub: closed ? closedMsg : { key: 'league.actions.approve.sub', params: { monthKey } }, enabled: !closed,
      });
    }
  }
  return items;
}

// An app card with no first shot is withdrawn automatically; the withdraw
// sheet says when. null for any other card.
export function autoWithdrawNote(card, when = (d) => d.toISOString()) {
  const at = autoWithdrawAt(card);
  return at ? { key: 'league.actions.withdraw.auto', params: { at: when(at) } } : null;
}

// Has my league round every hole scored? true / false, or null when this
// device can't tell (game not loaded, no player of mine in it): callers then
// treat the card as ready, since Validate guards an incomplete card itself.
// `playerId` is the card's own player (R16: any member's card, any round);
// without it, my linked player, then the legacy single link's.
export function myRoundScored(tournament, roundId, userId, playerId = null) {
  const round = tournament?.rounds?.find((r) => r.id === roundId);
  if (!round || !round.holes?.length) return null;
  const players = tournament.players ?? [];
  const lg = tournament.league ?? tournament.props?.league ?? null;
  const me = (playerId ? players.find((p) => p.id === playerId) : null)
    ?? players.find((p) => p.user_id && p.user_id === userId)
    ?? players.find((p) => p.id === lg?.playerId);
  if (!me) return null;
  return round.holes.every((h) => {
    const v = round.scores?.[me.id]?.[h.number];
    return v != null && v !== '';
  });
}

// My standing in one month of a league snapshot: { place, isTie, of, points,
// seasonPoints, floored } for my counting card, or null when I have none.
// `of` = the cards that rank that month.
export function monthStanding({ league, members, cardsByMonth }, month, userId, now = new Date()) {
  const board = monthBoard(members, cardsByMonth, month, league.pointsTable, now,
    { participationPoints: league.participationPoints });
  const ranked = board.confirmed.filter((r) => r.place != null);
  const row = ranked.find((r) => r.member.userId === userId);
  if (!row) return null;
  return {
    place: row.place, isTie: row.isTie, of: ranked.length, points: row.cardPoints,
    seasonPoints: row.seasonPoints, floored: row.floored,
  };
}

// The card screen's two cells under the Stableford headline: my place, and
// what it pays in league points. `current` = the month is still open
// (places can move, points are "if it ended today").
export function standingCells(standing, { month, current }) {
  return {
    place: placeLabel(standing.place, standing.isTie),
    placeNote: current
      ? { key: 'league.card.soFarIn', params: { monthKey: month } }
      : { key: 'league.card.ofCards', params: { count: standing.of } },
    lp: `+${leaguePointsText(standing.seasonPoints)}`,
    lpNote: standing.floored ? { key: 'league.card.forPlaying' }
      : { key: current ? 'league.card.ifEndedToday' : 'league.card.leaguePts' },
  };
}

// The second, muted line of the Play tab row: where my card for the open
// month stands. Message descriptor, null for an archived league.
export function monthLine(snapshot, userId, now = new Date()) {
  if (snapshot.league.archivedAt) return null;
  const monthKey = currentMonthKey(now);
  const card = (snapshot.cardsByMonth?.[monthKey] ?? []).find((c) => c.userId === userId && c.status !== 'void') ?? null;
  const left = daysLeftInMonth(now);
  if (!card) {
    return left === 0
      ? { key: 'league.play.monthNoneLast', params: { monthKey } }
      : { key: 'league.play.monthNone', params: { monthKey, count: left } };
  }
  if (isMissed(card, now)) return { key: 'league.play.monthMissed', params: { monthKey } };
  const standing = monthStanding(snapshot, monthKey, userId, now);
  if (!standing) return { key: 'league.play.monthLive', params: { monthKey } };
  return {
    key: 'league.play.monthRank',
    params: { monthKey, points: formatNumber(standing.points), place: placeLabel(standing.place, standing.isTie) },
  };
}

// What the participation floor pays, for the rules screens: a row per place
// of the table (lifted to the floor), then the places past the table. With
// `count` (the members) the range is closed ("13th–18th"); without, open
// ("13th on"). Items: { label, points } or { gap: true }; `rest` is the floor
// range; `zero` is true when the floor is 0 (playing past the table pays
// nothing). null for an invalid table.
export function payoutPreview(pointsTable, floor, count = null) {
  if (!Array.isArray(pointsTable) || pointsTable.length === 0) return null;
  const f = Math.max(0, Number(floor) || 0);
  const shown = (count != null && count < pointsTable.length ? pointsTable.slice(0, count) : pointsTable)
    .map((v) => Math.max(Number(v) || 0, f));
  const item = (i) => ({ label: formatOrdinal(i + 1), points: formatNumber(shown[i]) });
  const items = shown.length <= 3
    ? shown.map((_, i) => item(i))
    : [item(0), item(1), { gap: true }, item(shown.length - 1)];
  let rest = null;
  const start = pointsTable.length + 1;
  if (count == null || count >= start) {
    const label = count == null ? { open: formatOrdinal(start) }
      : { from: formatOrdinal(start), to: formatOrdinal(count), single: count === start };
    rest = { ...label, points: formatNumber(f) };
  }
  return { items, rest, zero: f === 0 && !!rest };
}

// Participation points stepper: step 5, never below 0.
export const PARTICIPATION_STEP = 5;
export const stepParticipation = (value, direction) => Math.max(0, (Number(value) || 0) + direction * PARTICIPATION_STEP);

// Season table + position + month line for one league snapshot (the shape
// leagueStore.getLeague returns and caches).
export function leagueSummary(snapshot, meId, now = new Date()) {
  const { league, members, cardsByMonth } = snapshot;
  const table = seasonTable((members ?? []).filter((m) => !m.leftAt), cardsByMonth, league.pointsTable,
    { participationPoints: league.participationPoints });
  const position = positionMessage(table, meId, cardsByMonth);
  return { table, position, month: position ? monthLine(snapshot, meId, now) : null };
}

// Season table on a long league: the top `top` rows, then a gap and my row
// with its neighbours when I'm further down. Rows past `top` are marked
// compact either way. Short tables (up to top + 3) come back whole.
export function collapseSeasonRows(rows, { top = 8, expanded = false } = {}) {
  const list = (rows ?? []).map((r, i) => (i >= top ? { ...r, compact: true } : r));
  if (expanded || list.length <= top + 3) return { rows: list, hidden: 0 };
  const me = list.findIndex((r) => r.isMe);
  const keep = new Set(list.map((_, i) => i).filter((i) => i < top || (me >= top && Math.abs(i - me) <= 1)));
  const out = [];
  list.forEach((r, i) => {
    if (!keep.has(i)) return;
    if (i > 0 && !keep.has(i - 1)) out.push({ key: `gap-${i}`, gap: true });
    out.push(r);
  });
  return { rows: out, hidden: list.length - keep.size };
}

// Step-by-step for the card viewer's "How it's worked out": gross, adjusted
// gross (holes capped at net double bogey), differential, league handicap, net.
// Works off the frozen card: its course snapshot, strokes and playing handicap
// (what the server's league_card_differential reads), and the stored
// differential / netDifferential. perHole: { n, strokes, points, counted, capped }.
export function cardBreakdown(card) {
  const snap = card?.course ?? {};
  const holes = [...(snap.holes ?? [])].sort((a, b) => a.n - b.n);
  const ph = card?.playingHandicap ?? 0;
  const perHole = holes.map((h) => {
    const strokes = Number(card?.holes?.[String(h.n)]) || 0;
    const cap = netDoubleBogeyCap(h.par, ph, h.si, holes.length);
    return {
      n: h.n,
      strokes,
      points: calcStablefordPoints(h.par, strokes, ph, h.si, holes.length),
      extra: calcExtraShots(ph, h.si, holes.length),
      counted: Math.min(strokes, cap),
      capped: strokes > cap,
    };
  });
  const gross = perHole.reduce((a, h) => a + h.strokes, 0);
  const adjustedGross = perHole.reduce((a, h) => a + h.counted, 0);
  return {
    perHole,
    gross,
    adjustedGross,
    capped: perHole.filter((h) => h.capped),
    rated: isRatedTee({ slope: snap.slope, rating: snap.rating }) && card?.netDifferential != null,
    slope: snap.slope ?? null,
    rating: snap.rating ?? null,
    differential: card?.differential ?? null,
    netDifferential: card?.netDifferential ?? null,
    leagueHandicap: card?.leagueHandicap ?? null,
  };
}
