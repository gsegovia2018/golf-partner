// League stats: honours, leaders, season grid and rivals, derived from the
// cards a league snapshot already carries (pure, no I/O). Only confirmed
// cards count. Month comparisons (card of the month, grid, rivals) use the
// card's Stableford points, higher is better, like the board (an unapproved
// not-announced card is left out of the grid and rivals, as on the board); a
// card without points (never scored) is never the best. The net differential
// rides along as secondary information. In a medal league (`format`) the
// grid and rivals compare strokes to par instead, fewest first; the honours
// and leaders are Stableford-only (the screen hides them there).
// Plans: docs/superpowers/plans/2026-10-05-league-stats-and-board.md,
// docs/superpowers/plans/2026-10-13-league-review-followups.md (R1).
import { calcExtraShots, calcStablefordPoints } from './scoring';
import { formatNumber, formatOrdinal } from '../i18n';
import { memberNameMsg } from './leagueView';
import { dayLabel, timeLabel } from './leagueOffApp';
import { needsApproval } from './leagueRules';
import { cardScore, compareScores } from './leagueStandings';

export const MIN_HONOUR_CARDS = 3; // fewer confirmed cards than this: no honours
export const MIN_STAT_CARDS = 3; // fewer cards than this: a player's average is not shown

const confirmed = (cards) => (cards ?? []).filter((c) => c?.status === 'confirmed');
const sum = (list) => list.reduce((a, b) => a + b, 0);
const mean = (list) => sum(list) / list.length;
// A card's Stableford points (what the board ranks), or null when it has none.
const pointsOf = (card) => {
  if (card?.points == null || card.points === '') return null;
  const n = Number(card.points);
  return Number.isFinite(n) ? n : null;
};
// A card's net differential to one decimal (secondary), or null.
const netDiffOf = (card) => {
  if (card?.netDifferential == null || card.netDifferential === '') return null;
  const n = Number(card.netDifferential);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

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

// "16 cards · 7 courses" under a month's title. `msg` is a descriptor whose
// params are descriptors too (the screen renders them depth-first).
export function monthSummary(cards) {
  const done = confirmed(cards);
  const courses = new Set(done.map((c) => c.course?.name).filter(Boolean));
  return {
    cards: done.length,
    courses: courses.size,
    msg: {
      key: 'league.stats.summary',
      params: {
        cards: { key: 'league.stats.cardsCount', params: { count: done.length } },
        courses: { key: 'league.stats.coursesCount', params: { count: courses.size } },
      },
    },
  };
}

// "a 5" / "an 8" (English); Spanish is always "un".
const scoreOf = (n) => ({ key: [8, 11, 18].includes(n) ? 'league.stats.scoreAn' : 'league.stats.scoreA', params: { strokes: n } });
const courseOf = (card) => (card.course?.name ? { key: 'league.stats.atCourse', params: { course: card.course.name } } : '');
const pts = (n) => formatNumber(n, { maxDecimals: 1 });

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

// The month's honours, in display order: [{ key, title, text, userId }]
// (title and text are message descriptors).
// [] with fewer than MIN_HONOUR_CARDS confirmed cards. An honour whose data is
// missing (no tee times, nobody over par by 3) is left out.
export function monthHonours(cards, members, meId = null) {
  const done = confirmed(cards);
  if (done.length < MIN_HONOUR_CARDS) return [];
  const name = (userId) => memberNameMsg(members, userId, meId);
  const withHoles = readable(done);
  const honours = [];
  const add = (key, text, userId) => honours.push({
    key, title: { key: `league.stats.honour.${key}` }, text: { key: `league.stats.honour.${key}.text`, params: text }, userId,
  });

  const top = maxBy(done.filter((c) => pointsOf(c) != null), (c) => pointsOf(c));
  if (top) add('card', { name: name(top.userId), points: pts(pointsOf(top)), course: courseOf(top) }, top.userId);

  const holeList = withHoles.flatMap(({ card, stats }) => stats.holes.map((h) => ({ card, h })));
  const bestHole = maxBy(holeList, ({ h }) => h.points * 100 - (h.strokes - h.par));
  if (bestHole) {
    const { card, h } = bestHole;
    add('hole', {
      name: name(card.userId),
      score: scoreOf(h.strokes),
      par: h.par,
      ordinal: formatOrdinal(h.n),
      course: courseOf(card),
      extra: h.extra > 0 ? { key: 'league.stats.withStrokes', params: { count: h.extra } } : '',
      points: h.points,
    }, card.userId);
  }

  const streaks = withHoles.map(({ card, stats }) => ({ card, run: longestRun(stats.holes) })).filter((x) => x.run);
  const streak = maxBy(streaks, (x) => x.run.length);
  if (streak && streak.run.length >= 3) {
    const { card, run } = streak;
    add('streak', { name: name(card.userId), count: run.length, from: run.from, to: run.to }, card.userId);
  }

  const closer = maxBy(withHoles, ({ stats }) => stats.in);
  if (closer) {
    add('closer', { name: name(closer.card.userId), out: closer.stats.out, back: closer.stats.in }, closer.card.userId);
  }

  const birdies = new Map();
  withHoles.forEach(({ card, stats }) => {
    const n = stats.holes.filter((h) => h.strokes <= h.par - 1).length;
    if (n) birdies.set(card.userId, (birdies.get(card.userId) ?? 0) + n);
  });
  if (birdies.size) {
    const total = sum([...birdies.values()]);
    const ranked = [...birdies].sort((a, b) => b[1] - a[1]).slice(0, 2);
    // Names can be descriptors ("You"), so the list is nested descriptors too.
    const list = ranked.map(([id, n]) => ({ key: 'league.view.nameCount', params: { name: name(id), count: n } }))
      .reduce((acc, item) => ({ key: 'league.view.listJoin', params: { a: acc, b: item } }));
    add('birdies', { total, list }, ranked[0][0]);
  }

  const snowman = maxBy(holeList, ({ h }) => (h.strokes - h.par) * 100 + h.strokes);
  if (snowman && snowman.h.strokes - snowman.h.par >= 3) {
    const { card, h } = snowman;
    add('snowman', {
      name: name(card.userId), score: scoreOf(h.strokes), par: h.par, ordinal: formatOrdinal(h.n), course: courseOf(card),
    }, card.userId);
  }

  // Earliest time of day on the tee, whichever day it was.
  const timed = done.filter((c) => c.teeTime && !Number.isNaN(new Date(c.teeTime).getTime()));
  const early = maxBy(timed, (c) => { const d = new Date(c.teeTime); return -(d.getHours() * 60 + d.getMinutes()); });
  if (early) {
    add('early', { name: name(early.userId), time: timeLabel(early.teeTime), day: dayLabel(early.teeTime) }, early.userId);
  }

  // The last card of the month to be played.
  const dated = done.filter((c) => c.playedOn && dayLabel(c.playedOn));
  const last = maxBy(dated, (c) => String(c.playedOn).slice(0, 10).replace(/-/g, '') * 1);
  if (last) add('last', { name: name(last.userId), day: dayLabel(last.playedOn) }, last.userId);

  return honours;
}

// ---- Leaders ---------------------------------------------------------------

const signed = (v) => `${v >= 0 ? '+' : '-'}${formatNumber(Math.abs(v), { decimals: 1 })}`;
const birdiesOf = (stats) => stats.holes.filter((h) => h.strokes <= h.par - 1).length;

// `holes`: needs a readable 18-hole card; `avg`: needs MIN_STAT_CARDS cards;
// `value`: a member's figure from their { card, stats } list.
const STATS = {
  avg: {
    holes: false,
    avg: true,
    value: (list) => mean(list.map(({ card }) => Number(card.points) || 0)),
    show: (v) => formatNumber(v, { decimals: 1 }),
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
    show: (v) => formatNumber(v, { decimals: 2 }),
  },
  backNine: {
    holes: true,
    avg: true,
    value: (list) => mean(list.map(({ stats }) => stats.in)) - mean(list.map(({ stats }) => stats.out)),
    show: signed,
  },
};

// One row per member for a stat: [{ userId, value, display, cards }]
// (display is a formatted string, or a descriptor when the player needs more cards), best
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
    else if (short && list.length) display = { key: 'league.stats.needsCards', params: { count: MIN_STAT_CARDS } };
    return { userId: m.userId, value, display, cards: list.length };
  });
  const ranked = rows.filter((r) => r.value != null).sort((a, b) => b.value - a.value || b.cards - a.cards);
  const rest = rows.filter((r) => r.value == null).sort((a, b) => b.cards - a.cards);
  return [...ranked, ...rest];
}

