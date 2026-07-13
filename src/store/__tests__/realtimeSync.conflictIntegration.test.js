// Regression coverage for the "peer entries wiped by preserveLocalConflictState"
// bug: makeHandler's settle loop calls preserveLocalConflictState(merged, cached)
// AFTER a game_score_entries row has already been patched into `merged`. A
// wholesale-replace-with-cached implementation discarded that freshly-applied
// peer row, so a cross-device conflict could never surface. Unlike
// realtimeSync.test.js (which mocks '../mutate' entirely so this bug is
// invisible), this file drives a real row through the REAL
// preserveLocalConflictState so the union-merge behavior is exercised
// end-to-end: local cache already has author 'a', a peer row lands for
// author 'b' on the same cell, and both must survive into the saved blob.
import { readLocal, saveLocal } from '../tournamentStore';
import { syncQueue } from '../syncQueue';
import { supabase } from '../../lib/supabase';
import { ensureRealtimeForTournament, stopRealtime } from '../realtimeSync';
import { deriveCell } from '../scoreEntries';

jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(),
  saveLocal: jest.fn(() => Promise.resolve()),
}));

jest.mock('../syncQueue', () => ({
  syncQueue: { all: jest.fn(() => Promise.resolve([])) },
}));

jest.mock('../../lib/supabase', () => {
  const channel = {
    on: jest.fn(function on() { return this; }),
    subscribe: jest.fn(function subscribe() { return this; }),
  };
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
    },
  };
});

describe('makeHandler(game_score_entries) with the real mutate.preserveLocalConflictState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncQueue.all.mockResolvedValue([]);
  });

  afterEach(() => {
    stopRealtime();
  });

  test('a peer author entry survives alongside the local author entry and the cell reports a conflict', async () => {
    const cached = {
      id: 't1',
      kind: 'game',
      meId: 'a',
      rounds: [{
        id: 'r1',
        scores: {},
        scoreEntries: { p1: { 3: { a: { value: 4, ts: 10 } } } },
        scoreResolutions: {},
      }],
      players: [],
    };
    readLocal.mockResolvedValue(cached);

    await ensureRealtimeForTournament('t1');
    const channel = supabase.channel.mock.results[0].value;
    const entriesHandlerCall = channel.on.mock.calls.find(([, cfg]) => cfg.table === 'game_score_entries');
    const handler = entriesHandlerCall[2];

    await handler({
      eventType: 'INSERT',
      new: {
        round_id: 'r1', player_id: 'p1', hole: 3, author_id: 'b', strokes: 5,
        updated_at: '2026-07-13T10:00:20.000Z',
      },
    });

    expect(saveLocal).toHaveBeenCalledTimes(1);
    const [savedArg] = saveLocal.mock.calls[0];
    const round = savedArg.rounds.find((r) => r.id === 'r1');

    // Both authors' entries for the cell must be present — the peer row (b)
    // must not have been discarded by restoring the pre-row cached copy.
    expect(round.scoreEntries.p1[3].a).toEqual({ value: 4, ts: 10 });
    expect(round.scoreEntries.p1[3].b).toEqual({ value: 5, ts: expect.any(Number) });
    expect(deriveCell(round, 'p1', 3).status).toBe('conflict');
  });
});
