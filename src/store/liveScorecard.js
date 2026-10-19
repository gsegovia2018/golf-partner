// Pure data for the Home Live scorecard variants: the read-only scorecard
// (scorecardModel) cut to what a glance on the course needs. Input is a phase
// entry ({ tournament, round, roundIndex }) whose round already carries the
// card engine's scores and my shot detail (homePhase withCardScores).
import { scorecardModel } from './scorecardView';
import { roundLeaderboard } from './tournamentStore';
import { roundScoringMode } from './scoring';
import { myPlayerIn } from './homePhase';

// The nine being played: the back once my next hole is 10 or later (or I
// have finished the front and nothing is left on it). One block on a 9-hole card.
export function currentNineKey(round, nextHoleNumber) {
  const holes = round?.holes ?? [];
  if (holes.length <= 9) return 'tot';
  if (nextHoleNumber == null) return 'in';
  return nextHoleNumber >= 10 ? 'in' : 'out';
}

// A card showing only one nine.
export function cardNine(card, key) {
  const idx = card.nines.findIndex((n) => n.key === key);
  if (idx < 0) return card;
  return {
    ...card,
    nines: [card.nines[idx]],
    rows: card.rows.map((r) => ({ ...r, nines: [r.nines[idx]] })),
  };
}

// Which Live card a round gets: my own card when I play alone, the group's
// points card otherwise.
export function liveCardKind({ tournament }) {
  return (tournament?.players ?? []).length <= 1 ? 'solo' : 'group';
}

export function liveScorecard({ tournament, round }, userId) {
  const players = tournament.players ?? [];
  const me = myPlayerIn(tournament, userId);
  const mode = roundScoringMode(tournament, round);
  const board = roundLeaderboard(tournament, round).entries ?? [];
  const order = new Map(board.map((e, i) => [e.player?.id, i]));
  const full = scorecardModel({ round, players, meId: me?.id ?? null, mode });
  // Leaderboard order; the Live card opens the scorecard on tap, so no row expands here.
  const rows = full.rows
    .map((r) => ({ ...r, canExpand: false }))
    .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const card = { ...full, rows };

  const pointsOf = (id) => board.find((e) => e.player?.id === id)?.points ?? 0;
  const standings = rows.map((r) => {
    const points = pointsOf(r.id);
    return {
      id: r.id,
      label: r.label,
      points,
      thru: r.total.holes,
      place: 1 + rows.filter((o) => pointsOf(o.id) > points).length,
      me: r.isMe,
    };
  });
  const mine = standings.find((x) => x.me) ?? null;
  const rivals = standings.filter((x) => !x.me);
  let gap = null;
  if (mine && rivals.length > 0) {
    const best = rivals.reduce((a, b) => (b.points > a.points ? b : a));
    gap = best.points >= mine.points
      ? { kind: best.points === mine.points ? 'level' : 'behind', gap: best.points - mine.points, playerId: best.id }
      : { kind: 'lead', gap: mine.points - best.points, playerId: best.id };
  }

  const myRow = me ? full.rows.find((r) => r.id === me.id) : null;
  const playedOf = (r) => new Set(r.nines.flatMap((n) => n.cells).filter((c) => c.strokes != null).map((c) => c.number));
  const mineDone = myRow ? playedOf(myRow) : new Set();
  const next = (round.holes ?? []).find((h) => !mineDone.has(h.number)) ?? null;
  const nineKey = currentNineKey(round, next?.number ?? null);

  return {
    mode,
    card,
    nineCard: cardNine(card, nineKey),
    nineKey,
    standings,
    gap,
    next: next ? { number: next.number, par: next.par ?? null, strokeIndex: next.strokeIndex ?? null } : null,
    myCard: me ? scorecardModel({ round, players: [me], meId: me.id, mode }) : null,
  };
}
