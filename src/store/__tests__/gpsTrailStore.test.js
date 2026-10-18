import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import {
  appendTrailPoints, recordTrailFixes, flushTrails, setActiveTrailRound, getActiveTrailRound,
  isTrailRecordingEnabled, toTrailPoint, trailMetaKey, trailChunkKey,
  CHUNK_SIZE, MAX_POINTS_PER_ROUND, ACTIVE_TRAIL_KEY, __resetGpsTrailForTests,
} from '../gpsTrailStore';
import {
  updateAppSettings, hydrateAppSettings, __resetAppSettingsForTests, SETTINGS_KEY,
} from '../settingsStore';

jest.mock('../profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue({ userId: 'u1', settings: {} }),
  upsertProfile: jest.fn().mockResolvedValue(),
}));

const mockUpsert = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
    auth: { getSession: jest.fn() },
  },
}));

const KEY = { userId: 'u1', tournamentId: 't-1', roundId: 'r0', roundIndex: 0 };
const mk = trailMetaKey(KEY);
const pts = (from, n) => Array.from({ length: n }, (_, i) => ({ t: (from + i) * 1000, lat: 40 + i * 1e-5, lng: -3.7, acc: 4 }));
const loc = (t, extra = {}) => ({ timestamp: t, coords: { latitude: 40.1, longitude: -3.7, accuracy: 5, speed: 1.2, ...extra } });
const readJson = async (k) => JSON.parse(await AsyncStorage.getItem(k));
const signedIn = (id = 'u1') => supabase.auth.getSession.mockResolvedValue({ data: { session: id ? { user: { id } } : null } });

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetAppSettingsForTests();
  __resetGpsTrailForTests();
  jest.clearAllMocks();
  mockUpsert.mockResolvedValue({ error: null });
  signedIn();
});

describe('append', () => {
  test('stores points in the round chunk and counts them', async () => {
    expect(await appendTrailPoints(KEY, pts(1, 3))).toBe(3);
    expect(await readJson(trailChunkKey(mk, 0))).toEqual(pts(1, 3));
    expect(await readJson(mk)).toMatchObject({ ...KEY, count: 3, lastT: 3000 });
  });

  test('drops identical (and older) timestamps, within a batch and across batches', async () => {
    await appendTrailPoints(KEY, [...pts(1, 2), pts(2, 1)[0]]);
    expect(await appendTrailPoints(KEY, [...pts(1, 3), ...pts(4, 1)])).toBe(2);
    expect((await readJson(trailChunkKey(mk, 0))).map((p) => p.t)).toEqual([1000, 2000, 3000, 4000]);
  });

  test('splits into CHUNK_SIZE chunks, rewriting only the tail', async () => {
    await appendTrailPoints(KEY, pts(1, CHUNK_SIZE - 2));
    await appendTrailPoints(KEY, pts(CHUNK_SIZE - 1, 5));
    expect(await readJson(trailChunkKey(mk, 0))).toHaveLength(CHUNK_SIZE);
    expect(await readJson(trailChunkKey(mk, 1))).toHaveLength(3);
    expect((await readJson(mk)).count).toBe(CHUNK_SIZE + 3);
  });

  test('caps a round at MAX_POINTS_PER_ROUND', async () => {
    await appendTrailPoints(KEY, pts(1, MAX_POINTS_PER_ROUND - 1));
    expect(await appendTrailPoints(KEY, pts(MAX_POINTS_PER_ROUND, 10))).toBe(1);
    expect(await appendTrailPoints(KEY, pts(MAX_POINTS_PER_ROUND + 20, 1))).toBe(0);
    expect((await readJson(mk)).count).toBe(MAX_POINTS_PER_ROUND);
  });

  test('toTrailPoint maps a location, keeping speed only when known', () => {
    expect(toTrailPoint(loc(5))).toEqual({ t: 5, lat: 40.1, lng: -3.7, acc: 5, spd: 1.2 });
    expect(toTrailPoint(loc(5, { speed: -1 }))).toEqual({ t: 5, lat: 40.1, lng: -3.7, acc: 5 });
    expect(toTrailPoint({ timestamp: 5, coords: {} })).toBeNull();
  });
});

