// League stats: honours, leaders, season grid and rivals, derived from the
// cards a league snapshot already carries (pure, no I/O). Only confirmed
// cards count. Plan: docs/superpowers/plans/2026-10-05-league-stats-and-board.md
import { calcExtraShots, calcStablefordPoints } from './scoring';
import { memberName, ordinal } from './leagueView';
import { dayLabel, timeLabel } from './leagueOffApp';

export const MIN_HONOUR_CARDS = 3; // fewer confirmed cards than this: no honours
export const MIN_STAT_CARDS = 3; // fewer cards than this: a player's average is not shown

const confirmed = (cards) => (cards ?? []).filter((c) => c?.status === 'confirmed');
const sum = (list) => list.reduce((a, b) => a + b, 0);
const mean = (list) => sum(list) / list.length;

// Per-hole figures for a card: { holes: [{ n, par, si, strokes, points, extra }], out, in }.
// null when the card can't be read hole by hole: the course isn't an 18-hole
// snapshot, there is no playing handicap, or no strokes. Holes without
// strokes are left out; out/in are the Stableford totals of holes 1-9 / 10-18.
export function cardHoleStats(card) {
  const courseHoles = card?.course?.holes;
  if (!Array.isArray(courseHoles) || courseHoles.length !== 18) return null;
  if (card.playingHandicap == null || !card.holes) return null;
  const holes = [];
  let out = 0;
  let back = 0;
  [...courseHoles].sort((a, b) => a.n - b.n).forEach((h) => {
    const strokes = Number(card.holes[h.n]) || 0;
    if (strokes <= 0) return;
    const points = calcStablefordPoints(h.par, strokes, card.playingHandicap, h.si, 18);
    holes.push({
      n: h.n, par: h.par, si: h.si, strokes, points, extra: calcExtraShots(card.playingHandicap, h.si, 18),
    });
    if (h.n <= 9) out += points; else back += points;
  });
  return holes.length ? { holes, out, in: back } : null;
}

// Confirmed cards with their hole stats, hole-readable ones only.
function readable(cards) {
  return confirmed(cards).map((card) => ({ card, stats: cardHoleStats(card) })).filter((x) => x.stats);
}

// "16 cards · 7 courses" under a month's title.
export function monthSummary(cards) {
  const done = confirmed(cards);
  const courses = new Set(done.map((c) => c.course?.name).filter(Boolean));
  return {
    cards: done.length,
    courses: courses.size,
    text: `${done.length} ${done.length === 1 ? 'card' : 'cards'} · ${courses.size} ${courses.size === 1 ? 'course' : 'courses'}`,
  };
}

const article = (n) => ([8, 11, 18].includes(n) ? 'an' : 'a');
const courseOf = (card) => (card.course?.name ? ` at ${card.course.name}` : '');

// Longest run of consecutive holes scoring 2+ points: { from, to, length }.
function longestRun(holes) {
  let best = null;
  let start = null;
  holes.forEach((h, i) => {
    if (h.points < 2) { start = null; return; }
    if (start == null || h.n !== holes[i - 1].n + 1) start = h;
    const length = h.n - start.n + 1;
    if (!best || length > best.length) best = { from: start.n, to: h.n, length };
  });
  return best;
}

// First element with the largest key (earlier in `list` wins a tie).
function maxBy(list, key) {
  let best = null;
  let bestKey = -Infinity;
  list.forEach((x) => {
    const k = key(x);
    if (k > bestKey) { best = x; bestKey = k; }
  });
  return best;
}

