// Playing-conditions model: how far the ball ACTUALLY flies today vs the
// "standard" conditions your logged club carries were (roughly) measured in.
// Two effects, both multipliers on carry:
//   • Air temperature — warm thin air carries farther, cold dense air shorter.
//   • Altitude — thinner air up high carries farther (~2% per 1000 ft).
//   • Wind — the head/tail part of the wind along the shot (cross wind moves
//     the ball sideways, not shorter).
// Temperature and wind come from the cached forecast (store/weatherStore.js)
// when there is one; otherwise temperature is estimated from the month (a
// Spain-interior average curve) cooled by elevation (6.5 °C / 1000 m lapse)
// and wind is left out. All distances in metres.
import { t } from '../i18n';

// Monthly mean air temp (°C), Spain interior baseline (Madrid-ish). Index 0=Jan.
export const MONTHLY_TEMP_C = [6, 8, 11, 13, 17, 23, 26, 26, 21, 15, 10, 7];

const LAPSE_C_PER_M = 6.5 / 1000; // temperature drop per metre of elevation
const TEMP_BASELINE_C = 20; // conditions your nominal/logged carries assume
const TEMP_SLOPE = 0.0025; // carry change per °C from baseline (~0.25%/°C)
const ALT_PER_M = 0.02 / 304.8; // +2% carry per 1000 ft (304.8 m)

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Estimated air temp (°C) for a month index (0–11) at a given elevation.
export function estimateTempC(month, altitudeM = 0) {
  const base = MONTHLY_TEMP_C[((month % 12) + 12) % 12];
  return base - LAPSE_C_PER_M * Math.max(0, altitudeM || 0);
}

// Carry multiplier from temperature alone (1.0 at the 20 °C baseline).
export function tempFactor(celsius) {
  if (!Number.isFinite(celsius)) return 1;
  return clamp(1 + (celsius - TEMP_BASELINE_C) * TEMP_SLOPE, 0.9, 1.06);
}

// Carry multiplier from elevation alone (1.0 at sea level).
export function altitudeFactor(altitudeM) {
  const m = Math.max(0, altitudeM || 0);
  return clamp(1 + m * ALT_PER_M, 1, 1.2);
}

// Combined carry multiplier for a set of conditions. >1 means the ball flies
// farther than standard, so a hole plays SHORTER than its measured distance.
// `tempC` (a real reading) wins over the month estimate.
export function conditionFactor({ month, altitudeM = 0, tempC } = {}) {
  const m = Number.isFinite(month) ? month : 0;
  const temp = Number.isFinite(tempC) ? tempC : estimateTempC(m, altitudeM);
  return tempFactor(temp) * altitudeFactor(altitudeM);
}

const RAD = Math.PI / 180;
const KMH_PER_MPH = 1.609344;
export const CALM_KMH = 5;

// Wind relative to a shot. `fromDeg` is where the wind blows FROM (weather
// convention), `bearingDeg` the shot's compass direction. headKmh > 0 is into
// the player, < 0 helping; crossKmh > 0 comes from the right. `arrowDeg` is
// where the wind blows TO with the shot pointing up (for an arrow glyph).
export function windComponents(kmh, fromDeg, bearingDeg) {
  if (![kmh, fromDeg, bearingDeg].every(Number.isFinite)) return null;
  const rel = (((fromDeg - bearingDeg) % 360) + 360) % 360;
  const headKmh = kmh * Math.cos(rel * RAD);
  const crossKmh = kmh * Math.sin(rel * RAD);
  let kind = 'calm';
  if (kmh >= CALM_KMH) kind = Math.abs(headKmh) >= Math.abs(crossKmh) ? (headKmh > 0 ? 'into' : 'helping') : 'across';
  const side = Math.abs(crossKmh) < 1 ? null : crossKmh > 0 ? 'right' : 'left';
  return { kmh, headKmh, crossKmh, kind, side, arrowDeg: (rel + 180) % 360 };
}

// Plays-like multiplier from the head/tail part of the wind. Rule of thumb:
// a head wind costs ~1% per mph, a tail wind gives back ~0.5% per mph.
export function windFactor(headKmh) {
  if (!Number.isFinite(headKmh)) return 1;
  const mph = headKmh / KMH_PER_MPH;
  return clamp(1 + mph * (mph > 0 ? 0.01 : 0.005), 0.8, 1.35);
}

// The distance you should CLUB for to cover a real geometric distance today:
// if the ball flies `factor`× standard, a target of D metres plays like D/factor.
export function playsLike(geoMeters, factor) {
  if (!Number.isFinite(geoMeters) || !Number.isFinite(factor) || factor <= 0) return geoMeters;
  return geoMeters / factor;
}

// Human-readable one-liner for the conditions UI, e.g.
// "≈ 12 °C · 620 m → holes play ~3% shorter".
export function describeConditions({ month, altitudeM = 0, tempC } = {}) {
  const m = Number.isFinite(month) ? month : 0;
  const temp = Number.isFinite(tempC) ? tempC : estimateTempC(m, altitudeM);
  const factor = conditionFactor({ month: m, altitudeM, tempC });
  const pct = Math.round((factor - 1) * 100);
  let text;
  if (pct === 0) text = t('shared.conditions.asMarked');
  else text = t(pct > 0 ? 'shared.conditions.shorter' : 'shared.conditions.longer', { pct: Math.abs(pct) });
  return { tempC: Math.round(temp), altitudeM: Math.round(altitudeM || 0), factor, pct, text };
}

// "18 km/h · into, from the left" (or the breakdown row "Wind 18 km/h, into
// from the left" with `row`); "calm" under CALM_KMH. null without wind.
export function windText(wind, { row = false } = {}) {
  if (!wind) return null;
  if (wind.kind === 'calm') return t('shared.conditions.calm');
  const kmh = Math.round(wind.kmh);
  const kind = t(`shared.conditions.${wind.kind}`);
  const prefix = row ? 'shared.conditions.windRow' : 'shared.conditions.windLine';
  if (!wind.side) return t(prefix, { kmh, kind });
  return t(`${prefix}Side`, { kmh, kind, side: t(wind.side === 'left' ? 'shared.conditions.fromLeft' : 'shared.conditions.fromRight') });
}

// Eight-point compass name for where the wind blows from ("W", "NO"…).
export function compassPoint(deg) {
  if (!Number.isFinite(deg)) return '';
  const names = t('shared.conditions.compass').split(',');
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
