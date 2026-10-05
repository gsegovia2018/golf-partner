// League standings: pure functions of the league's cards (no I/O).
// Plan: docs/superpowers/plans/2026-10-04-league.md (section 4.1).
import { assignPlacements } from './leaderboardPlacement';

export const DEFAULT_POINTS_TABLE = [500, 300, 190, 135, 110, 90, 75, 60, 45, 35, 25, 15];

// Lower net differential is better; equal to one decimal is a tie.
const byNetDiffAsc = (a, b) => a.netDifferential - b.netDifferential;
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

// One month's results, ranked by net differential (lowest first). `members`
// are user ids or `{userId}`. Only confirmed cards count; a member's best card
// is the lowest net differential. A confirmed card with no net differential
// (its tee has no slope/rating) is not ranked: { place: null, unrated: true,
// seasonPoints: 0 }. Members without a confirmed card get place null and 0
// points. Unranked rows follow the ranked ones. A confirmed card from someone
// no longer in `members` (a member who left keeps past cards) still ranks.
// Rows carry `netDifferential` and the card's Stableford `cardPoints`
// (secondary information).
export function monthResults(cards, members, pointsTable = DEFAULT_POINTS_TABLE) {
  const best = new Map();
  const unrated = new Map();
  for (const c of cards ?? []) {
    if (c?.status !== 'confirmed') continue;
    const nd = netDiffOf(c);
    const cardPoints = Number(c.points) || 0;
    if (nd == null) {
      if (!unrated.has(c.userId) || cardPoints > unrated.get(c.userId)) unrated.set(c.userId, cardPoints);
      continue;
    }
    if (!best.has(c.userId) || nd < best.get(c.userId).netDifferential) {
      best.set(c.userId, { netDifferential: nd, cardPoints });
    }
  }

  const ranked = [...best].map(([userId, b]) => ({ userId, ...b })).sort(byNetDiffAsc);
  const placed = assignPlacements(ranked, byNetDiffAsc);
  const sizes = {};
  placed.forEach((r) => { sizes[r.place] = (sizes[r.place] ?? 0) + 1; });

  const rows = placed.map((r) => ({
    userId: r.userId,
    place: r.place,
    isTie: r.isTie,
    netDifferential: r.netDifferential,
    cardPoints: r.cardPoints,
    seasonPoints: sharedPoints(pointsTable, r.place, sizes[r.place]),
  }));

  const seen = new Set(best.keys());
  for (const [userId, cardPoints] of unrated) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      userId, place: null, isTie: false, unrated: true, netDifferential: null, cardPoints, seasonPoints: 0,
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

// Season table over `cardsByMonth` ({ 'YYYY-MM': cards[] }).
// lastMonthDelta = season points earned in the most recent month that has any
// confirmed card (0 when there is none).
export function seasonTable(members, cardsByMonth, pointsTable = DEFAULT_POINTS_TABLE) {
  const months = Object.keys(cardsByMonth ?? {}).sort();
  const perMonth = months.map((month) => [month, monthResults(cardsByMonth[month], members, pointsTable)]);
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
