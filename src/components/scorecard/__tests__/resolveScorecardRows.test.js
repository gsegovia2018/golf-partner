import { resolveScorecardRows } from '../GridView';

const players = [
  { id: 'p1', name: 'Ana', handicap: 10 },
  { id: 'p2', name: 'Bea', handicap: 20 },
];

describe('resolveScorecardRows', () => {
  test('defaults to stableford with players as rows', () => {
    const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
      round: { scoringMode: undefined },
      settings: {},
      players,
      meId: 'p2',
    });
    expect(mode).toBe('stableford');
    expect(rowPlayers).toBe(players);
    expect(rowHandicaps).toBeNull();
    expect(effectiveMeId).toBe('p2');
  });

  test('round scoringMode overrides settings and maps bestball', () => {
    const { mode } = resolveScorecardRows({
      round: { scoringMode: 'bestball' },
      settings: { scoringMode: 'stableford' },
      players,
      meId: 'p1',
    });
    expect(mode).toBe('bestball');
  });

  test('scramble mode swaps rows for team units keyed by captain', () => {
    const round = {
      scoringMode: 'scramblepairs',
      pairs: [[players[0], players[1]]],
      playerHandicaps: { p1: 10, p2: 20 },
    };
    const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
      round, settings: {}, players, meId: 'p2',
    });
    expect(mode).toBe('scramblepairs');
    expect(rowPlayers).toHaveLength(1);
    expect(rowPlayers[0].id).toBe('p1'); // captain = pair[0]
    expect(rowHandicaps).toHaveProperty('p1');
    expect(effectiveMeId).toBe('p1'); // me resolves to containing team's row
  });
});
