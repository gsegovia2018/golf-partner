// League sharing (D4 B): the text a member sends to the group chat, and the
// public board's model. Pure functions, no I/O.
// Plan: docs/superpowers/plans/2026-10-13-league-review-followups.md (D4).
//
// Unlike the board's message descriptors (docs/i18n.md, "Pure store
// modules"), these build finished text: it leaves the app, so it is written
// once, in the sharer's language, at the moment they share. Every builder
// takes that language as `lang` and passes it to t / formatNumber /
// formatDate / formatTime explicitly, so the output never depends on the
// language active elsewhere and tests can pin it.
// WhatsApp formatting: *bold* for the league name; the markers * _ ~ ` are
// stripped from every name inside the text (wa()) so a name can't restyle it.
//
// Privacy: names are the server-made public name only (get_league_members'
// public_name, the public board's name), never derived here from the display
// name or the username: the server drops a display name that is the email's
// local part or the username (20261018000000). No public name -> "Golfer" /
// "Jugador".
import { t, formatNumber, formatDate, formatTime, formatOrdinal } from '../i18n';
import { monthResults, seasonTable, cardScore } from './leagueStandings';
import {
  monthBoard, monthStanding, lastScoredMonth, daysLeftInMonth, currentMonthKey, firstName,
} from './leagueView';
import { isMonthClosed } from './leagueRules';

export const PUBLIC_BOARD_PATH = 'league-board';

// The public board link for a token: `${origin}/league-board/<token>`.
export function publicBoardUrl(origin, token) {
  if (!token) return null;
  return `${String(origin ?? '').replace(/\/+$/, '')}/${PUBLIC_BOARD_PATH}/${encodeURIComponent(token)}`;
}

