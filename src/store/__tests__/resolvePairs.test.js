import { resolvePairs } from '../scoring';
import {
  pairDifferenceByHole,
  matchPlayResults,
  pairConfigMatrix,
  pairSynergy,
  pairCarryRatio,
  pairPerformance,
  swingHole,
} from '../statsEngine';
import { buildTournament, holes18 } from './statsFixtures';

// round.pairs persists ids only (see thinPairs). Every consumer that shows a
// member's NAME has to resolve it against the roster — reading `member.name`
// straight off a pair yields undefined now that the snapshot is gone.
describe('resolvePairs', () => {
  const players = [
    { id: 'a', name: 'Ann Lee', handicap: 10 },
    { id: 'b', name: 'Bob Ray', handicap: 12 },
  ];

  test('swaps thin members for their roster player', () => {
    expect(resolvePairs([[{ id: 'a' }, { id: 'b' }]], players))
      .toEqual([[players[0], players[1]]]);
  });

  test('keeps the thin member when the roster has no match', () => {
    expect(resolvePairs([[{ id: 'ghost' }]], players)).toEqual([[{ id: 'ghost' }]]);
  });

  test('passes non-array input through untouched', () => {
    expect(resolvePairs(undefined, players)).toBeUndefined();
    expect(resolvePairs(null, players)).toBeNull();
  });
});

describe('statsEngine surfaces named pair members from thin pairs', () => {
  const players = [
    { id: 'a', name: 'Ann Lee', handicap: 0 },
    { id: 'b', name: 'Bob Ray', handicap: 0 },
    { id: 'c', name: 'Cam Fox', handicap: 0 },
    { id: 'd', name: 'Dan Oak', handicap: 0 },
  ];
  // Thin pairs — exactly what the store persists and the server returns.
  const pairs = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]];
  const holes = holes18();
  const scores = Object.fromEntries(players.map((p, i) => [
    p.id,
    Object.fromEntries(holes.map((h) => [h.number, h.par + (i % 2)])),
  ]));
  const tournament = buildTournament({
    players,
    rounds: [{
      courseName: 'Fixture GC',
      holes,
      pairs,
      scores,
      playerHandicaps: { a: 0, b: 0, c: 0, d: 0 },
    }],
  });

  const names = (pair) => pair.map((p) => p.name);

  test('pairDifferenceByHole returns roster players', () => {
    const data = pairDifferenceByHole(tournament, 0);
    expect(names(data.pair1)).toEqual(['Ann Lee', 'Bob Ray']);
    expect(names(data.pair2)).toEqual(['Cam Fox', 'Dan Oak']);
  });

  test('swingHole carries the resolved pairs through', () => {
    const swing = swingHole(tournament, 0);
    expect(names(swing.pair1)).toEqual(['Ann Lee', 'Bob Ray']);
    expect(names(swing.pair2)).toEqual(['Cam Fox', 'Dan Oak']);
  });

  test('matchPlayResults returns roster players', () => {
    const [round] = matchPlayResults(tournament);
    expect(names(round.pair1)).toEqual(['Ann Lee', 'Bob Ray']);
    expect(names(round.pair2)).toEqual(['Cam Fox', 'Dan Oak']);
  });

  test('pairConfigMatrix sides are roster players', () => {
    const [cfg] = pairConfigMatrix(tournament);
    expect(names(cfg.sideA)).toEqual(['Ann Lee', 'Bob Ray']);
    expect(names(cfg.sideB)).toEqual(['Cam Fox', 'Dan Oak']);
  });

  test('pairSynergy members are roster players', () => {
    const entries = pairSynergy(tournament);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(names(entry.members).every(Boolean)).toBe(true);
    }
  });

  test('pairCarryRatio members are roster players', () => {
    const entries = pairCarryRatio(tournament);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(names(entry.members).every(Boolean)).toBe(true);
      expect(entry.shares.every((s) => s.player.name)).toBe(true);
    }
  });

  test('pairPerformance players are roster players', () => {
    const entries = pairPerformance(tournament);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(names(entry.players).every(Boolean)).toBe(true);
    }
  });
});