// The month's honours, in display order: [{ key, title, text, userId }].
// [] with fewer than MIN_HONOUR_CARDS confirmed cards. An honour whose data is
// missing (no tee times, nobody over par by 3) is left out.
export function monthHonours(cards, members, meId = null) {
  const done = confirmed(cards);
  if (done.length < MIN_HONOUR_CARDS) return [];
  const name = (userId) => memberName(members, userId, meId);
  const withHoles = readable(done);
  const honours = [];
  const add = (key, title, text, userId) => honours.push({ key, title, text, userId });

  const top = maxBy(done, (c) => Number(c.points) || 0);
  if (top) add('card', 'Card of the month', `${name(top.userId)}, ${top.points} pts${courseOf(top)}`, top.userId);

  const holeList = withHoles.flatMap(({ card, stats }) => stats.holes.map((h) => ({ card, h })));
  const bestHole = maxBy(holeList, ({ h }) => h.points * 100 - (h.strokes - h.par));
  if (bestHole) {
    const { card, h } = bestHole;
    const strokesText = h.extra > 0 ? (h.extra === 1 ? ' with a stroke' : ` with ${h.extra} strokes`) : '';
    add('hole', 'Hole of the month',
      `${name(card.userId)}, ${article(h.strokes)} ${h.strokes} on the par-${h.par} ${ordinal(h.n)}${courseOf(card)}${strokesText} · ${h.points} pts`,
      card.userId);
  }

  const streaks = withHoles.map(({ card, stats }) => ({ card, run: longestRun(stats.holes) })).filter((x) => x.run);
  const streak = maxBy(streaks, (x) => x.run.length);
  if (streak && streak.run.length >= 3) {
    const { card, run } = streak;
    add('streak', 'Hot streak', `${name(card.userId)}, ${run.length} holes at 2+ pts, holes ${run.from}-${run.to}`, card.userId);
  }

  const closer = maxBy(withHoles, ({ stats }) => stats.in);
  if (closer) {
    add('closer', 'Closer', `${name(closer.card.userId)}, ${closer.stats.out} out and ${closer.stats.in} back`, closer.card.userId);
  }

  const birdies = new Map();
  withHoles.forEach(({ card, stats }) => {
    const n = stats.holes.filter((h) => h.strokes <= h.par - 1).length;
    if (n) birdies.set(card.userId, (birdies.get(card.userId) ?? 0) + n);
  });
  if (birdies.size) {
    const total = sum([...birdies.values()]);
    const ranked = [...birdies].sort((a, b) => b[1] - a[1]).slice(0, 2);
    add('birdies', 'Birdies',
      `${total} as a group · ${ranked.map(([id, n]) => `${name(id)} ${n}`).join(', ')}`, ranked[0][0]);
  }

  const snowman = maxBy(holeList, ({ h }) => (h.strokes - h.par) * 100 + h.strokes);
  if (snowman && snowman.h.strokes - snowman.h.par >= 3) {
    const { card, h } = snowman;
    add('snowman', 'Snowman',
      `${name(card.userId)}, ${article(h.strokes)} ${h.strokes} on the par-${h.par} ${ordinal(h.n)}${courseOf(card)}`, card.userId);
  }

  // Earliest time of day on the tee, whichever day it was.
  const timed = done.filter((c) => c.teeTime && !Number.isNaN(new Date(c.teeTime).getTime()));
  const early = maxBy(timed, (c) => { const d = new Date(c.teeTime); return -(d.getHours() * 60 + d.getMinutes()); });
  if (early) {
    add('early', 'Early bird',
      `${name(early.userId)}, out at ${timeLabel(early.teeTime)} on ${dayLabel(early.teeTime)}`, early.userId);
  }

  // The last card of the month to be played.
  const dated = done.filter((c) => c.playedOn && dayLabel(c.playedOn));
  const last = maxBy(dated, (c) => String(c.playedOn).slice(0, 10).replace(/-/g, '') * 1);
  if (last) add('last', 'Last call', `${name(last.userId)}, played on ${dayLabel(last.playedOn)}`, last.userId);

  return honours;
}

// ---- Leaders ---------------------------------------------------------------

