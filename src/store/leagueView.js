// League screens: presentational helpers (no I/O). Wording and number
// formats live here so the Play tab, board and members screens agree.
import { cardMonth } from './leagueRules';
import { seasonTable, monthResults } from './leagueStandings';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// 'YYYY-MM' (or 'YYYY-MM-01') -> 'October' / 'Oct'.
export function monthName(key, short = false) {
  const idx = Number(String(key ?? '').slice(5, 7)) - 1;
  const name = MONTHS[idx];
  if (!name) return '';
  return short ? name.slice(0, 3) : name;
}

export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
}

// 2340 -> '2,340'; a shared tie can be fractional (233.3).
export function formatPoints(n) {
  const v = Number(n) || 0;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
    .find((m) => (cardsByMonth[m] ?? []).some((c) => c.status === 'confirmed')) ?? null;
}

// '+245 Sep' under a season row; '' when nothing scored yet or 0 earned.
export function deltaLabel(delta, month) {
  if (!month || !delta) return '';
  return `+${formatPoints(delta)} ${monthName(month, true)}`;
}

// "2nd of 7 · 2,340 pts" for the Play tab row; null until anyone has a card.
export function positionText(table, userId, cardsByMonth) {
  if (!lastScoredMonth(cardsByMonth)) return null;
  const row = (table ?? []).find((r) => r.userId === userId);
  if (!row) return null;
  return `${row.isTie ? 'T' : ''}${ordinal(row.place)} of ${table.length} · ${formatPoints(row.total)} pts`;
}

const STATUS_RANK = { confirmed: 0, submitted: 1, playing: 2, announced: 3 };

