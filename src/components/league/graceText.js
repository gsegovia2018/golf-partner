// Wording for the grace window (docs/superpowers/plans/2026-10-13-league-review-followups.md,
// R12): when the previous month closes, what each waiting card is waiting for,
// and the "not counted yet" rows of the board. Shared by MonthClosingBanner and
// the board so both say the same thing. Call at render time (language-aware).
import { formatDate, formatTime } from '../../i18n';
import { madridDay } from '../../store/leagueRules';
import { approvalReason, lastMinute } from '../../store/leagueGrace';
import { formatPoints, formatToPar } from '../../store/leagueView';
import { isMedalFormat } from '../../store/leagueStandings';

const MADRID = 'Europe/Madrid';
const pad2 = (n) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' of an instant's Madrid calendar day (what formatDate takes
// without shifting with the device's zone).
export function madridDateStr(date) {
  const d = madridDay(date);
  return d ? `${d.year}-${pad2(d.month)}-${pad2(d.day)}` : null;
}

// 24 h clock of an instant in Madrid ("23:59"), whatever the device zone.
export function madridClock(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: MADRID, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    if (get('hour') && get('minute')) return `${get('hour')}:${get('minute')}`;
  } catch {
    // No timeZone support: fall through to the device's time.
  }
  return formatTime(date, { timeZone: MADRID });
}

// How the close reads: { weekday: 'Saturday', short: 'Sat 3 Oct', clock: '23:59',
// tonight } for the last minute of the month, in Madrid.
export function closeInfo(closesAt, now = new Date()) {
  const last = lastMinute(closesAt);
  const day = madridDateStr(last);
  return {
    weekday: formatDate(day, 'weekday'),
    weekdayShort: formatDate(day, 'weekdayShort'),
    short: formatDate(day, 'short'),
    clock: madridClock(last),
    tonight: day === madridDateStr(now),
  };
}

// "Sat 14:20": a deadline in Madrid time, never later than the month's close.
export function deadlineLabel(date, closesAt) {
  const last = lastMinute(closesAt);
  const at = last && date.getTime() > last.getTime() ? last : date;
  return `${formatDate(madridDateStr(at), 'weekdayShort')} ${madridClock(at)}`;
}

// The sub line of a waiting card: what it is waiting for. `entry` is an item
// of graceMonth().pending.
export function graceLine(entry, t, { closesAt, now = new Date() }) {
  const { card, state } = entry;
  switch (state) {
    case 'marker': return t('league.grace.line.marker', { name: card.markerName });
    case 'noScan': return t('league.grace.line.noScan');
    case 'noProof': return t('league.grace.line.noProof');
    case 'check': return t('league.grace.line.check');
    case 'approval': return t(approvalReason(card) === 'handTee'
      ? 'league.grace.line.approvalHand' : 'league.grace.line.approvalNotAnnounced');
    case 'returned': {
      const open = entry.resubmitBy && entry.resubmitBy.getTime() > new Date(now).getTime();
      return open
        ? t('league.grace.line.returned', { by: deadlineLabel(entry.resubmitBy, closesAt) })
        : t('league.grace.line.returnedLate');
    }
    case 'playing': return t('league.grace.line.playing');
    default: return t('league.grace.line.announced');
  }
}

// The board's "Not counted yet" section for the closing month: dashed
// position, dimmed points, one status line each. Rows open the card.
export function ghostSection(grace, t, { nameOf, now, onOpen, format = 'stableford' }) {
  return {
    key: 'notCounted',
    label: t('league.grace.notCounted', { count: grace.pending.length }),
    icon: 'clock',
    gold: true,
    rows: grace.pending.map((e) => ({
      key: e.userId,
      name: nameOf(e.userId),
      isMe: e.isMe,
      place: null,
      unranked: true,
      muted: true,
      points: isMedalFormat(format) ? formatToPar(e.card.toPar) : e.card.points != null ? formatPoints(e.card.points) : '—',
      detail: graceLine(e, t, { closesAt: grace.closesAt, now }),
      onPress: onOpen ? () => onOpen(e.userId) : undefined,
    })),
  };
}
