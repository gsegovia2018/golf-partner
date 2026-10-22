// A league card as the app's one read-only scorecard (components/scorecard/
// ShotScorecard): the card's course snapshot and holes become a one-player
// round, played off the card's frozen playing handicap. Pure, no I/O.
import { scorecardModel } from './scorecardView';

export function leagueScorecardModel(card, name) {
  const holes = [...(card?.course?.holes ?? [])].sort((a, b) => a.n - b.n);
  if (holes.length === 0 || !card?.holes) return null;
  const id = card.userId ?? 'me';
  const scores = {};
  holes.forEach((h) => {
    const strokes = Number(card.holes[String(h.n)]);
    if (strokes > 0) scores[h.n] = strokes;
  });
  const round = {
    holes: holes.map((h) => ({ number: h.n, par: h.par, strokeIndex: h.si })),
    scores: { [id]: scores },
  };
  return scorecardModel({
    round,
    players: [{ id, name: name ?? '' }],
    meId: id,
    mode: 'stableford',
    handicaps: { [id]: card.playingHandicap ?? 0 },
  });
}
