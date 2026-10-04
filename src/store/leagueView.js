// League screens: presentational helpers (no I/O). Wording and number
// formats live here so the Play tab, board and members screens agree.
import { cardMonth } from './leagueRules';
import { seasonTable } from './leagueStandings';

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

// Season table + "2nd of 7 · 2,340 pts" for one league snapshot (the shape
// leagueStore.getLeague returns and caches).
export function leagueSummary(snapshot, meId) {
  const { league, members, cardsByMonth } = snapshot;
  const table = seasonTable((members ?? []).filter((m) => !m.leftAt), cardsByMonth, league.pointsTable);
  return { table, position: positionText(table, meId, cardsByMonth) };
}
