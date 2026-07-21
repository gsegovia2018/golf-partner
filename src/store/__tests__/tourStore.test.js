import AsyncStorage from '@react-native-async-storage/async-storage';
import { shouldShowTour, completeTour, resetTour } from '../tourStore';
import { getAppSettings, updateAppSettings, __resetAppSettingsForTests } from '../settingsStore';
import * as profileStore from '../profileStore';

jest.mock('../profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn(),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetAppSettingsForTests();
  profileStore.loadProfile.mockResolvedValue(null);
  profileStore.upsertProfile.mockResolvedValue({});
});

it('shows both chapters by default', () => {
  expect(shouldShowTour('home')).toBe(true);
  expect(shouldShowTour('scorecard')).toBe(true);
});

it('completeTour stamps an ISO timestamp and hides only that chapter', async () => {
  await completeTour('home');
  expect(shouldShowTour('home')).toBe(false);
  expect(shouldShowTour('scorecard')).toBe(true);
  expect(new Date(getAppSettings().tour.home).toISOString()).toBe(getAppSettings().tour.home);
});

it('treats a settings blob without tour as "show"', async () => {
  await updateAppSettings({ tour: undefined });
  expect(shouldShowTour('home')).toBe(true);
});

it('resetTour re-arms both chapters', async () => {
  await completeTour('home');
  await completeTour('scorecard');
  await resetTour();
  expect(shouldShowTour('home')).toBe(true);
  expect(shouldShowTour('scorecard')).toBe(true);
});
