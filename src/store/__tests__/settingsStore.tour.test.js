import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_APP_SETTINGS, mergeAppSettings, getAppSettings, updateAppSettings,
  hydrateAppSettings, isSettingsHydrated, subscribeSettingsHydration,
  __resetAppSettingsForTests,
} from '../settingsStore';
import * as profileStore from '../profileStore';

jest.mock('../profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn().mockResolvedValue({}),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetAppSettingsForTests();
});

describe('tour defaults', () => {
  it('defaults both chapters to null (= show)', () => {
    expect(DEFAULT_APP_SETTINGS.tour).toEqual({ home: null, scorecard: null });
  });

  it('merges a one-chapter patch without losing the other', () => {
    const out = mergeAppSettings(DEFAULT_APP_SETTINGS, { tour: { home: '2026-07-22T00:00:00.000Z' } });
    expect(out.tour).toEqual({ home: '2026-07-22T00:00:00.000Z', scorecard: null });
  });

  it('old server blobs without tour still expose defaults', async () => {
    profileStore.loadProfile.mockResolvedValue({ userId: 'u1', settings: { gpsEnabled: false } });
    await hydrateAppSettings();
    expect(getAppSettings().tour).toEqual({ home: null, scorecard: null });
  });
});

describe('hydration signal', () => {
  it('starts false and flips true after hydrate resolves (signed out)', async () => {
    profileStore.loadProfile.mockResolvedValue(null);
    expect(isSettingsHydrated()).toBe(false);
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(true);
  });

  it('flips true even when loadProfile throws (offline)', async () => {
    profileStore.loadProfile.mockRejectedValue(new Error('offline'));
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(true);
  });

  it('notifies subscribers exactly once', async () => {
    profileStore.loadProfile.mockResolvedValue(null);
    const cb = jest.fn();
    subscribeSettingsHydration(cb);
    await hydrateAppSettings();
    await hydrateAppSettings();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('updateAppSettings persists tour stamps through the normal pipeline', async () => {
    await updateAppSettings({ tour: { home: '2026-07-22T10:00:00.000Z' } });
    expect(getAppSettings().tour.home).toBe('2026-07-22T10:00:00.000Z');
    const mirrored = JSON.parse(await AsyncStorage.getItem('@golf_settings'));
    expect(mirrored.tour.home).toBe('2026-07-22T10:00:00.000Z');
  });
});
