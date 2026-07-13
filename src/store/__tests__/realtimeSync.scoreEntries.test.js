import { applyScoreEntryRow, applyScoreResolutionRow } from '../realtimeSync';

const t = () => ({ rounds: [{ id: 'r0', scores: {}, scoreEntries: {}, scoreResolutions: {} }] });

test('applyScoreEntryRow writes the author entry', () => {
  const out = applyScoreEntryRow(t(), {
    round_id: 'r0', player_id: 'p1', hole: 3, author_id: 'a', strokes: 4,
    updated_at: '2026-07-13T10:00:00.000Z',
  }, 'INSERT');
  expect(out.rounds[0].scoreEntries.p1[3].a.value).toBe(4);
  expect(typeof out.rounds[0].scoreEntries.p1[3].a.ts).toBe('number');
});

test('applyScoreEntryRow removes the author entry on DELETE', () => {
  const seed = t(); seed.rounds[0].scoreEntries = { p1: { 3: { a: { value: 4, ts: 1 } } } };
  const out = applyScoreEntryRow(seed, { round_id: 'r0', player_id: 'p1', hole: 3, author_id: 'a' }, 'DELETE');
  expect(out.rounds[0].scoreEntries.p1?.[3]?.a).toBeUndefined();
});

test('applyScoreResolutionRow writes the resolution', () => {
  const out = applyScoreResolutionRow(t(), {
    round_id: 'r0', player_id: 'p1', hole: 3, value: 5, resolved_by: 'a',
    resolved_at: '2026-07-13T10:05:00.000Z',
  }, 'INSERT');
  expect(out.rounds[0].scoreResolutions.p1[3]).toMatchObject({ value: 5, by: 'a' });
});
