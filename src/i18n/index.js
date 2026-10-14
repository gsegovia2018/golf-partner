// Tiny pure-JS i18n (no native module, so OTA updates keep working).
// Docs and conventions: docs/i18n.md
import { useSyncExternalStore, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en';
import es from './locales/es';
import { formatDate } from './format';

export const LANGUAGE_PREF_KEY = '@language_pref';
export const SUPPORTED = ['en', 'es'];
const CATALOGUES = { en, es };

let pref = 'system'; // 'system' | 'es' | 'en'
let lang = 'en';
const listeners = new Set();

// The device language as a bare code ('es-ES' -> 'es'); '' when unknown.
export function detectSystemLanguage() {
  const candidates = [];
  try {
    candidates.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // Runtime without Intl.
  }
  try {
    if (typeof navigator !== 'undefined') {
      candidates.push(...(navigator.languages ?? []), navigator.language);
    }
  } catch {
    // No navigator.
  }
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c.toLowerCase().split(/[-_]/)[0];
  }
  return '';
}

// Spanish when the system language is Spanish; English for everything else.
export function resolveLanguage(preference, system = detectSystemLanguage()) {
  if (preference === 'es' || preference === 'en') return preference;
  return system === 'es' ? 'es' : 'en';
}

// Web: keep <html lang> on the active language (screen readers, hyphenation,
// browser translation prompts). No-op on native, where there is no document.
function syncDocumentLang() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang;
    }
  } catch {
    // Nothing to sync.
  }
}

function apply(nextPref) {
  const nextLang = resolveLanguage(nextPref);
  if (nextPref === pref && nextLang === lang) return;
  pref = nextPref;
  lang = nextLang;
  syncDocumentLang();
  listeners.forEach((l) => l());
}

export const getLanguage = () => lang;
export const getLanguagePref = () => pref;

export async function setLanguagePref(next) {
  const value = next === 'es' || next === 'en' ? next : 'system';
  apply(value);
  try {
    await AsyncStorage.setItem(LANGUAGE_PREF_KEY, value);
  } catch {
    // Not persisted; applies for this session.
  }
}

export function subscribeLanguage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Reads the stored override. Runs once at import time so every entry point,
// including the pre-session marker page, picks it up.
export async function loadLanguagePref() {
  try {
    const v = await AsyncStorage.getItem(LANGUAGE_PREF_KEY);
    apply(v === 'es' || v === 'en' ? v : 'system');
  } catch {
    apply('system');
  }
}

lang = resolveLanguage('system');
syncDocumentLang();
loadLanguagePref();

// en and es both split on exactly 1.
export const pluralForm = (n) => (Math.abs(Number(n)) === 1 ? 'one' : 'other');

const PARAM = /\{(\w+)\}/g;
const CASED_PARAMS = new Set(['month', 'otherMonth', 'weekday']);
// True when `offset` is the start of the text or follows a sentence end.
const startsSentence = (whole, offset) => /(^|[.!?¿¡]\s+|\n\s*)$/.test(whole.slice(0, offset));

// t('marker.confirm.title', { name }). A plural entry is { one, other } and
// picks by params.count. Missing key: English, then the key itself.
export function t(key, params = {}, language = lang) {
  let entry = (CATALOGUES[language] ?? en)[key];
  if (entry === undefined) entry = en[key];
  if (entry === undefined) return key;
  if (typeof entry === 'object') entry = entry[pluralForm(params.count)] ?? entry.other;
  return String(entry).replace(PARAM, (m, name, offset, whole) => {
    if (params[name] === undefined) return m;
    const value = String(params[name]);
    // Spanish writes months and weekdays in lower case mid-sentence, but a
    // sentence still starts with a capital: "Octubre sigue ocupado."
    return CASED_PARAMS.has(name) && language === 'es' && startsSentence(whole, offset)
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : value;
  });
}

// Render a { key, params } descriptor returned by a pure store module.
// A `monthKey` param ('2026-10') becomes `month` ("October" / "octubre") at
// render time, so a descriptor cached before a language switch stays right.
// A param may itself be a descriptor ({ key, params }): it is rendered first,
// depth-first (a hole list inside an achievement line).
export const tr = (msg) => {
  if (!msg) return '';
  if (typeof msg === 'string') return msg; // already finished text
  let params = msg.params?.monthKey
    ? { ...msg.params, month: formatDate(`${msg.params.monthKey}-01`, 'monthName') }
    : msg.params;
  if (params && Object.values(params).some((v) => v && typeof v === 'object' && typeof v.key === 'string')) {
    params = Object.fromEntries(Object.entries(params).map(([k, v]) => [
      k, v && typeof v === 'object' && typeof v.key === 'string' ? tr(v) : v,
    ]));
  }
  return t(msg.key, params);
};

// Re-renders the component when the language changes.
export function useT() {
  const current = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  return useCallback((key, params) => t(key, params, current), [current]);
}

// The stored preference ('system' | 'es' | 'en'), reactive.
export function useLanguagePref() {
  return useSyncExternalStore(subscribeLanguage, getLanguagePref, getLanguagePref);
}

export { formatNumber, formatDate, formatTime, formatOrdinal } from './format';

// Test helper.
export function __resetForTests() {
  pref = 'system';
  lang = resolveLanguage('system');
}
