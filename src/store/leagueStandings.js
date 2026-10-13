// League standings: pure functions of the league's cards (no I/O).
// Plan: docs/superpowers/plans/2026-10-04-league.md (section 4.1); ranked by
// Stableford since docs/superpowers/plans/2026-10-13-league-review-followups.md (R1, R2).
import { assignPlacements } from './leaderboardPlacement';
import { needsApproval } from './leagueRules';

export const DEFAULT_POINTS_TABLE = [500, 300, 190, 135, 110, 90, 75, 60, 45, 35, 25, 15];

// More Stableford points is better; equal points are a tie (no tie-break).
const byPointsDesc = (a, b) => b.cardPoints - a.cardPoints;
const byTotalDesc = (a, b) => b.total - a.total;

const memberId = (m) => (typeof m === 'string' ? m : m?.userId);

const pointsOf = (card) => {
  if (card?.points == null || card.points === '') return null;
  const n = Number(card.points);
  return Number.isFinite(n) ? n : null;
};

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

// One month's results, ranked by the card's net Stableford points, highest
// first (the server scores every card). `members` are user ids or `{userId}`.
// Only confirmed cards count (a not-announced one only once an admin approved
// it); a member's best card is the one with the most points. Season points =
// the place's table share, but at least `participationPoints` for every ranked
// card (R2; no card = 0). A confirmed card without points (never scored) is
// not ranked: { place: null, unrated: true, seasonPoints: 0 }. Members without
// a confirmed card get place null and 0 points. Unranked rows follow the
// ranked ones. A confirmed card from someone no longer in `members` (a member
// who left keeps past cards) still ranks. Rows carry the ranking value
// `cardPoints` and the card's `netDifferential` (secondary information).
export function monthResults(cards, members, pointsTable = DEFAULT_POINTS_TABLE, { participationPoints = 0 } = {}) {
  const floor = Math.max(0, Number(participationPoints) || 0);
  const best = new Map();
  const unrated = new Set();
  for (const c of cards ?? []) {
    if (c?.status !== 'confirmed' || needsApproval(c)) continue;
    const cardPoints = pointsOf(c);
    if (cardPoints == null) {
      unrated.add(c.userId);
      continue;
    }
    if (!best.has(c.userId) || cardPoints > best.get(c.userId).cardPoints) {
      best.set(c.userId, { cardPoints, netDifferential: netDiffOf(c) });
    }
  }

  const ranked = [...best].map(([userId, b]) => ({ userId, ...b })).sort(byPointsDesc);
  const placed = assignPlacements(ranked, byPointsDesc);
  const sizes = {};
  placed.forEach((r) => { sizes[r.place] = (sizes[r.place] ?? 0) + 1; });

  const rows = placed.map((r) => ({
    userId: r.userId,
    place: r.place,
    isTie: r.isTie,
    netDifferential: r.netDifferential,
    cardPoints: r.cardPoints,
    seasonPoints: Math.max(sharedPoints(pointsTable, r.place, sizes[r.place]), floor),
  }));

  const seen = new Set(best.keys());
  for (const userId of unrated) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      userId, place: null, isTie: false, unrated: true, netDifferential: null, cardPoints: null, seasonPoints: 0,
    });
  }
  for (const m of members ?? []) {
    const userId = memberId(m);
    if (seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      userId, place: null, isTie: false, netDifferential: null, cardPoints: 0, seasonPoints: 0,
    });
  }
  return rows;
}

// Season table over `cardsByMonth` ({ 'YYYY-MM': cards[] }). `options` are
// monthResults' ({ participationPoints }).
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