describe('recordTrailFixes (the location task hook)', () => {
  test('records while the setting is on and a round is active', async () => {
    await updateAppSettings({ recordGpsTrail: true });
    await setActiveTrailRound(KEY);
    expect(await recordTrailFixes([loc(1000), loc(2000)])).toBe(2);
    expect((await readJson(mk)).count).toBe(2);
  });

  test('setting off → nothing is appended', async () => {
    await hydrateAppSettings(); // hydrated with the default (off)
    await setActiveTrailRound(KEY);
    expect(await recordTrailFixes([loc(1000)])).toBe(0);
    expect(await AsyncStorage.getItem(mk)).toBeNull();
  });

  test('no active round → nothing is appended', async () => {
    await updateAppSettings({ recordGpsTrail: true });
    expect(await recordTrailFixes([loc(1000)])).toBe(0);
    await setActiveTrailRound(KEY);
    await setActiveTrailRound(null);
    expect(await recordTrailFixes([loc(1000)])).toBe(0);
    expect(await AsyncStorage.getItem(mk)).toBeNull();
  });

  test('headless: reads the active round and the setting back from AsyncStorage', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ recordGpsTrail: true }));
    await AsyncStorage.setItem(ACTIVE_TRAIL_KEY, JSON.stringify(KEY));
    __resetAppSettingsForTests(); // fresh JS context: settings never hydrated
    expect(await getActiveTrailRound()).toEqual(KEY);
    expect(await isTrailRecordingEnabled()).toBe(true);
    expect(await recordTrailFixes([loc(1000)])).toBe(1);
  });

  test('headless with the setting off in the mirror records nothing', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ recordGpsTrail: false }));
    await AsyncStorage.setItem(ACTIVE_TRAIL_KEY, JSON.stringify(KEY));
    expect(await recordTrailFixes([loc(1000)])).toBe(0);
  });
});

describe('flush', () => {
  test('uploads each chunk as one row and marks it sent; a second flush sends nothing', async () => {
    await appendTrailPoints(KEY, pts(1, CHUNK_SIZE + 10));
    expect(await flushTrails()).toEqual({ uploaded: 2, failed: false });
    expect(supabase.from).toHaveBeenCalledWith('golf_gps_trail');
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const [row0, opts] = mockUpsert.mock.calls[0];
    expect(row0).toMatchObject({ user_id: 'u1', tournament_id: 't-1', round_id: 'r0', round_index: 0, seq: 0 });
    expect(row0.points).toHaveLength(CHUNK_SIZE);
    expect(opts).toEqual({ onConflict: 'user_id,tournament_id,round_id,round_index,seq' });
    expect(mockUpsert.mock.calls[1][0]).toMatchObject({ seq: 1 });
    expect(mockUpsert.mock.calls[1][0].points).toHaveLength(10);
    // The full chunk's local copy is dropped; the open tail stays.
    expect(await AsyncStorage.getItem(trailChunkKey(mk, 0))).toBeNull();
    expect(await readJson(trailChunkKey(mk, 1))).toHaveLength(10);

    mockUpsert.mockClear();
    expect(await flushTrails()).toEqual({ uploaded: 0, failed: false });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('a grown tail chunk is re-upserted under the same seq', async () => {
    await appendTrailPoints(KEY, pts(1, 3));
    await flushTrails();
    await appendTrailPoints(KEY, pts(4, 2));
    mockUpsert.mockClear();
    await flushTrails();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ seq: 0 });
    expect(mockUpsert.mock.calls[0][0].points).toHaveLength(5);
  });

  test('a failed upload keeps the chunk pending and the next flush retries it', async () => {
    await appendTrailPoints(KEY, pts(1, 3));
    mockUpsert.mockResolvedValueOnce({ error: { message: 'offline' } });
    expect(await flushTrails()).toEqual({ uploaded: 0, failed: true });
    expect((await readJson(mk)).uploaded).toEqual({});
    mockUpsert.mockRejectedValueOnce(new Error('network down'));
    await expect(flushTrails()).resolves.toEqual({ uploaded: 0, failed: true });
    expect(await flushTrails()).toEqual({ uploaded: 1, failed: false });
    expect((await readJson(mk)).uploaded).toEqual({ 0: 3 });
  });

  test('signed out, or another account’s trail → nothing is uploaded', async () => {
    await appendTrailPoints(KEY, pts(1, 3));
    signedIn(null);
    expect(await flushTrails()).toEqual({ uploaded: 0, failed: false });
    signedIn('someone-else');
    expect(await flushTrails()).toEqual({ uploaded: 0, failed: false });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('appends made while an upload is in flight are kept', async () => {
    await appendTrailPoints(KEY, pts(1, 3));
    let release;
    mockUpsert.mockImplementationOnce(() => new Promise((r) => { release = () => r({ error: null }); }));
    const flushing = flushTrails();
    await new Promise((r) => setTimeout(r, 0));
    const appended = appendTrailPoints(KEY, pts(4, 2));
    release();
    await flushing;
    await appended;
    expect(await readJson(mk)).toMatchObject({ count: 5, uploaded: { 0: 3 } });
  });
});
