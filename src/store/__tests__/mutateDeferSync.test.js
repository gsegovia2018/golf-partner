// jest.mock calls are hoisted above imports by babel-jest.
jest.mock('../syncWorker', () => ({ scheduleSync: jest.fn(), syncNow: jest.fn() }));
jest.mock('../tournamentStore', () => ({
  saveLocal: jest.fn(async () => {}),
  _setSyncStatus: jest.fn(),
}));
jest.mock('../syncQueue', () => ({ syncQueue: { enqueue: jest.fn(async () => {}) } }));
jest.mock('../../lib/connectivity', () => ({ isOnline: () => true }));

// eslint-disable-next-line import/first
import { mutate } from '../mutate';
// eslint-disable-next-line import/first
import { scheduleSync } from '../syncWorker';
// eslint-disable-next-line import/first
import { syncQueue } from '../syncQueue';
// eslint-disable-next-line import/first
import { saveLocal, _setSyncStatus } from '../tournamentStore';

const baseTournament = () => ({ id: 't1', rounds: [{ id: 'r1', scores: {} }] });
const scoreMutation = { type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 3, value: 5 };

beforeEach(() => jest.clearAllMocks());

describe('mutate deferSync option', () => {
  it('deferSync skips the sync kick but still saves locally and enqueues', async () => {
    const t = await mutate(baseTournament(), scoreMutation, { deferSync: true });
    expect(saveLocal).toHaveBeenCalledTimes(1);
    expect(syncQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(scheduleSync).not.toHaveBeenCalled();
    expect(_setSyncStatus).toHaveBeenCalledWith('pending');
    expect(t.rounds[0].scores.p1[3]).toBe(5);
  });

  it('default (no opts) still kicks sync immediately', async () => {
    await mutate(baseTournament(), scoreMutation);
    expect(scheduleSync).toHaveBeenCalledTimes(1);
  });
});