// The token in a /league-board/<token> path, or null.
export function publicBoardTokenFromPath(pathname) {
  const m = /^\/league-board\/([^/?#]+)/.exec(pathname || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// First name + the initial of the first surname, i.e. the second word:
// 'Íñigo Echeverría Ruiz' -> 'Íñigo E.', 'Miguel Ángel Domínguez' -> 'Miguel Á.'.
// One word stays as it is. The initial is the first code point (Array.from),
// so an emoji or a surrogate pair stays whole. Blank -> null. Same rule as
// the server's league_public_name.
export function publicNameRule(name) {
  const words = String(name ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return `${words[0]} ${Array.from(words[1])[0].toUpperCase()}.`;
}

// The name a share shows: publicNameRule, or the neutral "Golfer" / "Jugador".
export function shareName(name, lang) {
  return publicNameRule(name) ?? t('league.share.golfer', {}, lang);
}

// A member's name for sharing: the server-made public name (already first
// name + initial), null when the server gave none. Never the display name or
// the username.
export function publicDisplayName(member) {
  const name = String(member?.publicName ?? '').trim();
  return name || null;
}

// WhatsApp markers out of a name: * _ ~ `.
export const wa = (s) => String(s ?? '').replace(/[*_~`]/g, '');

// A row's name inside a message: the markers go before the name rule, so
// "Íñigo ~Echeverría" still reads "Íñigo E.".
const msgName = (row, lang) => shareName(wa(row.display), lang);

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const monthWord = (monthKey, lang) => formatDate(`${monthKey}-01`, 'monthName', lang);
const rank = (place, isTie) => `${isTie ? 'T' : ''}${place}`;
const leaguePts = (n, lang) => formatNumber(n, { maxDecimals: 1 }, lang);
const memberNameOf = (members, userId, lang) => {
  const m = (members ?? []).find((x) => x.userId === userId);
  return shareName(publicDisplayName(m), lang);
};
const linkLines = (url, lang) => (url ? ['', t('league.share.msg.liveBoard', { url }, lang)] : []);
const active = (members) => (members ?? []).filter((m) => !m.leftAt);
const optsOf = (league) => ({
  participationPoints: league?.participationPoints ?? 0, format: league?.format ?? 'stableford',
});

// The ranked rows of a month: { place, isTie, name, points, score, course,
// seasonPoints } (score: the ranking value for the league's format).
export function rankedMonthRows(snapshot, month, now = new Date(), lang) {
  const { league, members, cardsByMonth } = snapshot;
  const board = monthBoard(members, cardsByMonth, month, league.pointsTable, now, optsOf(league));
  return board.confirmed.filter((r) => r.place != null).map((r) => ({
    userId: r.member.userId,
    place: r.place,
    isTie: r.isTie,
    name: shareName(publicDisplayName(r.member), lang),
    display: publicDisplayName(r.member),
    points: r.cardPoints,
    score: r.cardScore,
    course: r.card?.course?.name ?? null,
    seasonPoints: r.seasonPoints,
  }));
}

// Active members not in the month's ranking yet whose month is still open to
// them: no card, playing or announced, submitted, waiting for approval.
export function stillToPost(snapshot, month, now = new Date()) {
  const { league, members, cardsByMonth } = snapshot;
  const b = monthBoard(members, cardsByMonth, month, league.pointsTable, now, optsOf(league));
  return b.noCard.length + b.onCourse.length + b.waiting.length + b.awaiting.length;
}

// "October so far · 18 days left" (or "· last day").
function soFarLine(month, now, lang) {
  const left = daysLeftInMonth(now);
  const name = monthWord(month, lang);
  return cap(left === 0
    ? t('league.share.msg.monthLastDay', { month: name }, lang)
    : t('league.share.msg.monthSoFar', { month: name, count: left }, lang));
}

// *League*
// October so far · 18 days left
//
// 1. Íñigo E. · 41 pts · RCG Sotogrande
// T2. Javier O. · 38 pts · …
// 3 still to post.
//
// Live board: <url>
export function standingsMessage(snapshot, { month = null, now = new Date(), url = null, lang } = {}) {
  const key = month ?? currentMonthKey(now);
  const rows = rankedMonthRows(snapshot, key, now, lang);
  const lines = [`*${wa(snapshot.league.name)}*`, soFarLine(key, now, lang), ''];
  if (rows.length === 0) lines.push(t('league.share.msg.noneYet', {}, lang));
  for (const r of rows) {
    const params = {
      place: rank(r.place, r.isTie), name: msgName(r, lang), points: formatNumber(r.points, {}, lang), course: r.course && wa(r.course),
    };
    lines.push(t(r.course ? 'league.share.msg.rowCourse' : 'league.share.msg.row', params, lang));
  }
  const left = stillToPost(snapshot, key, now);
  if (left > 0) lines.push(t('league.share.msg.toPost', { count: left }, lang));
  return [...lines, ...linkLines(url, lang)].join('\n');
}

// The season table rows over the months up to `upTo` ('YYYY-MM', inclusive;
// null = all): { place, isTie, name, total }.
export function seasonRows(snapshot, upTo = null, lang) {
  const { league, members, cardsByMonth } = snapshot;
  const months = Object.fromEntries(Object.entries(cardsByMonth ?? {}).filter(([m]) => upTo == null || m <= upTo));
  return seasonTable(active(members), months, league.pointsTable, optsOf(league)).map((r) => ({
    userId: r.userId, place: r.place, isTie: r.isTie, name: memberNameOf(members, r.userId, lang), total: r.total,
    display: publicDisplayName((members ?? []).find((x) => x.userId === r.userId)),
    lastMonthDelta: r.lastMonthDelta,
  }));
}

// *League*
// Season after September
//
// 1. Javier O. · 1,545
// …
//
// Live board: <url>
export function seasonMessage(snapshot, { url = null, lang } = {}) {
  const last = lastScoredMonth(snapshot.cardsByMonth);
  const lines = [
    `*${wa(snapshot.league.name)}*`,
    last ? t('league.share.msg.seasonAfter', { month: monthWord(last, lang) }, lang) : t('league.share.msg.season', {}, lang),
    '',
  ];
  if (!last) lines.push(t('league.share.msg.noneYet', {}, lang));
  else {
    for (const r of seasonRows(snapshot, null, lang)) {
      lines.push(t('league.share.msg.seasonRow', { place: rank(r.place, r.isTie), name: msgName(r, lang), points: leaguePts(r.total, lang) }, lang));
    }
  }
  return [...lines, ...linkLines(url, lang)].join('\n');
}

// Month end ("October is final"): places with Stableford and league points,
// then the season's top 3 after that month.
// *League*
// October results
//
// 1. Íñigo E. · 41 pts · +500
// …
//
// Season: 1. Javier O. 1,545 · 2. Íñigo E. 1,320 · 3. Ana P. 1,100
//
// Live board: <url>
export function resultsMessage(snapshot, { month, now = new Date(), url = null, lang } = {}) {
  const rows = rankedMonthRows(snapshot, month, now, lang);
  const lines = [`*${wa(snapshot.league.name)}*`, cap(t('league.share.msg.results', { month: monthWord(month, lang) }, lang)), ''];
  if (rows.length === 0) lines.push(t('league.share.msg.noneYet', {}, lang));
  for (const r of rows) {
    lines.push(t('league.share.msg.rowResult', {
      place: rank(r.place, r.isTie), name: msgName(r, lang), points: formatNumber(r.points, {}, lang), league: leaguePts(r.seasonPoints, lang),
    }, lang));
  }
  const top = seasonRows(snapshot, month, lang).filter((r) => r.total > 0).slice(0, 3);
  if (top.length > 0) {
    const list = top.map((r) => t('league.share.msg.seasonTopItem', {
      place: rank(r.place, r.isTie), name: msgName(r, lang), points: leaguePts(r.total, lang),
    }, lang)).join(' · ');
    lines.push('', t('league.share.msg.seasonTop', { list }, lang));
  }
  return [...lines, ...linkLines(url, lang)].join('\n');
}

// My scored card of a month (confirmed or submitted, with points), or null.
export function shareableCard(snapshot, month, userId) {
  return (snapshot?.cardsByMonth?.[month] ?? []).find((c) => c.userId === userId
    && (c.status === 'confirmed' || c.status === 'submitted') && c.points != null) ?? null;
}

// The ⋯ Card actions menu's "Share card" item (same shape as
// leagueView.cardActions items): my own scored card only, null otherwise.
export function shareCardAction(card, isOwner) {
  if (!isOwner || !card || card.points == null || (card.status !== 'confirmed' && card.status !== 'submitted')) return null;
  return {
    kind: 'share', icon: 'share-2', enabled: true,
    title: { key: 'league.share.cardAction.title' }, sub: { key: 'league.share.cardAction.sub' },
  };
}

// "My October card for <League>: 36 pts at <course>, confirmed by Javier. 4th so far.\n<url>"
export function cardMessage(snapshot, card, { now = new Date(), url = null, lang } = {}) {
  const month = card.monthKey ?? String(card.month ?? '').slice(0, 7);
  const byName = wa(firstName(card.confirmedByName));
  const by = card.status === 'confirmed' && byName ? byName : null;
  const params = {
    month: monthWord(month, lang),
    league: wa(snapshot.league.name),
    points: formatNumber(card.points, {}, lang),
    course: wa(card.course?.name) || '—',
    name: by,
  };
  let text = t(by ? 'league.share.msg.cardBy' : 'league.share.msg.card', params, lang);
  const standing = card.status === 'confirmed' ? monthStanding(snapshot, month, card.userId, now) : null;
  if (standing) {
    const place = `${standing.isTie ? 'T' : ''}${formatOrdinal(standing.place, lang)}`;
    const open = month === currentMonthKey(now) && !isMonthClosed(month, now);
    text += ` ${t(open ? 'league.share.msg.placeSoFar' : 'league.share.msg.placeFinal', { place }, lang)}`;
  }
  return url ? `${text}\n${url}` : text;
}

// After announcing an off-app card: "I'm playing my October card for
// <League>: Sat 17 Oct 09:20 at Golf Santander, without the app. Score in by 17:20.\n<url>"
// `postBy` on another day than the tee time also says the day.
export function announcementMessage({
  leagueName, month, teeTime, postBy, course,
}, { url = null, lang } = {}) {
  const tee = new Date(teeTime);
  const by = postBy ? new Date(postBy) : null;
  const when = `${formatDate(tee, 'short', lang)} ${formatTime(tee, {}, lang)}`;
  const byText = by
    ? (by.toDateString() === tee.toDateString() ? formatTime(by, {}, lang) : `${formatDate(by, 'short', lang)} ${formatTime(by, {}, lang)}`)
    : null;
  const key = byText ? 'league.share.msg.announce' : 'league.share.msg.announceNoBy';
  const text = t(key, {
    month: monthWord(String(month ?? '').slice(0, 7), lang), league: wa(leagueName), when, course: wa(course) || '—', by: byText,
  }, lang);
  return url ? `${text}\n${url}` : text;
}

// ---- The public board ---------------------------------------------------

// get_public_league_board's payload as the snapshot shape the standings
// helpers read ({ league, members, cardsByMonth }); null for no board.
// Member keys stand in for user ids; every card counts (the server sends
// only counting ones: scored for the league's format). A member without a
// display name has name null: the views show the neutral label. A server
// before 20261020000000 sends no format: Stableford.
export function publicBoardSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || !payload.league) return null;
  const l = payload.league;
  const format = l.format ?? 'stableford';
  const members = (payload.members ?? []).map((m) => ({
    userId: m.key, displayName: m.name, publicName: m.name ?? null, leftAt: m.active === false ? 'left' : null,
  }));
  const cardsByMonth = {};
  for (const c of payload.cards ?? []) {
    const card = {
      userId: c?.member, status: 'confirmed',
      points: c?.points == null ? null : Number(c.points),
      toPar: c?.to_par == null ? null : Number(c.to_par),
      month: c?.month, monthKey: String(c?.month ?? '').slice(0, 7),
      course: c?.course ? { name: c.course } : null,
    };
    if (c?.status !== 'confirmed' || cardScore(card, format) == null) continue;
    (cardsByMonth[card.monthKey] ??= []).push(card);
  }
  return {
    league: {
      name: l.name,
      seasonStart: l.season_start,
      seasonEnd: l.season_end,
      pointsTable: Array.isArray(l.points_table) ? l.points_table.map(Number) : [],
      participationPoints: Number(l.participation_points) || 0,
      format,
    },
    members,
    cardsByMonth,
  };
}

// The public page's view of one scope ('season' or a 'YYYY-MM' month):
// { rows, ranked, total } where rows are
// { key, place, isTie, name, course, points, league } (points null on the season).
// `total` counts every member the board shows (active ones plus anyone with a
// counting card), so "X of Y cards in" can never pass Y.
export function publicBoardView(snapshot, scope, now = new Date(), lang) {
  const total = (snapshot.members ?? []).length;
  if (scope === 'season') {
    const rows = seasonRows(snapshot, null, lang).map((r) => ({
      key: r.userId, place: r.place, isTie: r.isTie, name: r.name, course: null, points: null, league: r.total,
      lastMonth: r.lastMonthDelta,
    }));
    return { rows, ranked: rows.length, total, last: lastScoredMonth(snapshot.cardsByMonth) };
  }
  const { league, members, cardsByMonth } = snapshot;
  const results = monthResults(cardsByMonth[scope] ?? [], active(members), league.pointsTable, optsOf(league))
    .filter((r) => r.place != null);
  const rows = results.map((r) => {
    const card = (cardsByMonth[scope] ?? [])
      .find((c) => c.userId === r.userId && cardScore(c, league.format) === r.cardScore);
    return {
      key: r.userId, place: r.place, isTie: r.isTie, name: memberNameOf(members, r.userId, lang),
      course: card?.course?.name ?? null, points: r.cardPoints, league: r.seasonPoints,
    };
  });
  return { rows, ranked: rows.length, total, daysLeft: scope === currentMonthKey(now) ? daysLeftInMonth(now) : null };
}

// The chips of the public page: the current month (when in the season), the
// season, and the previous month when it has cards.
export function publicBoardScopes(snapshot, now = new Date()) {
  const cur = currentMonthKey(now);
  const [y, m] = cur.split('-').map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const start = String(snapshot.league.seasonStart ?? '').slice(0, 7);
  const end = String(snapshot.league.seasonEnd ?? '').slice(0, 7);
  const inSeason = (k) => (!start || k >= start) && (!end || k <= end);
  const scopes = [];
  if (inSeason(cur)) scopes.push(cur);
  scopes.push('season');
  if (inSeason(prev) && (snapshot.cardsByMonth[prev] ?? []).length > 0) scopes.push(prev);
  return scopes;
}
