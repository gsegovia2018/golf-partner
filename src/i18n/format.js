// Locale-aware number / date / time helpers. Pure JS and deterministic: names
// and separators come from the tables below, not from Intl, because Hermes
// on Android ships partial Intl and the output must match on every runtime.
// Only formatTime tries Intl (for time zones) and falls back by hand.
import { getLanguage } from './index';

const SEP = {
  en: { decimal: '.', group: ',' },
  // Spanish: comma decimals; thousands dot, always grouped (1.234, not 1234).
  es: { decimal: ',', group: '.' },
};

const WEEKDAYS = {
  en: {
    short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  es: {
    short: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    long: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  },
};

const MONTHS = {
  en: {
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
      'October', 'November', 'December'],
  },
  es: {
    short: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
    long: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
      'octubre', 'noviembre', 'diciembre'],
  },
};

const LOCALE_TAG = { en: 'en-GB', es: 'es-ES' };

// formatNumber(38.5) -> "38.5" / "38,5"; formatNumber(1234) -> "1,234" / "1.234".
// opts.decimals fixes the fraction digits; otherwise up to opts.maxDecimals
// (default 2) with trailing zeros trimmed. Non-numbers give ''.
export function formatNumber(value, opts = {}, lang = getLanguage()) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  const { decimals, maxDecimals = 2 } = opts;
  let fixed = Math.abs(n).toFixed(decimals ?? maxDecimals);
  if (decimals == null && fixed.includes('.')) fixed = fixed.replace(/\.?0+$/, '');
  const [intPart, frac] = fixed.split('.');
  const { decimal, group } = SEP[lang] ?? SEP.en;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return sign + grouped + (frac ? decimal + frac : '');
}

// A calendar date ('2026-10-04') parses as local so the day never shifts with
// the viewer's zone; anything else goes through new Date().
function toDate(input) {
  if (input instanceof Date) return input;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(input);
}

// Styles: 'short' "Sat 4 Oct" / "sáb 4 oct"; 'day' "4 Oct" / "4 oct";
// 'long' "Saturday 4 October 2026" / "sábado, 4 de octubre de 2026";
// 'month' "October 2026" / "octubre de 2026". Invalid input gives ''.
export function formatDate(input, style = 'short', lang = getLanguage()) {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  const l = lang === 'es' ? 'es' : 'en';
  const wd = WEEKDAYS[l];
  const mo = MONTHS[l];
  const day = d.getDate();
  const year = d.getFullYear();
  switch (style) {
    case 'day': return `${day} ${mo.short[d.getMonth()]}`;
    case 'long': return l === 'es'
      ? `${wd.long[d.getDay()]}, ${day} de ${mo.long[d.getMonth()]} de ${year}`
      : `${wd.long[d.getDay()]} ${day} ${mo.long[d.getMonth()]} ${year}`;
    case 'month': return l === 'es'
      ? `${mo.long[d.getMonth()]} de ${year}` : `${mo.long[d.getMonth()]} ${year}`;
    default: return `${wd.short[d.getDay()]} ${day} ${mo.short[d.getMonth()]}`;
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

// Clock time: 24 h in Spanish ("18:30"), 12 h in English ("6:30 pm").
// opts.timeZone (e.g. 'Europe/Madrid') is honoured when Intl supports it,
// otherwise the device's local time is used (same idea as leagueRules.cardMonth).
export function formatTime(input, opts = {}, lang = getLanguage()) {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '';
  const hour12 = lang !== 'es';
  try {
    const parts = new Intl.DateTimeFormat(LOCALE_TAG[lang] ?? 'en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12,
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const h = get('hour');
    const min = get('minute');
    if (h && min) {
      const period = (get('dayPeriod') ?? '').toLowerCase();
      return hour12 ? `${h}:${min} ${period}`.trim() : `${pad2(Number(h) % 24)}:${min}`;
    }
  } catch {
    // No Intl / timeZone support in this runtime: format by hand below.
  }
  const h = d.getHours();
  if (!hour12) return `${pad2(h)}:${pad2(d.getMinutes())}`;
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}
