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
