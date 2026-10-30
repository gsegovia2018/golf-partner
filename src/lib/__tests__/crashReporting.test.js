jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  close: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

let mockSettings;
let mockHydrated;
let mockHydrationCbs;
let mockSettingsCbs;
jest.mock('../../store/settingsStore', () => ({
  getAppSettings: () => mockSettings,
  isSettingsHydrated: () => mockHydrated,
  subscribeSettingsHydration: (cb) => { mockHydrationCbs.push(cb); return () => {}; },
  subscribeAppSettings: (cb) => { mockSettingsCbs.push(cb); return () => {}; },
}));

const DSN = 'https://key@o1.ingest.de.sentry.io/2';

function load({ dsn = DSN } = {}) {
  process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  let mod;
  jest.isolateModules(() => {
    mod = require('../crashReporting');
    reporting = require('../errorReporting');
  });
  return mod;
}

const Sentry = require('@sentry/react-native');
// The errorReporting instance crashReporting was loaded with (isolateModules).
let reporting;
const captureException = (...a) => reporting.captureException(...a);
const captureMessage = (...a) => reporting.captureMessage(...a);

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { usageStats: true };
  mockHydrated = false;
  mockHydrationCbs = [];
  mockSettingsCbs = [];
  global.__DEV__ = false;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  global.__DEV__ = true;
  console.error.mockRestore();
  console.warn.mockRestore();
});

const hydrate = () => { mockHydrated = true; mockHydrationCbs.forEach((cb) => cb()); };

test('starts only once settings have hydrated, without personal data', () => {
  load().startCrashReporting();
  expect(Sentry.init).not.toHaveBeenCalled();
  hydrate();
  expect(Sentry.init).toHaveBeenCalledTimes(1);
  expect(Sentry.init.mock.calls[0][0]).toMatchObject({ dsn: DSN, sendDefaultPii: false });
});

test('an opted-out user never starts it', () => {
  mockSettings = { usageStats: false };
  load().startCrashReporting();
  hydrate();
  expect(Sentry.init).not.toHaveBeenCalled();
});

test('no DSN or a dev build: nothing starts', () => {
  load({ dsn: '' }).startCrashReporting();
  global.__DEV__ = true;
  load().startCrashReporting();
  hydrate();
  expect(Sentry.init).not.toHaveBeenCalled();
});

test('forwards the app\'s reported errors and warnings', () => {
  load().startCrashReporting();
  hydrate();
  const err = new Error('sync failed');
  captureException(err, { source: 'sync' });
  captureMessage('queue stuck');
  expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { source: 'sync' } });
  expect(Sentry.captureMessage).toHaveBeenCalledWith('queue stuck', { level: 'warning', extra: undefined });
});

test('an offline network failure stays in the app and is not sent', () => {
  load().startCrashReporting();
  hydrate();
  // What supabase-js returns for an upsert with no signal (the replicator's push).
  captureException({ message: 'TypeError: Network request failed', code: '' }, { scope: 'cards.replicator' });
  captureException(new TypeError('Network request failed'));
  expect(Sentry.captureException).not.toHaveBeenCalled();
  expect(reporting.getRecentEvents()).toHaveLength(2);
  captureException({ message: 'new row violates row-level security', code: '42501' });
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});

test('turning the switch off closes it and drops queued events; on starts it again', () => {
  load().startCrashReporting();
  hydrate();
  const { beforeSend } = Sentry.init.mock.calls[0][0];
  mockSettings = { usageStats: false };
  mockSettingsCbs.forEach((cb) => cb());
  expect(Sentry.close).toHaveBeenCalledTimes(1);
  expect(beforeSend({ message: 'x' })).toBeNull();
  captureException(new Error('after opt-out'));
  expect(Sentry.captureException).not.toHaveBeenCalled();
  mockSettings = { usageStats: true };
  mockSettingsCbs.forEach((cb) => cb());
  expect(Sentry.init).toHaveBeenCalledTimes(2);
});

test('tags events with the account id only', () => {
  const mod = load();
  mod.setCrashReportUser('user-1');
  mod.startCrashReporting();
  hydrate();
  expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  mod.setCrashReportUser(null);
  expect(Sentry.setUser).toHaveBeenLastCalledWith(null);
});
