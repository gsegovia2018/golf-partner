import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  prefetchWeather, prefetchWeatherForRounds, weatherAt, parseForecast, coursePoint,
  getWeatherVersion, _resetForTests, FRESH_MS, loadCachedWeather,
} from '../weatherStore';
import { setCourseGeometry } from '../../lib/geo';
import { isOnline } from '../../lib/connectivity';
import { __resetAppSettingsForTests, updateAppSettings } from '../settingsStore';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../profileStore', () => ({ loadProfile: jest.fn(), upsertProfile: jest.fn() }));
jest.mock('../../lib/connectivity', () => ({ isOnline: jest.fn(() => true), subscribeConnectivity: () => () => {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const COURSE = {
  key: 'c1', name: 'Test Course', matchTokens: [['test', 'course']], mode: 'holes',
  holes: [{ number: 1, start: [40.1, -3.2], greenCenter: [40.101, -3.2] }],
};
const NOW = Date.UTC(2026, 9, 19, 10, 0, 0);
const hourSec = (h) => NOW / 1000 + h * 3600;
const API_JSON = {
  elevation: 620,
  hourly: {
    time: [hourSec(-1), hourSec(0), hourSec(1)],
    temperature_2m: [10, 11, 12],
    wind_speed_10m: [15, 18, 20],
    wind_direction_10m: [270, 280, 290],
    wind_gusts_10m: [25, 31, 33],
  },
};
const okFetch = () => jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(API_JSON) }));

beforeEach(() => {
  jest.clearAllMocks();
  _resetForTests();
  setCourseGeometry([COURSE]);
  AsyncStorage.getItem.mockResolvedValue(null);
  isOnline.mockReturnValue(true);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  global.fetch = okFetch();
});
afterEach(() => { jest.restoreAllMocks(); delete global.fetch; });

describe('parseForecast / coursePoint', () => {
  it('maps the hourly arrays and keeps elevation', () => {
    const w = parseForecast(API_JSON, NOW);
    expect(w.elevationM).toBe(620);
    expect(w.hours[1]).toEqual({ t: NOW, tempC: 11, windKmh: 18, windFromDeg: 280, gustKmh: 31 });
  });
  it('rejects a payload without hourly data (e.g. a 503 body)', () => {
    expect(parseForecast({ error: true, reason: 'The service is overloaded' }, NOW)).toBeNull();
  });
  it('finds a point on holes- and greens-mode courses', () => {
    expect(coursePoint(COURSE)).toEqual([40.1, -3.2]);
    expect(coursePoint({ greens: [[[1, 2], [3, 4]]] })).toEqual([1, 2]);
    expect(coursePoint({ holes: [] })).toBeNull();
  });
});

describe('prefetchWeather', () => {
  it('fetches, caches to storage, and serves the hour nearest now', async () => {
    const v = getWeatherVersion();
    await prefetchWeather('Test Course');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/latitude=40\.1000&longitude=-3\.2000/);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('weather.v1.c1', expect.any(String));
    expect(getWeatherVersion()).toBeGreaterThan(v);
    expect(weatherAt('Test Course', NOW + 20 * 60e3)).toMatchObject({ tempC: 11, windKmh: 18, windFromDeg: 280, gustKmh: 31, elevationM: 620, fresh: true });
  });

  it('does not refetch while the forecast is fresh, and refetches once it is stale', async () => {
    await prefetchWeather('Test Course');
    await prefetchWeather('Test Course');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    Date.now.mockReturnValue(NOW + FRESH_MS + 1);
    await prefetchWeather('Test Course');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('offline: uses the stored forecast and never fetches', async () => {
    isOnline.mockReturnValue(false);
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(parseForecast(API_JSON, NOW - 3 * 3600e3)));
    await prefetchWeather('Test Course');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(weatherAt('Test Course')).toMatchObject({ tempC: 11, fresh: false });
  });

  it('a failed or overloaded fetch keeps what was there and never throws', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 503 }));
    await expect(prefetchWeather('Test Course')).resolves.toBeUndefined();
    global.fetch = jest.fn(() => Promise.reject(new Error('network')));
    await expect(prefetchWeather('Test Course')).resolves.toBeUndefined();
    expect(weatherAt('Test Course')).toBeNull();
  });

  it('ignores an unknown course', async () => {
    await prefetchWeather('Nowhere Links');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('weatherAt', () => {
  it('returns null once the forecast no longer covers now', async () => {
    await prefetchWeather('Test Course');
    expect(weatherAt('Test Course', NOW + 3 * 3600e3)).toBeNull();
  });
});

describe('prefetchWeatherForRounds', () => {
  beforeEach(() => __resetAppSettingsForTests());

  it('does nothing while playing conditions are off', async () => {
    prefetchWeatherForRounds([{ courseName: 'Test Course' }]);
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefetches each course once when conditions are on', async () => {
    await updateAppSettings({ conditionsEnabled: true });
    prefetchWeatherForRounds([{ courseName: 'Test Course' }, { courseName: 'Test Course' }, null]);
    await prefetchWeather('Test Course'); // joins the in-flight request
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('loadCachedWeather', () => {
  it('reads the stored forecast and never fetches', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(parseForecast(API_JSON, NOW)));
    await loadCachedWeather('Test Course');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(weatherAt('Test Course')).toMatchObject({ tempC: 11, fresh: true });
  });
});