// ---- Season grid -----------------------------------------------------------

// userId -> best confirmed card of one month: the best ranking value for
// `format` (most points, or fewest strokes to par); a card without one only
// when the member has no scored one.
function bestByUser(cards, format = 'stableford') {
  const better = (a, b) => compareScores(cardScore(a, format), cardScore(b, format), format) < 0;
  const best = new Map();
  confirmed(cards).filter((c) => !needsApproval(c)).forEach((c) => {
    if (!best.has(c.userId) || better(c, best.get(c.userId))) best.set(c.userId, c);
  });
  return best;
}

// Members x months: [{ userId, cells: [{ month, points, score, netDifferential, unrated, cardId, best }] }].
// Rows follow `members` (pass them in season-table order). cardId is null with
// no confirmed card; unrated: a confirmed card with no ranking value (not
// ranked); `score` is the ranking value for `format` (= points in a Stableford
// league) and `best` marks the month's best (ties all best). netDifferential is the
// best card's, secondary information (null on a tee that had no rating).
export function seasonGrid(cardsByMonth, members, monthKeys, format = 'stableford') {
  const perMonth = Object.fromEntries(monthKeys.map((month) => {
    const best = bestByUser(cardsByMonth?.[month], format);
    const scores = [...best.values()].map((c) => cardScore(c, format)).filter((v) => v != null);
    const top = scores.length ? [...scores].sort((a, b) => compareScores(a, b, format))[0] : null;
    return [month, { best, top }];
  }));
  return (members ?? []).map((m) => ({
    userId: m.userId,
    cells: monthKeys.map((month) => {
      const card = perMonth[month].best.get(m.userId);
      const points = card ? pointsOf(card) : null;
      const score = card ? cardScore(card, format) : null;
      return {
        month,
        points,
        score,
        netDifferential: card ? netDiffOf(card) : null,
        unrated: !!card && score == null,
        cardId: card?.id ?? null,
        best: score != null && score === perMonth[month].top,
      };
    }),
  }));
}

