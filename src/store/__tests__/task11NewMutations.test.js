// Task 11: new mutation types introduced to convert the last blob-push call
// sites (EditTournamentScreen/PlayersScreen bulk round+roster saves) to
// mutations. Pure applyToTournament/metaPathFor coverage — mutationWrites.test.js
// covers the server-write (repo call) side.
import { applyToTournament, metaPathFor } from '../mutate';

describe('round.upsert mutation', () => {
  function baseTournament() {
    return {
      id: 't1',
      rounds: [{ id: 'r1', courseName: 'Old Course', holes: [], playerHandicaps: { p1: 10 } }],
    };
  }

  test('bumps a coarse per-round path', () => {
    expect(metaPathFor({ type: 'round.upsert', roundId: 'r1' })).toBe('rounds.r1.upsert');
  });

  // Fix: an EXISTING round's local replay mirrors the server write
  // (mutationWrites.js's ROUND_UPSERT_OWNED_FIELDS) — only courseName/
  // courseId/holes/tees/playerTees are taken from the snapshot; everything
  // else (playerHandicaps here) is owned elsewhere and stays as it was,
  // rather than the whole round object being swapped in.
  test('merges only the owned fields onto an existing round, preserving position and non-owned fields', () => {
    const t = baseTournament();
    const newRound = { id: 'r1', courseName: 'New Course', holes: [{ number: 1, par: 4 }], playerHandicaps: { p1: 12 } };

    applyToTournament(t, { type: 'round.upsert', roundId: 'r1', roundIndex: 0, round: newRound });

    expect(t.rounds).toHaveLength(1);
    expect(t.rounds[0]).toEqual({
      id: 'r1', courseName: 'New Course', holes: [{ number: 1, par: 4 }], playerHandicaps: { p1: 10 },
    });
  });

  test('inserts a brand-new round at roundIndex (EditTournamentScreen addRound)', () => {
    const t = baseTournament();
    const secondRound = { id: 'r2', courseName: 'Second Course', holes: [] };

    applyToTournament(t, { type: 'round.upsert', roundId: 'r2', roundIndex: 1, round: secondRound });

    expect(t.rounds.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  // Regression fix follow-up: `isNew` is a hint consumed ONLY by
  // mutationWrites.js (server-write side, to pick upsertRound vs patchRound)
  // — it's pure metadata here and must not change the local owned-fields-only
  // apply for an existing round, nor the coarse path metaPathFor returns.
  test('isNew is inert for local apply/metaPathFor (server-write-only signal)', () => {
    const t = baseTournament();
    const newRound = { id: 'r1', courseName: 'New Course', holes: [{ number: 1, par: 4 }], playerHandicaps: { p1: 12 } };

    applyToTournament(t, {
      type: 'round.upsert', roundId: 'r1', roundIndex: 0, round: newRound, isNew: true,
    });

    expect(t.rounds[0]).toEqual({
      id: 'r1', courseName: 'New Course', holes: [{ number: 1, par: 4 }], playerHandicaps: { p1: 10 },
    });
    expect(metaPathFor({ type: 'round.upsert', roundId: 'r1', isNew: true })).toBe('rounds.r1.upsert');
  });
});

describe('tournament.updatePlayer mutation', () => {
  function baseTournament() {
    return {
      id: 't1',
      players: [
        { id: 'p1', name: 'Ann', handicap: 10 },
        { id: 'p2', name: 'Bea', handicap: 12 },
      ],
    };
  }

  test('bumps the players path', () => {
    expect(metaPathFor({ type: 'tournament.updatePlayer', playerId: 'p1' })).toBe('players');
  });

  test('patches only the targeted player, leaving others untouched', () => {
    const t = baseTournament();
    applyToTournament(t, { type: 'tournament.updatePlayer', playerId: 'p1', patch: { handicap: 8, user_id: 'u-1' } });

    expect(t.players.find((p) => p.id === 'p1')).toEqual({ id: 'p1', name: 'Ann', handicap: 8, user_id: 'u-1' });
    expect(t.players.find((p) => p.id === 'p2')).toEqual({ id: 'p2', name: 'Bea', handicap: 12 });
  });

  test('is a no-op when the player is not on the roster', () => {
    const t = baseTournament();
    applyToTournament(t, { type: 'tournament.updatePlayer', playerId: 'gone', patch: { handicap: 1 } });
    expect(t.players).toHaveLength(2);
  });
});
