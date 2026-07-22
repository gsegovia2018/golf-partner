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

  it('a sign-out after a signed-in hydrate un-latches the gate until the next hydrate', async () => {
    // Veteran user A signs in — hydrate completes, gate opens.
    profileStore.loadProfile.mockResolvedValue({ userId: 'user-A', settings: { tour: { home: '2026-07-01T00:00:00.000Z', scorecard: '2026-07-01T00:00:00.000Z' } } });
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(true);

    // User A signs out on the shared device — settings reset to defaults
    // (tour flags null again), and the gate must close: a mounted
    // TourOverlay must not be able to observe "hydrated=true + flags=null"
    // as if that were a real, adopted state for whoever signs in next.
    profileStore.loadProfile.mockResolvedValue(null);
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(false);
    expect(getAppSettings().tour).toEqual({ home: null, scorecard: null });

    // Veteran user B signs in — once their hydrate resolves, the gate
    // re-opens and reflects B's real (completed) tour state.
    profileStore.loadProfile.mockResolvedValue({ userId: 'user-B', settings: { tour: { home: '2026-06-01T00:00:00.000Z', scorecard: '2026-06-01T00:00:00.000Z' } } });
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(true);
    expect(getAppSettings().tour).toEqual({ home: '2026-06-01T00:00:00.000Z', scorecard: '2026-06-01T00:00:00.000Z' });
  });

  it('notifies a subscriber on the true-to-false gate transition (sign-out after a real session)', async () => {
    profileStore.loadProfile.mockResolvedValue({ userId: 'user-A', settings: {} });
    await hydrateAppSettings();
    const cb = jest.fn();
    subscribeSettingsHydration(cb);

    profileStore.loadProfile.mockResolvedValue(null);
    await hydrateAppSettings();

    expect(isSettingsHydrated()).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
