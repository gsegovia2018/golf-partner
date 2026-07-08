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
