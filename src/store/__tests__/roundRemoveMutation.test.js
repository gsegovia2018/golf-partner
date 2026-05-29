import { mutate } from '../mutate';
import { syncQueue } from '../syncQueue';
import { _setSyncStatus, saveLocal } from '../tournamentStore';

jest.mock('../syncQueue', () => ({
  syncQueue: {
    enqueue: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../tournamentStore', () => ({
  _setSyncStatus: jest.fn(),
  saveLocal: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/connectivity', () => ({
  isOnline: jest.fn(() => false),
}));

jest.mock('../syncWorker', () => ({
  scheduleSync: jest.fn(),
}));

describe('round.remove mutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('removes the round and stamps the deletion tombstone path', async () => {
    const tournament = {
      id: 't1',
      name: 'Cup',
      createdAt: '2026-05-29T10:00:00Z',
      rounds: [{ id: 'r1' }, { id: 'r2' }],
      players: [],
    };

    const updated = await mutate(tournament, {
      type: 'round.remove',
      roundId: 'r1',
      ts: 99,
    });

    expect(updated.rounds.map((r) => r.id)).toEqual(['r2']);
    expect(updated._meta['rounds.r1._deleted']).toBe(99);
    expect(saveLocal).toHaveBeenCalledWith(updated);
    expect(syncQueue.enqueue).toHaveBeenCalledWith({
      tournamentId: 't1',
      mutation: { type: 'round.remove', roundId: 'r1', ts: 99 },
      path: 'rounds.r1._deleted',
    });
    expect(_setSyncStatus).toHaveBeenCalledWith('pending');
  });
});
