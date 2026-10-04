import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueLeagueFinal, flushPendingLeagueFinals, getPendingLeagueFinals,
  isRetryableFinalError, resetLeagueFinalPendingForTests,
} from '../leagueFinalPending';

jest.mock('../../store/leagueStore', () => ({ recordLeagueFinal: jest.fn() }));
jest.mock('../../store/syncWorker', () => ({ onSyncDrained: jest.fn() }));
const { recordLeagueFinal } = require('../../store/leagueStore');

const entry = { leagueId: 'L1', tournamentId: 't1', strokes: { u1: 0, u2: 3 } };
const fk = Object.assign(new Error('violates league_finals_tournament_id_fkey'), { code: '23503' });
const offline = Object.assign(new Error('You need a connection to do this.'), { offline: true });
const refused = Object.assign(new Error('Only an admin can do this.'), { code: '42501' });

describe('pending league Final link', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetLeagueFinalPendingForTests();
    await AsyncStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { jest.useRealTimers(); console.warn.mockRestore(); });

  test('classifies retryable errors', () => {
    expect(isRetryableFinalError(fk)).toBe(true);
    expect(isRetryableFinalError(offline)).toBe(true);
    expect(isRetryableFinalError(refused)).toBe(false);
  });

  test('keeps the entry when the FK is not satisfied yet, or offline', async () => {
    await enqueueLeagueFinal(entry);
    recordLeagueFinal.mockRejectedValueOnce(fk);
    await flushPendingLeagueFinals();
    expect(await getPendingLeagueFinals()).toEqual([entry]);
    recordLeagueFinal.mockRejectedValueOnce(offline);
    await flushPendingLeagueFinals();
    expect(await getPendingLeagueFinals()).toEqual([entry]);
  });

  test('success removes the entry', async () => {
    await enqueueLeagueFinal(entry);
    recordLeagueFinal.mockResolvedValue();
    await flushPendingLeagueFinals();
    expect(recordLeagueFinal).toHaveBeenCalledWith('L1', 't1', { u1: 0, u2: 3 });
    expect(await getPendingLeagueFinals()).toEqual([]);
  });

  test('a non-retryable refusal drops the entry', async () => {
    await enqueueLeagueFinal(entry);
    recordLeagueFinal.mockRejectedValue(refused);
    await flushPendingLeagueFinals();
    expect(await getPendingLeagueFinals()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  test('the backoff timer retries on its own', async () => {
    recordLeagueFinal.mockResolvedValue();
    await enqueueLeagueFinal(entry);
    expect(recordLeagueFinal).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(recordLeagueFinal).toHaveBeenCalledTimes(1);
    expect(await getPendingLeagueFinals()).toEqual([]);
  });
});
