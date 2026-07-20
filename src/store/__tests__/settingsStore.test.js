import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_APP_SETTINGS, getAppSettings, updateAppSettings,
  hydrateAppSettings, subscribeAppSettings, __resetAppSettingsForTests,
  SETTINGS_KEY, SETTINGS_DIRTY_KEY,
} from '../settingsStore';
import * as profileStore from '../profileStore';

jest.mock('../profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetAppSettingsForTests();
});

test('defaults are complete and getAppSettings starts at defaults', () => {
  expect(getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  expect(DEFAULT_APP_SETTINGS.gpsEnabled).toBe(true);
  expect(DEFAULT_APP_SETTINGS.statGroups).toEqual({
    putting: true, teeShot: true, approach: true, shortGame: true, penalties: true,
  });
  expect(DEFAULT_APP_SETTINGS.units).toBe('meters');
});

test('updateAppSettings deep-merges nested groups and notifies subscribers', async () => {
  profileStore.upsertProfile.mockResolvedValue();
  const spy = jest.fn();
  subscribeAppSettings(spy);
  await updateAppSettings({ statGroups: { putting: false } });
  expect(getAppSettings().statGroups.putting).toBe(false);
  expect(getAppSettings().statGroups.teeShot).toBe(true); // sibling preserved
  expect(spy).toHaveBeenCalled();
  expect(profileStore.upsertProfile).toHaveBeenCalledWith({ settings: getAppSettings() });
});

test('failed server write sets dirty flag; hydrate re-pushes it', async () => {
  profileStore.upsertProfile.mockRejectedValueOnce(new Error('offline'));
  await updateAppSettings({ haptics: false });
  expect(await AsyncStorage.getItem(SETTINGS_DIRTY_KEY)).toBe('1');
  profileStore.upsertProfile.mockResolvedValue();
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: {} });
  await hydrateAppSettings();
  expect(profileStore.upsertProfile).toHaveBeenCalledWith({ settings: expect.objectContaining({ haptics: false }) });
  expect(await AsyncStorage.getItem(SETTINGS_DIRTY_KEY)).toBeNull();
});

test('hydrate adopts server settings over local mirror when not dirty', async () => {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ haptics: false }));
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: { haptics: true, units: 'yards' } });
  await hydrateAppSettings();
  expect(getAppSettings().haptics).toBe(true);
  expect(getAppSettings().units).toBe('yards');
});

test('empty server blob: local (incl. legacy running-score import) is pushed up', async () => {
  await AsyncStorage.setItem('@scorecard_show_running_score', '0'); // legacy key
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: {} });
  profileStore.upsertProfile.mockResolvedValue();
  await hydrateAppSettings();
  expect(getAppSettings().showRunningScore).toBe(false);
  expect(profileStore.upsertProfile).toHaveBeenCalledWith({ settings: expect.objectContaining({ showRunningScore: false }) });
});

test('hydrate survives signed-out (loadProfile null) and network errors', async () => {
  profileStore.loadProfile.mockResolvedValueOnce(null);
  await expect(hydrateAppSettings()).resolves.toBeUndefined();
  profileStore.loadProfile.mockRejectedValueOnce(new Error('net'));
  await expect(hydrateAppSettings()).resolves.toBeUndefined();
});

test('hydrate push-branch persists the local mirror', async () => {
  await AsyncStorage.setItem('@scorecard_show_running_score', '0'); // legacy key
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: {} });
  profileStore.upsertProfile.mockResolvedValue();
  await hydrateAppSettings();
  const mirrored = JSON.parse(await AsyncStorage.getItem(SETTINGS_KEY));
  expect(mirrored.showRunningScore).toBe(false);
});

test('concurrent update during hydrate is not clobbered', async () => {
  let resolveProfile;
  profileStore.loadProfile.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
  profileStore.upsertProfile.mockResolvedValue();

  const h = hydrateAppSettings();
  await updateAppSettings({ haptics: false });
  resolveProfile({ userId: 'u1', settings: { haptics: true, units: 'yards' } });
  await h;

  expect(getAppSettings().haptics).toBe(false);
  expect(profileStore.upsertProfile).toHaveBeenLastCalledWith({
    settings: expect.objectContaining({ haptics: false }),
  });
});

test('concurrent update during mirror load is not clobbered', async () => {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ haptics: true }));
  profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: {} });
  profileStore.upsertProfile.mockResolvedValue();

  let resolveDeferred;
  const deferred = new Promise((resolve) => { resolveDeferred = resolve; });
  // AsyncStorage.getItem is already a jest.fn (from the async-storage mock),
  // so jest.spyOn reuses that same mock object rather than wrapping it.
  // Capturing the original via getMockImplementation() (a plain function)
  // avoids recursing back into our own mockImplementation below.
  const originalImpl = AsyncStorage.getItem.getMockImplementation();
  const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => {
    // Read the value now (capturing the pre-write snapshot), but delay
    // *returning* it — this simulates a read that was already in flight
    // when the concurrent write landed, which is the actual race being
    // guarded against (not a read that starts after the write).
    const value = await originalImpl(key);
    if (key === SETTINGS_KEY) await deferred;
    return value;
  });

  try {
    const h = hydrateAppSettings();
    await updateAppSettings({ haptics: false });
    resolveDeferred();
    await h;

    expect(getAppSettings().haptics).toBe(false);
    expect(profileStore.upsertProfile).toHaveBeenLastCalledWith({
      settings: expect.objectContaining({ haptics: false }),
    });
  } finally {
    spy.mockRestore();
  }
});
