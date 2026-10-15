// League standings: pure functions of the league's cards (no I/O).
// Plan: docs/superpowers/plans/2026-10-04-league.md (section 4.1); ranked by
// Stableford since docs/superpowers/plans/2026-10-13-league-review-followups.md (R1, R2);
// medal play since docs/superpowers/plans/2026-10-15-league-medal-play.md.
import { assignPlacements } from './leaderboardPlacement';
import { needsApproval } from './leagueRules';
import { formatNumber, t as i18nT } from '../i18n';

export const DEFAULT_POINTS_TABLE = [500, 300, 190, 135, 110, 90, 75, 60, 45, 35, 25, 15];

// A league's format (leagues.format): what a month ranks by.
//   stableford   card.points (net Stableford), more is better
//   medal_net    card.toPar (gross - playing handicap - par), fewer is better
//   medal_gross  card.toPar (gross - par), fewer is better
export const LEAGUE_FORMAT_KEYS = ['stableford', 'medal_net', 'medal_gross'];
export const isMedalFormat = (format) => format === 'medal_net' || format === 'medal_gross';

const toNumber = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Strokes to par bare, for a board column whose header says net or gross:
// -2 -> '−2' (true minus sign), 0 -> 'E', 4 -> '+4'. null -> '—'.
export function formatToPar(value, t = i18nT) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  return v === 0 ? t('league.scoring.level') : `${v < 0 ? '−' : '+'}${formatNumber(Math.abs(v))}`;
}

// The value a card ranks by in `format`: its Stableford points, or its strokes
// to par in a medal league. null when the server hasn't scored it for that.
export function cardScore(card, format = 'stableford') {
  return toNumber(isMedalFormat(format) ? card?.toPar : card?.points);
}

// Sort two ranking values best first for `format`; a null value goes last.
// Equal values compare 0 (a tie: no tie-break).
export function compareScores(a, b, format = 'stableford') {
  const x = a == null ? null : Number(a);
  const y = b == null ? null : Number(b);
  if (x === y) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return isMedalFormat(format) ? x - y : y - x;
}

// Is ranking value `a` better than `b` in `format`?
const isBetter = (a, b, format) => compareScores(a, b, format) < 0;

const byTotalDesc = (a, b) => b.total - a.total;

const memberId = (m) => (typeof m === 'string' ? m : m?.userId);

const netDiffOf = (card) => {
  if (card?.netDifferential == null || card.netDifferential === '') return null;
  const n = Number(card.netDifferential);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

// Table points for a tie group: the group occupies positions place..place+size-1
// and shares the sum of those table entries equally. Beyond the table = 0.
function sharedPoints(table, place, size) {
  let sum = 0;
  for (let i = place - 1; i < place - 1 + size; i++) sum += table[i] ?? 0;
  return sum / size;
}

// One month's results, ranked by the card's ranking value for the league's
// `format` (the server scores every card): net Stableford points, most first,
// or strokes to par in a medal league, fewest first. `members` are user ids
// or `{userId}`. Only confirmed cards count (a not-announced one only once an
// admin approved it); a member's best card is the one with the best value.
// Season points = the place's table share, but at least `participationPoints`
// for every ranked card (R2; no card = 0). Equal values tie and share the
// summed table points (no tie-break). A confirmed card without a value for
// the format (never scored) is not ranked: { place: null, unrated: true,
// seasonPoints: 0 }. Members without a confirmed card get place null and 0
// points. Unranked rows follow the ranked ones. A confirmed card from someone
// no longer in `members` (a member who left keeps past cards) still ranks.
// Rows carry the ranking value `cardScore`, the card's Stableford `cardPoints`
// (the same value in a Stableford league) and its `netDifferential`
// (secondary information). Ranked rows also carry `tieSize` (members on that
// place) and `floored` (the floor lifted the row above its table share).
export function monthResults(cards, members, pointsTable = DEFAULT_POINTS_TABLE, { participationPoints = 0, format = 'stableford' } = {}) {
  const floor = Math.max(0, Number(participationPoints) || 0);
  const medal = isMedalFormat(format);
  const byScore = (a, b) => compareScores(a.cardScore, b.cardScore, format);
  const best = new Map();
  const unrated = new Set();
  for (const c of cards ?? []) {
    if (c?.status !== 'confirmed' || needsApproval(c)) continue;
    const score = cardScore(c, format);
    if (score == null) {
      unrated.add(c.userId);
      continue;
    }
    if (!best.has(c.userId) || isBetter(score, best.get(c.userId).cardScore, format)) {
      best.set(c.userId, {
        cardScore: score,
        cardPoints: medal ? toNumber(c.points) : score,
        netDifferential: netDiffOf(c),
      });
    }
  }

  const ranked = [...best].map(([userId, b]) => ({ userId, ...b })).sort(byScore);
  const placed = assignPlacements(ranked, byScore);
  const sizes = {};
  placed.forEach((r) => { sizes[r.place] = (sizes[r.place] ?? 0) + 1; });

  const rows = placed.map((r) => {
    const share = sharedPoints(pointsTable, r.place, sizes[r.place]);
    return {
      userId: r.userId,
      place: r.place,
      isTie: r.isTie,
      tieSize: sizes[r.place],
      netDifferential: r.netDifferential,
      cardScore: r.cardScore,
      cardPoints: r.cardPoints,
      seasonPoints: Math.max(share, floor),
      // The place's own share is under the floor: the row got "points for playing".
      floored: share < floor,
    };
  });

  const seen = new Set(best.keys());
  for (const userId of unrated) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      userId, place: null, isTie: false, unrated: true, netDifferential: null, cardScore: null, cardPoints: null, seasonPoints: 0,
    });
  }
  for (const m of members ?? []) {
    const userId = memberId(m);
    if (seen.has(userId)) continue;
    seen.add(userId);
    // No card: Stableford keeps its historical 0; a medal value of 0 would
    // read as level par, so it is null there.
    rows.push({
      userId, place: null, isTie: false, netDifferential: null, cardScore: medal ? null : 0, cardPoints: 0, seasonPoints: 0,
    });
  }
  return rows;
}

// Season table over `cardsByMonth` ({ 'YYYY-MM': cards[] }). `options` are
// monthResults' ({ participationPoints, format }).
// lastMonthDelta = season points earned in the most recent month that has any
// confirmed card (0 when there is none).
export function seasonTable(members, cardsByMonth, pointsTable = DEFAULT_POINTS_TABLE, options = {}) {
  const months = Object.keys(cardsByMonth ?? {}).sort();
  const perMonth = months.map((month) => [month, monthResults(cardsByMonth[month], members, pointsTable, options)]);
  const lastMonth = [...perMonth].reverse()
    .find(([, rows]) => rows.some((r) => r.place != null))?.[0];

  const totals = new Map();
  const ensure = (userId) => {
    if (!totals.has(userId)) totals.set(userId, { userId, total: 0, byMonth: {}, lastMonthDelta: 0 });
    return totals.get(userId);
  };
  for (const m of members ?? []) ensure(memberId(m));
  for (const [month, rows] of perMonth) {
    for (const r of rows) {
      const t = ensure(r.userId);
      t.total += r.seasonPoints;
      t.byMonth[month] = { place: r.place, isTie: r.isTie, seasonPoints: r.seasonPoints };
      if (month === lastMonth) t.lastMonthDelta = r.seasonPoints;
    }
  }

  const sorted = [...totals.values()].sort(byTotalDesc);
  return assignPlacements(sorted, byTotalDesc);
}
