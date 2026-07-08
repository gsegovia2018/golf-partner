import { applyToTournament } from '../mutate';

const P = (id) => ({ id, name: id });
const PAIRS = [[P('a'), P('b')], [P('c'), P('d')]];

describe('pairs.set mutation', () => {
  test('sets pairs and reveals the round by default', () => {
    const t = { rounds: [{ id: 'r1', pairs: [], revealed: false }] };

    applyToTournament(t, { type: 'pairs.set', roundId: 'r1', pairs: PAIRS });

    expect(t.rounds[0].pairs).toEqual(PAIRS);
    expect(t.rounds[0].revealed).toBe(true);
  });

  test('reveal:false sets pairs without revealing an unrevealed round', () => {
    const t = { rounds: [{ id: 'r2', pairs: [], revealed: false }] };

    applyToTournament(t, {
      type: 'pairs.set',
      roundId: 'r2',
      pairs: PAIRS,
      reveal: false,
    });

    expect(t.rounds[0].pairs).toEqual(PAIRS);
    expect(t.rounds[0].revealed).toBe(false);
  });

  test('reveal:false leaves an already-revealed round revealed', () => {
    const t = { rounds: [{ id: 'r3', pairs: [], revealed: true }] };

    applyToTournament(t, {
      type: 'pairs.set',
      roundId: 'r3',
      pairs: PAIRS,
      reveal: false,
    });

    expect(t.rounds[0].revealed).toBe(true);
  });
});
