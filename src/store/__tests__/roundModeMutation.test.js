import { applyToTournament, metaPathFor } from '../mutate';

const P = (id) => ({ id, name: id });
const PAIRS = [[P('a'), P('b')], [P('c'), P('d')]];

describe('round.setScoringMode mutation', () => {
  it('sets the round override and pairs, preserving revealed', () => {
    const t = { rounds: [{ id: 'r1', pairs: [], revealed: false }] };
    applyToTournament(t, {
      type: 'round.setScoringMode', roundId: 'r1',
      scoringMode: 'scramblepairs', pairs: PAIRS,
    });
    expect(t.rounds[0].scoringMode).toBe('scramblepairs');
    expect(t.rounds[0].pairs).toEqual(PAIRS);
    expect(t.rounds[0].revealed).toBe(false);
  });

  it('leaves a revealed round revealed', () => {
    const t = { rounds: [{ id: 'r1', pairs: [], revealed: true }] };
    applyToTournament(t, {
      type: 'round.setScoringMode', roundId: 'r1',
      scoringMode: 'matchplay', pairs: [[P('a')], [P('b')]],
    });
    expect(t.rounds[0].revealed).toBe(true);
  });

  it('meta paths cover mode and pairs', () => {
    expect(metaPathFor({ type: 'round.setScoringMode', roundId: 'r1', scoringMode: 'x', pairs: [] }))
      .toEqual(['rounds.r1.scoringMode', 'rounds.r1.pairs']);
  });
});

describe('tournament.setScoringMode clears per-round overrides', () => {
  it('deletes round.scoringMode on patched rounds', () => {
    const t = {
      settings: { scoringMode: 'stableford' },
      rounds: [
        { id: 'r0', scoringMode: 'scramblepairs', pairs: [] },
        { id: 'r1', scoringMode: 'pairsmatchplay', pairs: [] },
      ],
    };
    applyToTournament(t, {
      type: 'tournament.setScoringMode', scoringMode: 'bestball',
      roundPatches: [{ roundId: 'r1', pairs: PAIRS }],
    });
    expect(t.settings.scoringMode).toBe('bestball');
    expect(t.rounds[1].scoringMode).toBeUndefined();
    expect(t.rounds[1].pairs).toEqual(PAIRS);
    // Unpatched (already played) round keeps its override.
    expect(t.rounds[0].scoringMode).toBe('scramblepairs');
  });

  it('meta paths include per-round scoringMode for patched rounds', () => {
    const paths = metaPathFor({
      type: 'tournament.setScoringMode', scoringMode: 'bestball',
      roundPatches: [{ roundId: 'r1', pairs: PAIRS }],
    });
    expect(paths).toEqual(expect.arrayContaining([
      'settings.scoringMode', 'rounds.r1.pairs', 'rounds.r1.scoringMode',
    ]));
  });
});

describe('tournament.addPlayer / tournament.removePlayer clear an invalidated round override', () => {
  it('addPlayer deletes round.scoringMode when the patch carries clearScoringMode', () => {
    const t = {
      players: [P('a'), P('b'), P('c')],
      settings: { scoringMode: 'individual' },
      rounds: [{ id: 'r0', scoringMode: 'matchplay', pairs: [], revealed: false }],
    };
    applyToTournament(t, {
      type: 'tournament.addPlayer',
      player: P('d'),
      roundPatches: [{
        roundId: 'r0', playerHandicap: 5, pairs: PAIRS, clearScoringMode: true,
      }],
      nextScoringMode: 'individual',
    });
    expect(t.rounds[0].scoringMode).toBeUndefined();
    expect(t.rounds[0].pairs).toEqual(PAIRS);
  });

  it('addPlayer meta paths include the round scoringMode path when clearScoringMode is set', () => {
    const paths = metaPathFor({
      type: 'tournament.addPlayer',
      player: P('d'),
      roundPatches: [{
        roundId: 'r0', playerHandicap: 5, pairs: PAIRS, clearScoringMode: true,
      }],
    });
    expect(paths).toEqual(expect.arrayContaining(['rounds.r0.scoringMode']));
  });

  it('removePlayer deletes round.scoringMode when the patch carries clearScoringMode', () => {
    const t = {
      players: [P('a'), P('b'), P('c'), P('d')],
      settings: { scoringMode: 'individual' },
      rounds: [{ id: 'r0', scoringMode: 'scramblepairs', pairs: [], revealed: false }],
    };
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r0', pairs: PAIRS, clearScoringMode: true }],
      nextScoringMode: 'individual',
    });
    expect(t.rounds[0].scoringMode).toBeUndefined();
    expect(t.rounds[0].pairs).toEqual(PAIRS);
  });

  it('removePlayer meta paths include the round scoringMode path when clearScoringMode is set', () => {
    const paths = metaPathFor({
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r0', pairs: PAIRS, clearScoringMode: true }],
    });
    expect(paths).toEqual(expect.arrayContaining(['rounds.r0.scoringMode']));
  });
});
