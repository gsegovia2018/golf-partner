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