const signed = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`;
const birdiesOf = (stats) => stats.holes.filter((h) => h.strokes <= h.par - 1).length;

// `holes`: needs a readable 18-hole card; `avg`: needs MIN_STAT_CARDS cards;
// `value`: a member's figure from their { card, stats } list.
const STATS = {
  avg: {
    holes: false,
    avg: true,
    value: (list) => mean(list.map(({ card }) => Number(card.points) || 0)),
    show: (v) => v.toFixed(1),
  },
  birdies: { holes: true, avg: false, value: (list) => sum(list.map(({ stats }) => birdiesOf(stats))), show: String },
  blobs: {
    holes: true,
    avg: false,
    value: (list) => sum(list.map(({ stats }) => stats.holes.filter((h) => h.points === 0).length)),
    show: String,
  },
  par3: {
    holes: true,
    avg: true,
    value: (list) => {
      const pts = list.flatMap(({ stats }) => stats.holes.filter((h) => h.par === 3).map((h) => h.points));
      return pts.length ? mean(pts) : null;
    },
    show: (v) => v.toFixed(2),
  },
  backNine: {
    holes: true,
    avg: true,
    value: (list) => mean(list.map(({ stats }) => stats.in)) - mean(list.map(({ stats }) => stats.out)),
    show: signed,
  },
};

// One row per member for a stat: [{ userId, value, display, cards }], best
// first (every stat sorts high to low; blobs is a fun stat, most first).
// avg: average points per card; birdies / blobs: season totals; par3: average
// points on par 3s; backNine: average back nine minus average front nine.
// Averaged stats need MIN_STAT_CARDS cards; players short of that, or with no
// card at all, go last. Hole-based stats skip cards that aren't 18 readable holes.
export function statLeaders(cardsByMonth, members, statKey) {
  const stat = STATS[statKey];
  if (!stat) return [];
  const all = Object.values(cardsByMonth ?? {}).flatMap((cards) => confirmed(cards))
    .map((card) => ({ card, stats: stat.holes ? cardHoleStats(card) : null }))
    .filter(({ stats }) => !stat.holes || stats);

  const rows = (members ?? []).map((m) => {
    const list = all.filter(({ card }) => card.userId === m.userId);
    const short = stat.avg && list.length < MIN_STAT_CARDS;
    const value = list.length && !short ? stat.value(list) : null;
    let display = '–';
    if (value != null) display = stat.show(value);
    else if (short && list.length) display = `needs ${MIN_STAT_CARDS} cards`;
    return { userId: m.userId, value, display, cards: list.length };
  });
  const ranked = rows.filter((r) => r.value != null).sort((a, b) => b.value - a.value || b.cards - a.cards);
  const rest = rows.filter((r) => r.value == null).sort((a, b) => b.cards - a.cards);
  return [...ranked, ...rest];
}

// ---- Season grid -----------------------------------------------------------

// userId -> best confirmed card of one month.
function bestByUser(cards) {
  const best = new Map();
  confirmed(cards).forEach((c) => {
    const pts = Number(c.points) || 0;
    if (!best.has(c.userId) || pts > (Number(best.get(c.userId).points) || 0)) best.set(c.userId, c);
  });
  return best;
}

// Members x months: [{ userId, cells: [{ month, points, cardId, best }] }].
// Rows follow `members` (pass them in season-table order). `points` is null
// with no confirmed card; `best` marks the month's top card (ties all best).
export function seasonGrid(cardsByMonth, members, monthKeys) {
  const perMonth = Object.fromEntries(monthKeys.map((month) => {
    const best = bestByUser(cardsByMonth?.[month]);
    const top = Math.max(-1, ...[...best.values()].map((c) => Number(c.points) || 0));
    return [month, { best, top }];
  }));
  return (members ?? []).map((m) => ({
    userId: m.userId,
    cells: monthKeys.map((month) => {
      const card = perMonth[month].best.get(m.userId);
      const points = card ? Number(card.points) || 0 : null;
      return { month, points, cardId: card?.id ?? null, best: points != null && points === perMonth[month].top };
    }),
  }));
}

// ---- Rivals ----------------------------------------------------------------

// Months where both players have a confirmed card, newest first:
// [{ month, a, b }] with each side's points.
export function rivalMonths(cardsByMonth, a, b) {
  return Object.keys(cardsByMonth ?? {}).sort().reverse().flatMap((month) => {
    const best = bestByUser(cardsByMonth[month]);
    const ca = best.get(a);
    const cb = best.get(b);
    return ca && cb ? [{ month, a: Number(ca.points) || 0, b: Number(cb.points) || 0 }] : [];
  });
}

// Me against every other member: [{ userId, won, lost, level, months }] over
// the months both have a confirmed card, closest rivalry first (smallest gap
// between won and lost, then most months); members I never shared a month
// with go last.
export function rivals(cardsByMonth, members, meId) {
  const rows = (members ?? []).filter((m) => m.userId !== meId).map((m) => {
    const months = rivalMonths(cardsByMonth, meId, m.userId);
    return {
      userId: m.userId,
      won: months.filter((x) => x.a > x.b).length,
      lost: months.filter((x) => x.a < x.b).length,
      level: months.filter((x) => x.a === x.b).length,
      months: months.length,
    };
  });
  const gap = (r) => Math.abs(r.won - r.lost);
  return rows.sort((a, b) => (b.months > 0) - (a.months > 0) || gap(a) - gap(b) || b.months - a.months);
}
