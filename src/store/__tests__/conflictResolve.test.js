import { mutate, metaPathFor, applyToTournament } from '../mutate';

jest.mock('../syncWorker', () => ({ scheduleSync: jest.fn(), syncNow: jest.fn() }));
jest.mock('../tournamentStore', () => ({
  saveLocal: jest.fn(async () => {}),
  _setSyncStatus: jest.fn(),
}));
jest.mock('../syncQueue', () => ({ syncQueue: { enqueue: jest.fn(async () => {}) } }));
jest.mock('../../lib/connectivity', () => ({ isOnline: () => true }));

const baseTournament = () => ({
  id: 't1',
  rounds: [{
    id: 'r1',
    scores: { p1: { 3: 5 } },
    scoreConflicts: { p1: { 3: { candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 90 }], detectedAt: 110 } } },
  }],
});

describe('conflict.resolve', () => {
  it('stamps a scoreResolutions path alongside score and marker paths', () => {
    const paths = metaPathFor({ type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3 });
    expect(paths).toEqual([
      'rounds.r1.scores.p1.h3',
      'rounds.r1.scoreConflicts.p1.h3',
      'rounds.r1.scoreResolutions.p1.h3',
    ]);
  });

  it('records the resolution timestamp in the blob', async () => {
    const t = await mutate(baseTournament(), {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3, value: 6, ts: 500,
    });
    expect(t.rounds[0].scores.p1[3]).toBe(6);
    expect(t.rounds[0].scoreConflicts.p1[3]).toBeUndefined();
    expect(t.rounds[0].scoreResolutions.p1[3]).toBe(500);
  });

  it('resolving to null deletes the score key', async () => {
    const t = await mutate(baseTournament(), {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 3, value: null, ts: 500,
    });
    expect(Object.prototype.hasOwnProperty.call(t.rounds[0].scores.p1, '3')).toBe(false);
  });

  it('removePlayer clears the player scoreResolutions path', () => {
    const paths = metaPathFor({
      type: 'tournament.removePlayer', playerId: 'p1',
      roundPatches: [{ roundId: 'r1' }],
    });
    expect(paths).toContain('rounds.r1.scoreResolutions.p1');
    const t = baseTournament();
    t.rounds[0].scoreResolutions = { p1: { 3: 500 } };
    applyToTournament(t, { type: 'tournament.removePlayer', playerId: 'p1', roundPatches: [{ roundId: 'r1' }] });
    expect(t.rounds[0].scoreResolutions.p1).toBeUndefined();
  });
});
