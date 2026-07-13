import { buildRoundRecap } from '../roundSummaryModel';

const players = [
  { id: 'p1', name: 'Marcos' },
  { id: 'p2', name: 'Pablo' },
  { id: 'p3', name: 'Luis' },
];

const holes = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1,
  par: index % 3 === 0 ? 5 : index % 3 === 1 ? 4 : 3,
  strokeIndex: index + 1,
}));

describe('roundSummaryModel', () => {
  test('buildRoundRecap reports winner, margin, winner strokes, holes played, and player count', () => {
    const round = {
      holes,
      scores: {
        p1: Object.fromEntries(holes.map((h) => [h.number, 4])),
        p2: Object.fromEntries(holes.map((h) => [h.number, 5])),
        p3: Object.fromEntries(holes.map((h) => [h.number, 6])),
      },
    };
    const ranked = [
      { player: players[0], points: 38, strokes: 72 },
      { player: players[1], points: 34, strokes: 81 },
      { player: players[2], points: 30, strokes: 90 },
    ];

    expect(buildRoundRecap({ round, ranked })).toEqual({
      winnerName: 'Marcos',
      winnerPoints: 38,
      margin: 4,
      winnerStrokes: 72,
      holesPlayed: 18,
      playerCount: 3,
    });
  });

  test('buildRoundRecap counts early-finished holes from entered scores across players', () => {
    const round = {
      holes,
      scores: {
        p1: { 1: 4, 2: 4, 3: 5, 4: null },
        p2: { 1: 5, 2: 4, 4: 3 },
        p3: { 1: 6, 3: 4 },
      },
    };
    const ranked = [
      { player: players[0], points: 9, strokes: 13 },
      { player: players[1], points: 8, strokes: 12 },
      { player: players[2], points: 5, strokes: 10 },
    ];

    expect(buildRoundRecap({ round, ranked })).toMatchObject({
      holesPlayed: 4,
      playerCount: 3,
    });
  });

  test('buildRoundRecap reports zero margin when there is no runner-up', () => {
    const round = {
      holes,
      scores: {
        p1: Object.fromEntries(holes.slice(0, 9).map((h) => [h.number, 4])),
      },
    };
    const ranked = [
      { player: players[0], points: 23, strokes: 49 },
    ];

    expect(buildRoundRecap({ round, ranked })).toMatchObject({
      winnerName: 'Marcos',
      winnerPoints: 23,
      margin: 0,
      playerCount: 1,
    });
  });

});
