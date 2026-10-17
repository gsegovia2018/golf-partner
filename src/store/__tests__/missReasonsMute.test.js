import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRoundMuted, muteRound, __resetForTests } from '../missReasonsMute';

// In-memory backing so the LRU order is exercised against real round trips.
jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map();
  return {
    getItem: jest.fn(async (k) => (data.has(k) ? data.get(k) : null)),
    setItem: jest.fn(async (k, v) => { data.set(k, v); }),
    removeItem: jest.fn(async (k) => { data.delete(k); }),
    __data: data,
  };
});

const KEY = 'missReasons.mutedRounds';

describe('missReasonsMute', () => {
  beforeEach(async () => {
    await __resetForTests();
    jest.clearAllMocks();
  });

  it('reports an unmuted round as not muted', async () => {
    expect(await isRoundMuted('r1')).toBe(false);
  });

  it('mutes a round and reports it muted', async () => {
    await muteRound('r1');
    expect(await isRoundMuted('r1')).toBe(true);
    expect(await isRoundMuted('r2')).toBe(false);
  });

  it('treats null or undefined round ids as not muted and ignores muting them', async () => {
    await muteRound(null);
    await muteRound(undefined);
    expect(await isRoundMuted(null)).toBe(false);
    expect(await isRoundMuted(undefined)).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps at most 20 rounds and drops the oldest', async () => {
    for (let i = 1; i <= 21; i += 1) await muteRound(`r${i}`);
    expect(await isRoundMuted('r1')).toBe(false);
    expect(await isRoundMuted('r2')).toBe(true);
    expect(await isRoundMuted('r21')).toBe(true);
    expect(JSON.parse(AsyncStorage.__data.get(KEY))).toHaveLength(20);
  });

  it('moves a re-muted round to the front instead of duplicating it', async () => {
    await muteRound('a');
    await muteRound('b');
    await muteRound('a');
    expect(JSON.parse(AsyncStorage.__data.get(KEY))).toEqual(['a', 'b']);
  });

  it('keeps the re-muted round alive when the cap is reached', async () => {
    for (let i = 1; i <= 20; i += 1) await muteRound(`r${i}`);
    await muteRound('r1');
    await muteRound('r21');
    expect(await isRoundMuted('r1')).toBe(true);
    expect(await isRoundMuted('r2')).toBe(false);
  });

  it('treats a corrupt stored value as empty', async () => {
    AsyncStorage.__data.set(KEY, '{not json');
    expect(await isRoundMuted('r1')).toBe(false);
    await muteRound('r1');
    expect(JSON.parse(AsyncStorage.__data.get(KEY))).toEqual(['r1']);
  });

  it('treats a non-array stored value as empty', async () => {
    AsyncStorage.__data.set(KEY, JSON.stringify({ r1: true }));
    expect(await isRoundMuted('r1')).toBe(false);
  });

  it('reports not muted when storage throws, and swallows write errors', async () => {
    AsyncStorage.getItem.mockRejectedValueOnce(new Error('disk gone'));
    expect(await isRoundMuted('r1')).toBe(false);
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk gone'));
    await expect(muteRound('r1')).resolves.toBeUndefined();
  });
});
