import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '../locales/en';
import es from '../locales/es';
import {
  t, tr, resolveLanguage, pluralForm, getLanguage, getLanguagePref, setLanguagePref,
  loadLanguagePref, detectSystemLanguage, LANGUAGE_PREF_KEY, __resetForTests,
  formatNumber, formatDate, formatTime,
} from '..';

const params = (s) => (String(typeof s === 'object' ? Object.values(s).join(' ') : s).match(/\{\w+\}/g) ?? []).sort();

describe('catalogues', () => {
  test('es and en have the same keys', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  test('every key has the same {placeholders} in both languages', () => {
    for (const key of Object.keys(en)) {
      expect([key, params(es[key])]).toEqual([key, params(en[key])]);
    }
  });

  test('plural entries are plural in both languages and carry one + other', () => {
    for (const key of Object.keys(en)) {
      expect([key, typeof es[key]]).toEqual([key, typeof en[key]]);
      if (typeof en[key] === 'object') {
        expect(Object.keys(en[key]).sort()).toEqual(['one', 'other']);
        expect(Object.keys(es[key]).sort()).toEqual(['one', 'other']);
      }
    }
  });

  test('no empty strings', () => {
    for (const cat of [en, es]) {
      for (const v of Object.values(cat)) {
        expect(String(typeof v === 'object' ? v.other : v).trim()).not.toBe('');
      }
    }
  });
});

describe('t()', () => {
  test('interpolates params and leaves unknown placeholders', () => {
    expect(t('marker.confirm.title', { name: 'Ana' }, 'en')).toBe("Confirm Ana's card");
    expect(t('marker.confirm.title', { name: 'Ana' }, 'es')).toBe('Confirma la tarjeta de Ana');
    expect(t('marker.confirm.title', {}, 'en')).toBe("Confirm {name}'s card");
  });

  test('missing key returns the key', () => {
    expect(t('nope.nothing', {}, 'es')).toBe('nope.nothing');
  });

  test('tr renders a { key, params } descriptor', () => {
    expect(tr({ key: 'marker.sendBack', params: { name: 'Leo' } })).toBe('Send back to Leo');
    expect(tr(null)).toBe('');
  });

  test('plural forms', () => {
    expect(pluralForm(1)).toBe('one');
    expect(pluralForm(0)).toBe('other');
    expect(pluralForm(2)).toBe('other');
    expect(pluralForm(1.5)).toBe('other');
  });
});

describe('plural entries (injected catalogue)', () => {
  const key = '__test.rounds';
  beforeAll(() => {
    en[key] = { one: '{count} round', other: '{count} rounds' };
    es[key] = { one: '{count} vuelta', other: '{count} vueltas' };
  });
  afterAll(() => { delete en[key]; delete es[key]; });

  test('picks by count', () => {
    expect(t(key, { count: 1 }, 'en')).toBe('1 round');
    expect(t(key, { count: 3 }, 'en')).toBe('3 rounds');
    expect(t(key, { count: 1 }, 'es')).toBe('1 vuelta');
    expect(t(key, { count: 0 }, 'es')).toBe('0 vueltas');
  });
});

describe('language resolution', () => {
  test('system follows the device, Spanish only for es*', () => {
    expect(resolveLanguage('system', 'es')).toBe('es');
    expect(resolveLanguage('system', 'en')).toBe('en');
    expect(resolveLanguage('system', 'fr')).toBe('en');
    expect(resolveLanguage('system', '')).toBe('en');
  });

  test('an override wins over the device', () => {
    expect(resolveLanguage('en', 'es')).toBe('en');
    expect(resolveLanguage('es', 'en')).toBe('es');
  });

  test('detectSystemLanguage reads Intl and returns a bare lowercase code', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
      resolvedOptions: () => ({ locale: 'es-ES' }),
    }));
    expect(detectSystemLanguage()).toBe('es');
    spy.mockRestore();
  });

  test('detectSystemLanguage falls back to navigator.language without Intl', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('no Intl'); });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'es-MX' }, configurable: true });
    try {
      expect(detectSystemLanguage()).toBe('es');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete globalThis.navigator;
      spy.mockRestore();
    }
  });
});

