import { applyToTournament, applyPendingMutations } from '../mutate';

describe('tournament.advanceRound mutation', () => {
  test('advances currentRound to the given index', () => {
    const t = { id: 't1', currentRound: 0, rounds: [] };
    applyToTournament(t, { type: 'tournament.advanceRound', roundIndex: 2 });
    expect(t.currentRound).toBe(2);
  });

  test('is monotonic: applying a lower roundIndex is a no-op', () => {
    const t = { id: 't1', currentRound: 2, rounds: [] };
    applyToTournament(t, { type: 'tournament.advanceRound', roundIndex: 0 });
    expect(t.currentRound).toBe(2);
  });

  test('treats a missing currentRound as 0', () => {
    const t = { id: 't1', rounds: [] };
    applyToTournament(t, { type: 'tournament.advanceRound', roundIndex: 1 });
    expect(t.currentRound).toBe(1);
  });
});

describe('round.reveal mutation', () => {
  function tournamentWithRound() {
    return {
      id: 't1',
      rounds: [{ id: 'r1', revealed: false, pairs: [['a', 'b'], ['c', 'd']] }],
    };
  }

  test('reveals the round without touching pairs when none given', () => {
    const t = tournamentWithRound();
    applyToTournament(t, { type: 'round.reveal', roundId: 'r1' });
    expect(t.rounds[0].revealed).toBe(true);
    expect(t.rounds[0].pairs).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('reveals the round and sets pairs when given', () => {
    const t = tournamentWithRound();
    const newPairs = [['a', 'c'], ['b', 'd']];
    applyToTournament(t, { type: 'round.reveal', roundId: 'r1', pairs: newPairs });
    expect(t.rounds[0].revealed).toBe(true);
    expect(t.rounds[0].pairs).toEqual(newPairs);
  });

  test('is a no-op when the round is missing', () => {
    const t = tournamentWithRound();
    applyToTournament(t, { type: 'round.reveal', roundId: 'rX', pairs: [['x', 'y']] });
    expect(t.rounds[0].revealed).toBe(false);
    expect(t.rounds[0].pairs).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('tournament.updateProfile mutation', () => {
  test('merges object-valued keys one level deep', () => {
    const t = { id: 't1', settings: { fixedTeams: true, manualTeams: false }, rounds: [] };
    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { settings: { manualTeams: true } },
    });
    expect(t.settings).toEqual({ fixedTeams: true, manualTeams: true });
  });

  test('replaces scalar and array values outright', () => {
    const t = { id: 't1', tags: ['a', 'b'], rounds: [] };
    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { tags: ['c'] },
    });
    expect(t.tags).toEqual(['c']);
  });

  test('an explicit null value sets the field to null locally', () => {
    const t = { id: 't1', notes: 'hello', rounds: [] };
    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { notes: null },
    });
    expect(t.notes).toBeNull();
  });

  test('name and kind set the plain fields directly', () => {
    const t = { id: 't1', name: 'Old', kind: 'casual', rounds: [] };
    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { name: 'New Name', kind: 'official' },
    });
    expect(t.name).toBe('New Name');
    expect(t.kind).toBe('official');
  });

  test('a null name/kind is skipped, leaving the existing value (server parity)', () => {
    const t = { id: 't1', name: 'Cup', kind: 'casual', rounds: [] };
    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { name: null, kind: null },
    });
    expect(t.name).toBe('Cup');
    expect(t.kind).toBe('casual');
  });

  test('a currentRound key in the patch applies monotonically', () => {
    const t = { id: 't1', currentRound: 2, rounds: [] };
    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { currentRound: 0 },
    });
    expect(t.currentRound).toBe(2);

    applyToTournament(t, {
      type: 'tournament.updateProfile',
      patch: { currentRound: 5 },
    });
    expect(t.currentRound).toBe(5);
  });
});

describe('tournament.create mutation', () => {
  test('is a local no-op (creation is already saved locally)', () => {
    const t = { id: 't1', name: 'Cup', rounds: [] };
    const before = JSON.parse(JSON.stringify(t));
    applyToTournament(t, {
      type: 'tournament.create',
      tournament: { id: 't2', name: 'Other' },
    });
    expect(t).toEqual(before);
  });
});

describe('applyPendingMutations', () => {
  test('applies a queued score.set on top of a fetched object without mutating the input', () => {
    const fetched = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    const entries = [
      { mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 5 }, path: 'rounds.r1.scores.p1.h3', ts: 100 },
    ];

    const result = applyPendingMutations(fetched, entries);

    expect(result.rounds[0].scores.p1[3]).toBe(5);
    expect(fetched.rounds[0].scores).toEqual({});
  });

  test('applies multiple entries in order', () => {
    const fetched = { id: 't1', currentRound: 0, rounds: [{ id: 'r1', scores: {} }] };
    const entries = [
      { mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 4 } },
      { mutation: { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 1, value: 5 } },
      { mutation: { type: 'tournament.advanceRound', roundIndex: 1 } },
    ];

    const result = applyPendingMutations(fetched, entries);

    expect(result.rounds[0].scores.p1[1]).toBe(5);
    expect(result.currentRound).toBe(1);
  });

  test('tolerates mutations referencing missing rounds/players as defensive no-ops', () => {
    const fetched = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    const entries = [
      { mutation: { type: 'score.set', roundId: 'rGone', playerId: 'p1', hole: 1, value: 4 } },
      { mutation: { type: 'round.reveal', roundId: 'rGone' } },
    ];

    expect(() => applyPendingMutations(fetched, entries)).not.toThrow();
    const result = applyPendingMutations(fetched, entries);
    expect(result.rounds[0].scores).toEqual({});
  });

  test('returns a clone, not the same reference as the input', () => {
    const fetched = { id: 't1', rounds: [] };
    const result = applyPendingMutations(fetched, []);
    expect(result).not.toBe(fetched);
    expect(result).toEqual(fetched);
  });
});
