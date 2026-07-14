import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getDeviceAuthorId,
  initDeviceAuthorId,
  _resetDeviceAuthorIdCacheForTests,
} from '../deviceId';

// Regression coverage for the "spurious score conflict on an unclaimed
// device" bug: getDeviceAuthorId() used to return a freshly-generated random
// id synchronously and only later swap in the persisted id once AsyncStorage
// resolved. Scores authored in that window were stamped with a throwaway id
// that never matched later writes from the same physical device, so
// deriveCell() (scoreEntries.js) saw two "authors" for one player/hole and
// surfaced an unresolvable conflict. The fix hydrates the persisted id BEFORE
// any score can be authored via an awaited initDeviceAuthorId().

describe('deviceId', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    AsyncStorage.setItem.mockClear();
    _resetDeviceAuthorIdCacheForTests();
  });

  test('getDeviceAuthorId() returns null before init has resolved (never a throwaway id)', () => {
    expect(getDeviceAuthorId()).toBeNull();
  });

  test('after init, repeated getDeviceAuthorId() calls return the same stable id', async () => {
    await initDeviceAuthorId();
    const first = getDeviceAuthorId();
    const second = getDeviceAuthorId();
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
  });

  test('first run generates and persists exactly one id, even with concurrent init calls', async () => {
    const [a, b] = await Promise.all([initDeviceAuthorId(), initDeviceAuthorId()]);
    expect(a).toBe(b);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const persisted = await AsyncStorage.getItem('@golf_device_author_id');
    expect(persisted).toBe(a);
  });

  test('id persists across a simulated app reload (same AsyncStorage, cache cleared)', async () => {
    const id1 = await initDeviceAuthorId();

    // Simulate an app relaunch: the in-memory module cache is gone, but the
    // physical device's AsyncStorage is untouched.
    _resetDeviceAuthorIdCacheForTests();
    AsyncStorage.setItem.mockClear();

    const id2 = await initDeviceAuthorId();
    expect(id2).toBe(id1);
    // Second hydration reads the already-persisted id; it must not
    // re-generate or re-write a new one.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('two devices (independent processes) never collide on a fresh id', async () => {
    const idA = await initDeviceAuthorId();
    await AsyncStorage.clear();
    _resetDeviceAuthorIdCacheForTests();
    const idB = await initDeviceAuthorId();
    expect(idA).not.toBe(idB);
  });
});
