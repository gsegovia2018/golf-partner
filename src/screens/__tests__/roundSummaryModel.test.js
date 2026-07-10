import { buildRoundRecap, buildScorecardSections } from '../roundSummaryModel';

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
      { player: players[0], totalPoints: 38, totalStrokes: 72 },
      { player: players[1], totalPoints: 34, totalStrokes: 81 },
      { player: players[2], totalPoints: 30, totalStrokes: 90 },
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
      { player: players[0], totalPoints: 9, totalStrokes: 13 },
      { player: players[1], totalPoints: 8, totalStrokes: 12 },
      { player: players[2], totalPoints: 5, totalStrokes: 10 },
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
      { player: players[0], totalPoints: 23, totalStrokes: 49 },
    ];

    expect(buildRoundRecap({ round, ranked })).toMatchObject({
      winnerName: 'Marcos',
      winnerPoints: 23,
      margin: 0,
      playerCount: 1,
    });
  });

  test('buildScorecardSections splits front/back nine and totals null or missing scores as 0', () => {
    const round = {
      holes,
      scores: {
        p1: {
          1: 4,
          2: null,
          3: 5,
          9: 3,
          10: 4,
          11: 4,
          18: null,
        },
        p2: {
          1: 5,
          2: 4,
          9: 4,
          10: null,
          12: 6,
          18: 5,
        },
      },
    };
    const ranked = [
      { player: players[0], totalPoints: 20, totalStrokes: 20 },
      { player: players[1], totalPoints: 18, totalStrokes: 24 },
    ];

    const sections = buildScorecardSections({ round, ranked });

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      label: 'Front',
      holes: holes.slice(0, 9),
      parTotal: holes.slice(0, 9).reduce((sum, h) => sum + h.par, 0),
    });
    expect(sections[1]).toMatchObject({
      label: 'Back',
      holes: holes.slice(9, 18),
      parTotal: holes.slice(9, 18).reduce((sum, h) => sum + h.par, 0),
    });
    expect(sections[0]).not.toHaveProperty('rows');
    expect(sections[0].playerRows).toEqual([
      {
        playerId: 'p1',
        name: 'Marcos',
        scores: [4, null, 5, null, null, null, null, null, 3],
        total: 12,
        holesPlayed: 5,
        currentHole: null,
      },
      {
        playerId: 'p2',
        name: 'Pablo',
        scores: [5, 4, null, null, null, null, null, null, 4],
        total: 13,
        holesPlayed: 5,
        currentHole: null,
      },
    ]);
    expect(sections[1]).not.toHaveProperty('rows');
    expect(sections[1].playerRows).toEqual([
      {
        playerId: 'p1',
        name: 'Marcos',
        scores: [4, 4, null, null, null, null, null, null, null],
        total: 8,
        holesPlayed: 5,
        currentHole: null,
      },
      {
        playerId: 'p2',
        name: 'Pablo',
        scores: [null, null, 6, null, null, null, null, null, 5],
        total: 11,
        holesPlayed: 5,
        currentHole: null,
      },
    ]);
  });
});
