import { applyToTournament, preserveLocalConflictState } from '../mutate';
import { listRoundConflicts } from '../scoreEntries';

const base = () => ({ id: 't', rounds: [{ id: 'r0', scores: {}, scoreEntries: {}, scoreResolutions: {} }] });

test('score.set records the author entry and the optimistic effective value', () => {
  const t = base();
  applyToTournament(t, { type: 'score.set', roundId: 'r0', playerId: 'p1', hole: 3, value: 4, authorId: 'a', ts: 100 });
  expect(t.rounds[0].scores.p1[3]).toBe(4);
  expect(t.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 100 });
});

test('conflict.resolve writes a resolution stamp', () => {
  const t = base();
  applyToTournament(t, { type: 'conflict.resolve', roundId: 'r0', playerId: 'p1', hole: 3, value: 5, resolvedBy: 'a', ts: 200 });
  expect(t.rounds[0].scores.p1[3]).toBe(5);
  expect(t.rounds[0].scoreResolutions.p1[3]).toEqual({ value: 5, by: 'a', ts: 200 });
});

test('preserveLocalConflictState carries entries+resolutions from source onto target when target has none (fetch-path case)', () => {
  const target = { rounds: [{ id: 'r0', scores: {} }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } }, scoreResolutions: { p1: { 3: { value: 4, by: 'a', ts: 2 } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 1 });
  expect(out.rounds[0].scoreResolutions.p1[3]).toEqual({ value: 4, by: 'a', ts: 2 });
});

test('preserveLocalConflictState unions scoreEntries per authorId (target has b, source has a for the same cell)', () => {
  const target = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { b: { value: 5, ts: 20 } } } } }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 10 } } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3]).toEqual({
    a: { value: 4, ts: 10 },
    b: { value: 5, ts: 20 },
  });
});

test('preserveLocalConflictState prefers target when both sides have the same authorId for a scoreEntries cell', () => {
  const target = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 9, ts: 30 } } } } }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 10 } } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3]).toEqual({ a: { value: 9, ts: 30 } });
});

test('preserveLocalConflictState returns source scoreEntries unchanged when target has none', () => {
  const target = { rounds: [{ id: 'r0', scores: {} }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries).toEqual(source.rounds[0].scoreEntries);
});

test('preserveLocalConflictState unions scoreResolutions per cell (target has hole 5, source has hole 3)', () => {
  const target = { rounds: [{ id: 'r0', scoreResolutions: { p1: { 5: { value: 4, by: 'b', ts: 40 } } } }] };
  const source = { rounds: [{ id: 'r0', scoreResolutions: { p1: { 3: { value: 4, by: 'a', ts: 2 } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreResolutions.p1).toEqual({
    3: { value: 4, by: 'a', ts: 2 },
    5: { value: 4, by: 'b', ts: 40 },
  });
});

test('preserveLocalConflictState prefers target when both sides have a resolution for the same cell', () => {
  const target = { rounds: [{ id: 'r0', scoreResolutions: { p1: { 3: { value: 9, by: 'b', ts: 99 } } } }] };
  const source = { rounds: [{ id: 'r0', scoreResolutions: { p1: { 3: { value: 4, by: 'a', ts: 2 } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreResolutions.p1[3]).toEqual({ value: 9, by: 'b', ts: 99 });
});

// Task 8: removePlayer deletes round.scoreEntries[playerId] locally (see
// addPlayerMutation.test.js's 'drops the removed player from scoreEntries'),
// so a conflict derivation over that round must never surface a conflict
// for the removed player again.
test('listRoundConflicts derives no conflict for a player whose scoreEntries removePlayer already deleted', () => {
  const t = base();
  t.rounds[0].scoreEntries = {
    p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 6, ts: 20 } } },
  };
  applyToTournament(t, {
    type: 'tournament.removePlayer', playerId: 'p1', roundPatches: [{ roundId: 'r0' }],
  });
  expect(listRoundConflicts(t.rounds[0])).toEqual([]);
});

// Task 8: preserveLocalConflictState's `source` argument is frequently a
// STALE cache/pre-row snapshot taken before a queued removePlayer stripped
// a player's entries — the plain union must not resurrect that player from
// `source` once removePlayer's round.removedPlayerIds tombstone (see
// mutate.js's removePlayer apply branch) marks them gone. A DIFFERENT
// player (p2) with no tombstone entry is unaffected.
test('preserveLocalConflictState does not resurrect a removed player\'s scoreEntries/scoreResolutions once tombstoned', () => {
  const target = {
    rounds: [{
      id: 'r0', scoreEntries: {}, scoreResolutions: {}, removedPlayerIds: ['p1'],
    }],
  };
  const source = {
    rounds: [{
      id: 'r0',
      scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } }, p2: { 1: { a: { value: 5, ts: 1 } } } },
      scoreResolutions: { p1: { 3: { value: 4, by: 'a', ts: 1 } } },
    }],
  };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1).toBeUndefined();
  expect(out.rounds[0].scoreEntries.p2).toEqual({ 1: { a: { value: 5, ts: 1 } } });
  expect(out.rounds[0].scoreResolutions.p1).toBeUndefined();
});

// The tombstone itself must survive the merge (it's unioned like any other
// local-only hot key) so it keeps guarding across repeated reconcile passes
// even once `target` stops carrying it directly (e.g. a post-drain fresh
// fetch, which never had it to begin with).
test('preserveLocalConflictState unions removedPlayerIds from source onto target', () => {
  const target = { rounds: [{ id: 'r0', scoreEntries: {} }] };
  const source = { rounds: [{ id: 'r0', removedPlayerIds: ['p1'] }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].removedPlayerIds).toEqual(['p1']);
});

// Without any removePlayer tombstone, ordinary score-entry merging (as
// exercised throughout this file) is unaffected.
test('preserveLocalConflictState does not prune anything when no player is tombstoned', () => {
  const target = { rounds: [{ id: 'r0', scores: {} }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 1 });
});

// Task 8 CRITICAL-2 (roster gate): player ids are library-stable and REUSED
// on re-add, so a tombstoned playerId who is BACK on the current roster must
// NOT be pruned — otherwise a remove→re-add of the same person permanently
// disables their conflict detection in any tombstoned round.
test('preserveLocalConflictState keeps a tombstoned player\'s entries once they are back on the roster', () => {
  const target = {
    players: [{ id: 'p1' }],
    rounds: [{ id: 'r0', scoreEntries: {}, removedPlayerIds: ['p1'] }],
  };
  const source = {
    rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 6, ts: 20 } } } } }],
  };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3]).toEqual({ a: { value: 4, ts: 10 }, b: { value: 6, ts: 20 } });
  expect(listRoundConflicts(out.rounds[0])).toEqual([{ playerId: 'p1', hole: 3 }]);
});

