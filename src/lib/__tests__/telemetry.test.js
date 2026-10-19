import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { track, flushEvents, EVENTS_KEY, MAX_QUEUED, __resetTelemetryForTests } from '../telemetry';
import {
  updateAppSettings, hydrateAppSettings, __resetAppSettingsForTests,
} from '../../store/settingsStore';

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue({ userId: 'u1', settings: {} }),
  upsertProfile: jest.fn().mockResolvedValue(),
}));

let mockSeq = 0;
jest.mock('uuid', () => ({ v4: () => `id-${(mockSeq += 1)}` }));

const mockUpsert = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
    auth: { getSession: jest.fn() },
  },
}));

const queue = async () => JSON.parse((await AsyncStorage.getItem(EVENTS_KEY)) ?? '[]');
const signedIn = (id = 'u1') => supabase.auth.getSession.mockResolvedValue({ data: { session: id ? { user: { id } } : null } });
// track() is fire-and-forget; a flush (or another serialized job) runs after it.
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetAppSettingsForTests();
  __resetTelemetryForTests();
  jest.clearAllMocks();
  mockUpsert.mockResolvedValue({ error: null });
  signedIn();
  await hydrateAppSettings('u1');
});

afterEach(() => __resetTelemetryForTests());

test('track returns at once and queues the event with its author', async () => {
  expect(track('round_started', { round: 0 })).toBeUndefined();
  await settle();
  expect(await queue()).toEqual([
    expect.objectContaining({ uid: 'u1', name: 'round_started', props: { round: 0 }, id: expect.any(String) }),
  ]);
});

test('offline: a failed flush keeps the queue, the next one sends it once', async () => {
  track('shot_logged', { hole: 3 });
  track('shot_logged', { hole: 4 });
  await settle();
  mockUpsert.mockResolvedValueOnce({ error: { message: 'Network request failed' } });
  expect(await flushEvents()).toBe(0);
  expect(await queue()).toHaveLength(2);

  expect(await flushEvents()).toBe(2);
  expect(await queue()).toEqual([]);
  const [rows, opts] = mockUpsert.mock.calls[1];
  expect(rows.map((r) => r.props.hole)).toEqual([3, 4]);
  expect(rows[0]).toMatchObject({ user_id: 'u1', name: 'shot_logged' });
  expect(opts).toEqual({ onConflict: 'id', ignoreDuplicates: true });
});

test('a thrown network error never escapes track or flush', async () => {
  supabase.auth.getSession.mockRejectedValueOnce(new Error('boom'));
  track('x');
  await settle();
  mockUpsert.mockRejectedValueOnce(new Error('offline'));
  track('y');
  await settle();
  await expect(flushEvents()).resolves.toBe(0);
  expect((await queue()).map((e) => e.name)).toEqual(['y']);
});

test('a constraint error drops the batch instead of blocking the queue', async () => {
  track('x');
  await settle();
  mockUpsert.mockResolvedValueOnce({ error: { code: '23514', message: 'check violation' } });
  expect(await flushEvents()).toBe(0);
  expect(await queue()).toEqual([]);
});

test('opt-out: records nothing and the next flush drops what was queued', async () => {
  track('before');
  await settle();
  await updateAppSettings({ usageStats: false });
  track('after');
  await settle();
  expect((await queue()).map((e) => e.name)).toEqual(['before']);
  expect(await flushEvents()).toBe(0);
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(EVENTS_KEY)).toBeNull();
});

test('nothing is sent before settings hydrate', async () => {
  track('early');
  await settle();
  __resetAppSettingsForTests();
  expect(await flushEvents()).toBe(0);
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(await queue()).toHaveLength(1);
});

test('signed out records nothing; another account\'s events stay unsent', async () => {
  signedIn(null);
  track('anon');
  await settle();
  signedIn('u2');
  track('theirs');
  await settle();
  signedIn('u1');
  expect(await flushEvents()).toBe(0);
  expect((await queue()).map((e) => e.uid)).toEqual(['u2']);
});

test('the queue is capped, oldest first out', async () => {
  for (let i = 0; i < MAX_QUEUED + 3; i += 1) track('e', { i });
  await settle();
  const q = await queue();
  expect(q).toHaveLength(MAX_QUEUED);
  expect(q[0].props.i).toBe(3);
});