describe('preference persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetForTests();
  });

  test('setLanguagePref applies and persists', async () => {
    await setLanguagePref('es');
    expect(getLanguage()).toBe('es');
    expect(getLanguagePref()).toBe('es');
    expect(await AsyncStorage.getItem(LANGUAGE_PREF_KEY)).toBe('es');
    expect(t('marker.cancel')).toBe('Cancelar');
    await setLanguagePref('en');
    expect(t('marker.cancel')).toBe('Cancel');
  });

  test('loadLanguagePref restores the stored override and ignores junk', async () => {
    await AsyncStorage.setItem(LANGUAGE_PREF_KEY, 'es');
    await loadLanguagePref();
    expect(getLanguage()).toBe('es');
    await AsyncStorage.setItem(LANGUAGE_PREF_KEY, 'klingon');
    await loadLanguagePref();
    expect(getLanguagePref()).toBe('system');
  });
});

describe('formatNumber', () => {
  test('English', () => {
    expect(formatNumber(38.5, {}, 'en')).toBe('38.5');
    expect(formatNumber(1234, {}, 'en')).toBe('1,234');
    expect(formatNumber(1234567.891, { decimals: 1 }, 'en')).toBe('1,234,567.9');
  });

  test('Spanish: comma decimals, dot thousands, always grouped', () => {
    expect(formatNumber(38.5, {}, 'es')).toBe('38,5');
    expect(formatNumber(1234, {}, 'es')).toBe('1.234');
    expect(formatNumber(1234.5, { decimals: 2 }, 'es')).toBe('1.234,50');
    expect(formatNumber(-2.4, {}, 'es')).toBe('-2,4');
  });

  test('trims zeros, handles zero and bad input', () => {
    expect(formatNumber(36, {}, 'es')).toBe('36');
    expect(formatNumber(2.0, { decimals: 1 }, 'es')).toBe('2,0');
    expect(formatNumber(-0.001, {}, 'en')).toBe('0');
    expect(formatNumber(null, {}, 'es')).toBe('');
    expect(formatNumber('abc', {}, 'es')).toBe('');
  });
});

describe('formatDate / formatTime', () => {
  test('calendar dates do not shift with the time zone', () => {
    expect(formatDate('2026-10-04', 'short', 'en')).toBe('Sun 4 Oct');
    expect(formatDate('2026-10-04', 'short', 'es')).toBe('dom 4 oct');
    expect(formatDate('2026-10-04', 'day', 'es')).toBe('4 oct');
    expect(formatDate('2026-10-04', 'long', 'es')).toBe('domingo, 4 de octubre de 2026');
    expect(formatDate('2026-10-04', 'long', 'en')).toBe('Sunday 4 October 2026');
    expect(formatDate('2026-10-04', 'month', 'es')).toBe('octubre de 2026');
    expect(formatDate('2026-10-04', 'month', 'en')).toBe('October 2026');
  });

  test('invalid dates give an empty string', () => {
    expect(formatDate('nope', 'short', 'es')).toBe('');
    expect(formatTime('nope', {}, 'es')).toBe('');
  });

  test('time is 24 h in Spanish and 12 h in English', () => {
    const d = new Date(2026, 9, 4, 18, 30);
    expect(formatTime(d, {}, 'es')).toBe('18:30');
    expect(formatTime(d, {}, 'en')).toBe('6:30 pm');
    expect(formatTime(new Date(2026, 9, 4, 0, 5), {}, 'es')).toBe('00:05');
  });

  test('time falls back by hand when Intl is unavailable', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('no Intl'); });
    const d = new Date(2026, 9, 4, 9, 7);
    expect(formatTime(d, { timeZone: 'Europe/Madrid' }, 'es')).toBe('09:07');
    expect(formatTime(d, {}, 'en')).toBe('9:07 am');
    spy.mockRestore();
  });
});
