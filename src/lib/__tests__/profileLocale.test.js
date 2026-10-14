import {
  startProfileLocaleSync, scheduleLocaleSync, LOCALE_SYNC_DEBOUNCE_MS, __resetProfileLocaleForTests,
} from '../profileLocale';
import { setLanguagePref, __resetForTests as resetI18n } from '../../i18n';

let mockSession = null;
let mockAuthListener = null;
let mockOnline = null;
jest.mock('../supabase', () => ({
  supabase: {
    rpc: jest.fn(() => Promise.resolve({ error: null })),
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: mockSession } })),
      onAuthStateChange: jest.fn((fn) => {
        mockAuthListener = fn;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));
jest.mock('../connectivity', () => ({
  subscribeConnectivity: jest.fn((fn) => { mockOnline = fn; fn(true); return () => {}; }),
}));
const { supabase } = require('../supabase');

const signIn = (id = 'u1') => { mockSession = { user: { id } }; };
// Let the debounce fire and the async flush settle.
async function settle() {
  jest.advanceTimersByTime(LOCALE_SYNC_DEBOUNCE_MS);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
const sent = () => supabase.rpc.mock.calls.map(([fn, args]) => `${fn}:${args.p_locale}`);

describe('profile locale sync', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetProfileLocaleForTests();
    mockSession = null;
    mockAuthListener = null;
    await setLanguagePref('system');
    resetI18n(); // tests run with an English system language
  });
  afterEach(() => {
    __resetProfileLocaleForTests();
    jest.useRealTimers();
  });

  test('a signed-in start sends the effective language once, debounced', async () => {
    signIn();
    startProfileLocaleSync();
    expect(supabase.rpc).not.toHaveBeenCalled();
    await settle();
    expect(sent()).toEqual(['set_my_locale:en']);
    startProfileLocaleSync(); // idempotent
    await settle();
    expect(sent()).toEqual(['set_my_locale:en']);
  });

  test('signed out sends nothing; signing in sends', async () => {
    startProfileLocaleSync();
    await settle();
    expect(supabase.rpc).not.toHaveBeenCalled();
    signIn();
    mockAuthListener('SIGNED_IN', mockSession);
    await settle();
    expect(sent()).toEqual(['set_my_locale:en']);
  });

  test('a language change sends the new language; a burst becomes one call', async () => {
    signIn();
    startProfileLocaleSync();
    await settle();
    await setLanguagePref('es');
    await setLanguagePref('en');
    await setLanguagePref('es');
    await settle();
    expect(sent()).toEqual(['set_my_locale:en', 'set_my_locale:es']);
  });

  test("'system' sends the device language, not the word system", async () => {
    signIn();
    await setLanguagePref('es');
    startProfileLocaleSync();
    await settle();
    await setLanguagePref('system');
    await settle();
    expect(sent()).toEqual(['set_my_locale:es', 'set_my_locale:en']);
  });

  test('an unchanged language is not sent again (token refresh, re-sign-in)', async () => {
    signIn();
    startProfileLocaleSync();
    await settle();
    mockAuthListener('USER_UPDATED', mockSession);
    scheduleLocaleSync();
    await settle();
    expect(sent()).toEqual(['set_my_locale:en']);
  });

  test('another account on the same device gets its own send', async () => {
    signIn('u1');
    startProfileLocaleSync();
    await settle();
    mockAuthListener('SIGNED_OUT', null);
    signIn('u2');
    mockAuthListener('SIGNED_IN', mockSession);
    await settle();
    expect(sent()).toEqual(['set_my_locale:en', 'set_my_locale:en']);
  });

  test('a failure is silent and retried when the connection comes back', async () => {
    signIn();
    supabase.rpc.mockImplementationOnce(() => Promise.reject(new Error('Network request failed')));
    startProfileLocaleSync();
    await settle();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    mockOnline(true);
    await settle();
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    mockOnline(true); // acknowledged now: a later reconnect sends nothing
    await settle();
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  test('a server error (e.g. migration not applied yet) is swallowed and retried later', async () => {
    signIn();
    supabase.rpc.mockImplementationOnce(() => Promise.resolve({ error: { code: 'PGRST202' } }));
    startProfileLocaleSync();
    await settle();
    scheduleLocaleSync();
    await settle();
    expect(sent()).toEqual(['set_my_locale:en', 'set_my_locale:en']);
  });
});