// Task 8 CRITICAL-2 end-to-end: remove then re-add the SAME player id, then
// they score again in a not-yet-played round — their fresh scoreEntries must
// derive a conflict, with no phantom suppression from the stale tombstone.
test('remove-then-re-add of the same player id restores conflict detection in a not-yet-played round', () => {
  const t = {
    id: 't', currentRound: 0,
    players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    rounds: [{ id: 'r0', scores: {}, scoreEntries: {}, scoreResolutions: {} }],
  };
  applyToTournament(t, { type: 'tournament.removePlayer', playerId: 'p1', roundPatches: [{ roundId: 'r0' }] });
  expect(t.rounds[0].removedPlayerIds).toEqual(['p1']);

  // Re-add clears the tombstone for p1 on the patched round.
  applyToTournament(t, {
    type: 'tournament.addPlayer',
    player: { id: 'p1', name: 'P1' },
    roundPatches: [{ roundId: 'r0', playerHandicap: 10 }],
  });
  expect(t.rounds[0].removedPlayerIds).toBeUndefined();

  // p1 scores again, with two disagreeing authors -> a real conflict.
  applyToTournament(t, { type: 'score.set', roundId: 'r0', playerId: 'p1', hole: 4, value: 5, authorId: 'a', ts: 100 });
  applyToTournament(t, { type: 'score.set', roundId: 'r0', playerId: 'p1', hole: 4, value: 6, authorId: 'b', ts: 110 });
  expect(listRoundConflicts(t.rounds[0])).toEqual([{ playerId: 'p1', hole: 4 }]);

  // A later reconcile must not resurrect the tombstone or prune the entries.
  const merged = preserveLocalConflictState(
    { players: t.players, rounds: [{ id: 'r0', scoreEntries: {}, scoreResolutions: {} }] },
    t,
  );
  expect(listRoundConflicts(merged.rounds[0])).toEqual([{ playerId: 'p1', hole: 4 }]);
});

// Task 8 CRITICAL-1 (history preserved): removePlayer only touches the rounds
// in roundPatches (not-yet-played rounds — removePlayerRoundPatches leaves
// already-played earlier rounds alone), so an already-played round's
// scoreEntries for the removed player are neither deleted nor tombstoned, and
// survive a subsequent union reconcile even after the player leaves the roster.
test('removePlayer preserves the removed player\'s scoreEntries in an already-played round (not in roundPatches)', () => {
  const t = {
    id: 't', currentRound: 1,
    players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    rounds: [
      // r0: already played, p1 has recorded history here
      { id: 'r0', scores: { p1: { 3: 4 } }, scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } }, scoreResolutions: {} },
      // r1: current/not-yet-played
      { id: 'r1', scores: {}, scoreEntries: {}, scoreResolutions: {} },
    ],
  };
  // The removal only patches r1 (removePlayerRoundPatches skips r0).
  applyToTournament(t, { type: 'tournament.removePlayer', playerId: 'p1', roundPatches: [{ roundId: 'r1' }] });
  expect(t.rounds[0].removedPlayerIds).toBeUndefined();      // played round not tombstoned
  expect(t.rounds[0].scoreEntries.p1).toBeDefined();          // history intact locally

  // A reconcile against a stale source that still carries r0's history must
  // keep it — p1 is off the roster now, but r0 has no tombstone so the
  // roster gate never even applies there.
  const stale = {
    rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } }, scoreResolutions: {} }],
  };
  const merged = preserveLocalConflictState(t, stale);
  expect(merged.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 1 });
});
