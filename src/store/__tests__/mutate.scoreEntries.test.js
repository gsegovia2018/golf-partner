import { applyToTournament, preserveLocalConflictState } from '../mutate';

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

test('preserveLocalConflictState carries entries+resolutions from source onto target', () => {
  const target = { rounds: [{ id: 'r0', scores: {} }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } }, scoreResolutions: { p1: { 3: { value: 4, by: 'a', ts: 2 } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 1 });
  expect(out.rounds[0].scoreResolutions.p1[3]).toEqual({ value: 4, by: 'a', ts: 2 });
});
