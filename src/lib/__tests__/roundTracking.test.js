/**
 * @jest-environment node
 */
jest.mock('expo-location', () => ({
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  Accuracy: { High: 4 },
}));

const TEXT_A = { title: 'Hole 7 · 143 m to the centre', body: '131 m front · 156 m back · Lomas-Bosque' };
const TEXT_B = { title: 'Hole 7 · 137 m to the centre', body: '125 m front · 150 m back · Lomas-Bosque' };
const TEXT_C = { title: 'Hole 8 · 402 m from the tee', body: '390 m front · 415 m back · Lomas-Bosque' };

let tracking;
let Location;
let TaskManager;

// Microtask drain — the control surface serializes its work on a promise
// chain, so a couple of turns settle any queued start or stop.
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
};

// The module reads Platform.OS at import (to define the task) and on every
// call, so each test loads a fresh registry with the platform pinned first —
// an override on a previously imported react-native would not survive
// resetModules.
function load(os) {
  jest.resetModules();
  const { Platform } = require('react-native');
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Location = require('expo-location');
  TaskManager = require('expo-task-manager');
  Location.startLocationUpdatesAsync.mockClear().mockResolvedValue();
  Location.stopLocationUpdatesAsync.mockClear().mockResolvedValue();
  Location.hasStartedLocationUpdatesAsync.mockClear().mockResolvedValue(false);
  TaskManager.defineTask.mockClear();
  tracking = require('../roundTracking');
}

beforeEach(() => {
  jest.useFakeTimers();
  load('android');
});
afterEach(() => {
  tracking.__resetRoundTrackingForTests();
  jest.useRealTimers();
});

const startCalls = () => Location.startLocationUpdatesAsync.mock.calls;
const postedText = (call) => ({
  title: call[1].foregroundService.notificationTitle,
  body: call[1].foregroundService.notificationBody,
});

test('the task publishes its newest location to subscribers and as the live fix', () => {
  expect(TaskManager.defineTask).toHaveBeenCalledWith(tracking.ROUND_LOCATION_TASK, expect.any(Function));
  const run = TaskManager.defineTask.mock.calls[0][1];
  const seen = [];
  const unsub = tracking.subscribeLiveFix((loc) => seen.push(loc));
  const older = { coords: { latitude: 40.1, longitude: -3.7, accuracy: 5 }, timestamp: 1 };
  const newer = { coords: { latitude: 40.2, longitude: -3.7, accuracy: 5 }, timestamp: 2 };
  run({ data: { locations: [older, newer] } });
  expect(seen).toEqual([newer]);
  expect(tracking.getLiveFix()).toBe(newer);
  run({ error: new Error('provider gone') });
  expect(seen).toHaveLength(1);
  unsub();
  run({ data: { locations: [older] } });
  expect(seen).toHaveLength(1);
});

test('the first text starts the service as a foreground service; identical text is a no-op', async () => {
  tracking.setRoundTracking(TEXT_A);
  await settle();
  expect(startCalls()).toHaveLength(1);
  const [taskName, options] = startCalls()[0];
  expect(taskName).toBe(tracking.ROUND_LOCATION_TASK);
  expect(options.accuracy).toBe(Location.Accuracy.High);
  expect(options.foregroundService).toMatchObject({
    notificationTitle: TEXT_A.title,
    notificationBody: TEXT_A.body,
    killServiceOnDestroy: true,
  });

  tracking.setRoundTracking({ ...TEXT_A });
  await settle();
  expect(startCalls()).toHaveLength(1);
});

test('text changes inside the minimum interval coalesce into one trailing update', async () => {
  tracking.setRoundTracking(TEXT_A);
  await settle();
  expect(startCalls()).toHaveLength(1);

  tracking.setRoundTracking(TEXT_B);
  tracking.setRoundTracking(TEXT_C);
  await settle();
  expect(startCalls()).toHaveLength(1); // held back

  jest.advanceTimersByTime(tracking.NOTIFICATION_UPDATE_MIN_MS + 1);
  await settle();
  expect(startCalls()).toHaveLength(2);
  expect(postedText(startCalls()[1])).toEqual(TEXT_C); // the latest, not each step
});

test('null stops the service only when it is running, and drops the live fix', async () => {
  tracking.setRoundTracking(null);
  await settle();
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();

  tracking.setRoundTracking(TEXT_A);
  await settle();
  const run = TaskManager.defineTask.mock.calls[0][1];
  run({ data: { locations: [{ coords: { latitude: 40.1, longitude: -3.7, accuracy: 5 }, timestamp: 1 }] } });
  expect(tracking.getLiveFix()).not.toBeNull();

  Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
  tracking.setRoundTracking(null);
  await settle();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(tracking.ROUND_LOCATION_TASK);
  expect(tracking.getLiveFix()).toBeNull();

  // Stopped means the next identical text must start again, not dedupe.
  tracking.setRoundTracking(TEXT_A);
  await settle();
  expect(startCalls()).toHaveLength(2);
});

test('a failed start is retried on the next text, and on the next return to the foreground', async () => {
  const { AppState } = require('react-native');
  const handlers = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, handler) => {
    if (event === 'change') handlers.push(handler);
    return { remove: jest.fn() };
  });
  try {
    Location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('not foregrounded'));
    tracking.setRoundTracking(TEXT_A);
    await settle();
    expect(startCalls()).toHaveLength(1);

    handlers.forEach((h) => h('active'));
    await settle();
    expect(startCalls()).toHaveLength(2);
    expect(postedText(startCalls()[1])).toEqual(TEXT_A);

    Location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('not foregrounded'));
    jest.advanceTimersByTime(tracking.NOTIFICATION_UPDATE_MIN_MS + 1);
    tracking.setRoundTracking(TEXT_B);
    await settle();
    expect(startCalls()).toHaveLength(3);
    tracking.setRoundTracking(TEXT_C); // nothing posted yet → immediate retry
    await settle();
    expect(startCalls()).toHaveLength(4);
    expect(postedText(startCalls()[3])).toEqual(TEXT_C);
  } finally {
    spy.mockRestore();
  }
});

test('off Android nothing is defined or started', async () => {
  load('ios');
  expect(TaskManager.defineTask).not.toHaveBeenCalled();
  tracking.setRoundTracking(TEXT_A);
  await settle();
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});
