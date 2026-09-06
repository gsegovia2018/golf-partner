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

describe('tournament.setFinished mutation', () => {
  test('stamps an unfinished tournament', () => {
    const t = { id: 't1', rounds: [] };
    applyToTournament(t, { type: 'tournament.setFinished', finishedAt: '2026-08-04T19:24:55.450Z' });
    expect(t.finishedAt).toBe('2026-08-04T19:24:55.450Z');
  });

  test('first write wins: a later stamp does not move an existing one', () => {
    const t = { id: 't1', rounds: [], finishedAt: '2026-08-04T19:24:55.450Z' };
    applyToTournament(t, { type: 'tournament.setFinished', finishedAt: '2026-09-06T00:50:07.516Z' });
    expect(t.finishedAt).toBe('2026-08-04T19:24:55.450Z');
  });

  test('null reopens, and a fresh stamp lands afterwards', () => {
    const t = { id: 't1', rounds: [], finishedAt: '2026-08-04T19:24:55.450Z' };
    applyToTournament(t, { type: 'tournament.setFinished', finishedAt: null });
    expect(t.finishedAt).toBeNull();
    applyToTournament(t, { type: 'tournament.setFinished', finishedAt: '2026-09-06T00:50:07.516Z' });
    expect(t.finishedAt).toBe('2026-09-06T00:50:07.516Z');
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

describe('tournament.addPlayer mutation', () => {
  test('appends a new player', () => {
    const t = { id: 't1', players: [{ id: 'p0' }], rounds: [] };
    applyToTournament(t, { type: 'tournament.addPlayer', player: { id: 'p1', name: 'A' } });
    expect(t.players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  // Idempotency guards the realtime self-echo race: a realtime INSERT patches
  // the new player into the cache, then applyPendingMutations replays the
  // still-queued addPlayer on top of that same base — without a dedupe the
  // player would appear twice.
  test('is idempotent by player id — applying twice yields a single entry', () => {
    const t = { id: 't1', players: [{ id: 'p0' }], rounds: [] };
    const m = { type: 'tournament.addPlayer', player: { id: 'p1', name: 'A' } };
    applyToTournament(t, m);
    applyToTournament(t, m);
    expect(t.players.filter((p) => p.id === 'p1')).toHaveLength(1);
    expect(t.players.map((p) => p.id)).toEqual(['p0', 'p1']);
  });
});

describe('round.upsert mutation', () => {
  test('a NEW round (idx === -1) inserts the whole object at roundIndex', () => {
    const t = { id: 't1', rounds: [{ id: 'r1' }] };
    const newRound = { id: 'r2', courseName: 'Links', scores: {} };
    applyToTournament(t, {
      type: 'round.upsert', roundId: 'r2', roundIndex: 1, round: newRound, isNew: true,
    });
    expect(t.rounds).toEqual([{ id: 'r1' }, newRound]);
  });

  test('an EXISTING round merges only the owned fields (courseName/courseId/holes/tees/playerTees), preserving scores/pairs/revealed/scoringMode/notes', () => {
    const existing = {
      id: 'r1',
      courseName: 'Old Course',
      holes: [{ number: 1, par: 4 }],
      scores: { p1: { 1: 4 } },
      shotDetails: { p1: { 1: { putts: 2 } } },
      pairs: [['p1'], ['p2']],
      revealed: true,
      scoringMode: 'matchplay',
      notes: { round: 'windy' },
    };
    const t = { id: 't1', rounds: [existing] };
    // A stale snapshot from EditTournamentScreen: the course was renamed, but
    // pairs/scores/revealed/scoringMode/notes are all stale (server-side
    // truth for those has since moved on via their own dedicated mutations).
    const staleSnapshot = {
      id: 'r1',
      courseName: 'New Course',
      courseId: 'course-2',
      holes: [{ number: 1, par: 5 }],
      tees: [{ label: 'White' }],
      playerTees: { p1: { label: 'White' } },
      scores: {},
      shotDetails: {},
      pairs: [['p1', 'p2']],
      revealed: false,
      scoringMode: 'stableford',
      notes: { round: 'stale note' },
    };

    applyToTournament(t, {
      type: 'round.upsert', roundId: 'r1', roundIndex: 0, round: staleSnapshot, isNew: false,
    });

    // Owned fields updated from the snapshot.
    expect(t.rounds[0].courseName).toBe('New Course');
    expect(t.rounds[0].courseId).toBe('course-2');
    expect(t.rounds[0].holes).toEqual([{ number: 1, par: 5 }]);
    expect(t.rounds[0].tees).toEqual([{ label: 'White' }]);
    expect(t.rounds[0].playerTees).toEqual({ p1: { label: 'White' } });
    // Everything else is the EXISTING round's value, not the stale snapshot's.
    expect(t.rounds[0].scores).toEqual({ p1: { 1: 4 } });
    expect(t.rounds[0].shotDetails).toEqual({ p1: { 1: { putts: 2 } } });
    expect(t.rounds[0].pairs).toEqual([['p1'], ['p2']]);
    expect(t.rounds[0].revealed).toBe(true);
    expect(t.rounds[0].scoringMode).toBe('matchplay');
    expect(t.rounds[0].notes).toEqual({ round: 'windy' });
  });
});

describe('applyPendingMutations', () => {
  test('applies a queued setup mutation on top of a fetched object without mutating the input', () => {
    const fetched = { id: 't1', rounds: [{ id: 'r1', notes: {} }] };
    const entries = [
      { mutation: { type: 'note.set', roundId: 'r1', scope: 'round', text: 'Windy' }, path: 'rounds.r1.notes.round', ts: 100 },
    ];

    const result = applyPendingMutations(fetched, entries);

    expect(result.rounds[0].notes.round).toBe('Windy');
    expect(fetched.rounds[0].notes).toEqual({});
  });

  test('applies multiple entries in order', () => {
    const fetched = { id: 't1', currentRound: 0, rounds: [{ id: 'r1', notes: {} }] };
    const entries = [
      { mutation: { type: 'note.set', roundId: 'r1', scope: 'round', text: 'Windy' } },
      { mutation: { type: 'note.set', roundId: 'r1', scope: 'round', text: 'Calm' } },
      { mutation: { type: 'tournament.advanceRound', roundIndex: 1 } },
    ];

    const result = applyPendingMutations(fetched, entries);

    expect(result.rounds[0].notes.round).toBe('Calm');
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
