// Score-conflict markers are LOCAL-ONLY under sync-v2 (see mutate.js's
// recordScoreConflict / preserveLocalScoreConflicts): tournamentRepo.js
// strips round.scoreConflicts from every body write, so a marker can only
// ever live in the local blob. This suite exercises the full local
// round-trip: record -> visible via readLocal -> conflict.resolve clears it
// -> a reconcile-style overlay (fresh fetch + pending replay) still carries
// an UNRESOLVED marker forward instead of silently dropping it.
import {
  recordScoreConflict, preserveLocalScoreConflicts, mutate, applyPendingMutations,
} from '../mutate';

// In-memory fake backing readLocal/saveLocal so recordScoreConflict's write
// is actually visible to a later readLocal call in the same test — mirrors
// tournamentStore.js's real in-memory cache closely enough for this purpose.
let mockStore;
jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(async (id) => {
    const t = mockStore.get(id);
    return t ? JSON.parse(JSON.stringify(t)) : null;
  }),
  saveLocal: jest.fn(async (t) => {
    mockStore.set(t.id, JSON.parse(JSON.stringify(t)));
  }),
  _setSyncStatus: jest.fn(),
}));

jest.mock('../syncQueue', () => ({
  syncQueue: { enqueue: jest.fn(() => Promise.resolve()) },
}));

jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => false) }));

jest.mock('../syncWorker', () => ({ scheduleSync: jest.fn() }));

const { readLocal } = require('../tournamentStore');

function baseTournament() {
  return {
    id: 't1',
    name: 'Cup',
    createdAt: '2026-07-11T09:00:00Z',
    players: [{ id: 'p1', name: 'Ann' }],
    rounds: [{ id: 'r1', scores: { p1: { 3: 5 } } }],
  };
}

describe('recordScoreConflict', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = new Map([['t1', baseTournament()]]);
  });

  test('writes candidates keyed by the plain hole number (not "h"+hole) with a detectedAt stamp', async () => {
    await recordScoreConflict('t1', {
      roundId: 'r1', playerId: 'p1', hole: 3, mine: 5, theirs: 6,
    });

    const saved = await readLocal('t1');
    const marker = saved.rounds[0].scoreConflicts.p1[3];
    expect(marker).toBeTruthy();
    expect(marker.candidates.map((c) => c.value)).toEqual([5, 6]);
    expect(marker.candidates.every((c) => typeof c.ts === 'number')).toBe(true);
    expect(typeof marker.detectedAt).toBe('number');
    // Round-trip through the SAME key convention the UI reads (HolePage.js,
    // HoleView.js, ScorecardScreen.js's finishConflictRows, scoring.js's
    // listRoundConflicts) — a numeric-string key, never "h3".
    expect(saved.rounds[0].scoreConflicts.p1['h3']).toBeUndefined();
  });

  test('never enqueues or schedules a sync — local-only', async () => {
    await recordScoreConflict('t1', {
      roundId: 'r1', playerId: 'p1', hole: 3, mine: 5, theirs: 6,
    });

    const { syncQueue } = require('../syncQueue');
    expect(syncQueue.enqueue).not.toHaveBeenCalled();
    const { scheduleSync } = require('../syncWorker');
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  test('is a no-op when the round no longer exists locally', async () => {
    const result = await recordScoreConflict('t1', {
      roundId: 'gone', playerId: 'p1', hole: 3, mine: 5, theirs: 6,
    });
    expect(result.rounds[0].scoreConflicts).toBeUndefined();
  });

  test('full round trip: record -> visible in readLocal -> conflict.resolve clears it', async () => {
    await recordScoreConflict('t1', {
      roundId: 'r1', playerId: 'p1', hole: 3, mine: 5, theirs: 6,
    });
    let current = await readLocal('t1');
    expect(current.rounds[0].scoreConflicts.p1[3]).toBeTruthy();

    current = await mutate(current, {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3, value: 6, ts: 500,
    });

    expect(current.rounds[0].scoreConflicts.p1[3]).toBeUndefined();
    const persisted = await readLocal('t1');
    expect(persisted.rounds[0].scoreConflicts.p1[3]).toBeUndefined();
    expect(persisted.rounds[0].scores.p1[3]).toBe(6);
  });
});

describe('preserveLocalScoreConflicts', () => {
  test('carries an unresolved marker from source onto a target round missing it entirely', () => {
    const source = {
      rounds: [{ id: 'r1', scoreConflicts: { p1: { 3: { candidates: [{ value: 5 }, { value: 6 }], detectedAt: 1 } } } }],
    };
    // `target` mirrors a fresh repo fetch / applyPendingMutations replay —
    // NEVER carries scoreConflicts (tournamentRepo.js strips it).
    const target = { rounds: [{ id: 'r1', scores: { p1: { 3: 6 } } }] };

    const merged = preserveLocalScoreConflicts(target, source);

    expect(merged.rounds[0].scoreConflicts.p1[3].candidates.map((c) => c.value)).toEqual([5, 6]);
    // Nothing else on the round was clobbered.
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
  });

  test('a reconcile pass (applyPendingMutations + preserveLocalScoreConflicts) never silently drops the marker', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scoreConflicts: { p1: { 3: { candidates: [{ value: 5 }, { value: 6 }], detectedAt: 1 } } } }],
    };
    const fresh = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 3: 6 } } }] };

    const merged = preserveLocalScoreConflicts(applyPendingMutations(fresh, []), local);

    expect(merged.rounds[0].scoreConflicts.p1[3]).toBeTruthy();
  });

  test('is a no-op when neither side has rounds', () => {
    expect(preserveLocalScoreConflicts({ rounds: [] }, { rounds: [] })).toEqual({ rounds: [] });
    expect(preserveLocalScoreConflicts(null, { rounds: [{ id: 'r1' }] })).toBeNull();
  });
});