function clock(iso, now) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === now.toDateString() ? `today ${hm}` : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${hm}`;
}

// One member's line for the current month: { text, tone, flag }.
// tone: 'done' (counts), 'live' (in progress), 'muted' (no card).
export function cardStatus(card, now = new Date()) {
  if (!card) return { text: 'No card yet', tone: 'muted', flag: null };
  const flag = card.notAnnounced ? 'Not announced in the app' : null;
  const pts = card.points != null ? `${formatPoints(card.points)} pts` : '';
  const offApp = card.source === 'offapp';
  switch (card.status) {
    case 'confirmed':
      return { text: `${pts} · confirmed`, tone: 'done', flag };
    case 'submitted':
      return { text: `${pts} · ${offApp ? 'added after the round' : 'submitted'}`, tone: 'done', flag };
    case 'playing':
      return { text: 'Playing now', tone: 'live', flag };
    case 'announced':
      return { text: `Declared · ${clock(card.announcedAt, now)}`.trim(), tone: 'live', flag };
    default:
      return { text: 'No card yet', tone: 'muted', flag: null };
  }
}

// Members with this month's card, best first: confirmed by points, then
// submitted, playing, announced, then nobody.
export function monthRows(members, cardsByMonth, month, now = new Date()) {
  const cards = cardsByMonth?.[month] ?? [];
  const rows = (members ?? []).filter((m) => !m.leftAt).map((m) => {
    const card = cards.find((c) => c.userId === m.userId && c.status !== 'void') ?? null;
    return { member: m, card, ...cardStatus(card, now) };
  });
  const rank = (r) => (r.card ? STATUS_RANK[r.card.status] ?? 4 : 5);
  return rows.sort((a, b) => rank(a) - rank(b) || (b.card?.points ?? 0) - (a.card?.points ?? 0));
}

// The month's cards that can be opened read-only: scored (submitted or
// confirmed, so `holes` is set), never void. Same order as monthRows.
export function viewableCards(members, cardsByMonth, month) {
  return monthRows(members, cardsByMonth, month)
    .map((r) => r.card)
    .filter((c) => c && (c.status === 'confirmed' || c.status === 'submitted') && c.holes);
}

const HOW_CONFIRMED = {
  partner: 'app partner', qr: 'marker by QR', photo: 'signed card photo', official: 'official result',
};

// Why a submitted card is not counting yet.
function waitingReason(card) {
  if (card.source === 'offapp') return card.proofPath ? 'waiting for the check' : 'needs the card photo';
  return "marker hasn't scanned the QR yet";
}

// The month board, grouped for the board's month view. Only the confirmed
// group ranks; `seasonPoints` is the table points the place earns if the
// month ended now. waiting = submitted, onCourse = playing or announced
// (playing first), noCard = active members with nothing this month.
export function monthBoard(members, cardsByMonth, month, pointsTable) {
  const active = (members ?? []).filter((m) => !m.leftAt);
  const cards = (cardsByMonth?.[month] ?? []).filter((c) => c.status !== 'void');
  const bestCard = (userId, ok) => cards.filter((c) => c.userId === userId && ok(c))
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0] ?? null;
  const confirmed = [];
  for (const r of monthResults(cards, active, pointsTable)) {
    const member = (members ?? []).find((m) => m.userId === r.userId);
    if (r.place == null || !member) continue;
    const card = bestCard(r.userId, (c) => c.status === 'confirmed');
    confirmed.push({
      member, card, place: r.place, isTie: r.isTie, cardPoints: r.cardPoints, seasonPoints: r.seasonPoints,
      how: HOW_CONFIRMED[card.confirmation] ?? null,
    });
  }
  const placed = new Set(confirmed.map((r) => r.member.userId));
  const waiting = [];
  const onCourse = [];
  const noCard = [];
  for (const member of active) {
    if (placed.has(member.userId)) continue;
    const card = bestCard(member.userId, () => true);
    if (card?.status === 'submitted') waiting.push({ member, card, reason: waitingReason(card) });
    else if (card?.status === 'playing' || card?.status === 'announced') onCourse.push({ member, card });
    else noCard.push(member);
  }
  waiting.sort((a, b) => (b.card.points ?? 0) - (a.card.points ?? 0));
  onCourse.sort((a, b) => (a.card.status === 'playing' ? 0 : 1) - (b.card.status === 'playing' ? 0 : 1));
  return { confirmed, waiting, onCourse, noCard };
}

// Days left in the calendar month, for the "27 days left" caption.
export function daysLeftInMonth(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return end.getDate() - now.getDate();
}

export function currentMonthKey(now = new Date()) {
  return cardMonth(now);
}

export function memberLabel(member, meId) {
  return member.userId === meId ? 'You' : (member.displayName || member.username || 'Golfer');
}

// Votes needed to pass: ceil(2/3 of active members), decision D2. Display
// only; the server decides.
export function voteThreshold(activeMemberCount) {
  return Math.ceil((activeMemberCount * 2) / 3);
}

export function memberName(members, userId, meId) {
  const m = (members ?? []).find((x) => x.userId === userId);
  return m ? memberLabel(m, meId) : 'Former member';
}

const REASON_TEXT = { set: 'set by the admin', proposed: 'proposed on joining', vote: 'by vote' };

// One handicap history line: "Nacho 24.0 -> 21.0 · by vote · 12 Jun".
export function handicapEventLine(event, members, meId) {
  const when = new Date(event.at);
  const day = Number.isNaN(when.getTime()) ? '' : ` · ${when.getDate()} ${MONTHS[when.getMonth()].slice(0, 3)}`;
  const move = event.old == null ? `set to ${event.new.toFixed(1)}` : `${event.old.toFixed(1)} → ${event.new.toFixed(1)}`;
  return `${memberName(members, event.userId, meId)} ${move} · ${REASON_TEXT[event.reason] ?? event.reason}${day}`;
}

// The "Your <Month> card" block: what state my card is in and what it shows.
// kind: 'none' | 'announced' | 'playing' | 'submitted' | 'confirmed'
export function yourCardState(card) {
  if (!card || card.status === 'void') return { kind: 'none' };
  const course = card.course?.name ?? null;
  const pts = card.points != null ? `${formatPoints(card.points)} pts` : null;
  return { kind: card.status, course, pts, offApp: card.source === 'offapp', card };
}

// Season table + "2nd of 7 · 2,340 pts" for one league snapshot (the shape
// leagueStore.getLeague returns and caches).
export function leagueSummary(snapshot, meId) {
  const { league, members, cardsByMonth } = snapshot;
  const table = seasonTable((members ?? []).filter((m) => !m.leftAt), cardsByMonth, league.pointsTable);
  return { table, position: positionText(table, meId, cardsByMonth) };
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