// ---- Rivals ----------------------------------------------------------------

// Months where both players have a ranked (scored, confirmed) card, newest
// first: [{ month, a, b }] with each side's ranking value (Stableford points,
// higher wins; strokes to par in a medal league, lower wins).
export function rivalMonths(cardsByMonth, a, b, format = 'stableford') {
  return Object.keys(cardsByMonth ?? {}).sort().reverse().flatMap((month) => {
    const best = bestByUser(cardsByMonth[month], format);
    const pa = cardScore(best.get(a), format);
    const pb = cardScore(best.get(b), format);
    return pa != null && pb != null ? [{ month, a: pa, b: pb }] : [];
  });
}

// Me against every other member: [{ userId, won, lost, level, months }] over
// the months both have a ranked card, closest rivalry first (smallest gap
// between won and lost, then most months); members I never shared a month
// with go last.
export function rivals(cardsByMonth, members, meId, format = 'stableford') {
  const rows = (members ?? []).filter((m) => m.userId !== meId).map((m) => {
    const months = rivalMonths(cardsByMonth, meId, m.userId, format);
    return {
      userId: m.userId,
      won: months.filter((x) => compareScores(x.a, x.b, format) < 0).length,
      lost: months.filter((x) => compareScores(x.a, x.b, format) > 0).length,
      level: months.filter((x) => x.a === x.b).length,
      months: months.length,
    };
  });
  const gap = (r) => Math.abs(r.won - r.lost);
  return rows.sort((a, b) => (b.months > 0) - (a.months > 0) || gap(a) - gap(b) || b.months - a.months);
}

// Season grid shading by a month's Stableford points: 36 or more is level with
// the handicap or better, 33-35 close, under 33 behind.
export function pointsBand(points) {
  if (points == null) return null;
  if (points >= 36) return 'high';
  return points >= 33 ? 'mid' : 'low';
}
