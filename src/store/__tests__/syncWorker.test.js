// Regression test for the drainTournament read-modify-write race:
// the sync worker snapshots the local blob, does a slow network fetchRemote,
// then merges + writes back. An edit made WHILE fetchRemote is in flight is
// saved locally but absent from the pre-fetch snapshot — writing the merged
// snapshot back silently reverts that just-entered score / shot detail.
//
// jest.mock calls are hoisted above these imports by babel-jest, so the
// mocks are in place before ../syncWorker and its dependencies load.
import { drainTournament } from '../syncWorker';
import { readLocal, saveLocal } from '../tournamentStore';

let mockRemote = null;

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: mockRemote == null ? null : { data: mockRemote },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(),
  saveLocal: jest.fn(() => Promise.resolve()),
  pushRemote: jest.fn(() => Promise.resolve()),
  _setSyncStatus: jest.fn(),
  _appendConflicts: jest.fn(() => Promise.resolve()),
  _setLastSyncAt: jest.fn(() => Promise.resolve()),
}));

jest.mock('../syncQueue', () => ({
  syncQueue: {
    drop: jest.fn(() => Promise.resolve()),
    all: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../libraryStore', () => ({ upsertPlayer: jest.fn() }));

jest.mock('../../lib/connectivity', () => ({
  isOnline: jest.fn(() => true),
  subscribeConnectivity: jest.fn(),
}));

// One round, one player, hole 5 — a strokes value and a putts shot detail,
// each with a matching _meta timestamp so mergeTournaments can LWW them.
const blob = (strokes, strokesTs, putts, puttsTs) => ({
  id: 't1',
  rounds: [{
    id: 'r1',
    scores: { p1: { 5: strokes } },
    shotDetails: { p1: { 5: { putts } } },
  }],
  _meta: {
    'rounds.r1.scores.p1.h5': strokesTs,
    'rounds.r1.shotDetails.p1.h5': puttsTs,
  },
});

describe('drainTournament', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemote = null;
  });

  test('edits made while fetchRemote is in flight are not reverted', async () => {
    // Pre-fetch snapshot: hole 5 = 5 strokes, 1 putt.
    // During the fetch the user taps hole 5 to 6 strokes / 3 putts (saved
    // locally, newer timestamps). The server still holds the old values.
    readLocal
      .mockResolvedValueOnce(blob(5, 1000, 1, 1000))
      .mockResolvedValueOnce(blob(6, 2000, 3, 2000));
    mockRemote = blob(5, 1000, 1, 1000);

    await drainTournament('t1', [{ id: 'e1' }]);

    const saved = saveLocal.mock.calls[0][0];
    expect(saved.rounds[0].scores.p1[5]).toBe(6);
    expect(saved.rounds[0].shotDetails.p1[5].putts).toBe(3);
  });
});
