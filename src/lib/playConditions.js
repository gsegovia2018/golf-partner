// Playing-conditions model: how far the ball ACTUALLY flies today vs the
// "standard" conditions your logged club carries were (roughly) measured in.
// Two effects, both multipliers on carry:
//   • Air temperature — warm thin air carries farther, cold dense air shorter.
//   • Altitude — thinner air up high carries farther (~2% per 1000 ft).
// Temperature itself is estimated from the month (a Spain-interior average
// curve) and cooled by elevation (standard 6.5 °C / 1000 m lapse), so the only
// thing a course needs set manually is its elevation. All distances in metres.

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
export function conditionFactor({ month, altitudeM = 0 } = {}) {
  const m = Number.isFinite(month) ? month : 0;
  const temp = estimateTempC(m, altitudeM);
  return tempFactor(temp) * altitudeFactor(altitudeM);
}

// The distance you should CLUB for to cover a real geometric distance today:
// if the ball flies `factor`× standard, a target of D metres plays like D/factor.
export function playsLike(geoMeters, factor) {
  if (!Number.isFinite(geoMeters) || !Number.isFinite(factor) || factor <= 0) return geoMeters;
  return geoMeters / factor;
}

// Human-readable one-liner for the conditions UI, e.g.
// "≈ 12 °C · 620 m → holes play ~3% shorter".
export function describeConditions({ month, altitudeM = 0 } = {}) {
  const m = Number.isFinite(month) ? month : 0;
  const temp = estimateTempC(m, altitudeM);
  const factor = conditionFactor({ month: m, altitudeM });
  const pct = Math.round((factor - 1) * 100);
  const dir = pct === 0 ? 'play as marked' : `play ~${Math.abs(pct)}% ${pct > 0 ? 'shorter' : 'longer'}`;
  return { tempC: Math.round(temp), altitudeM: Math.round(altitudeM || 0), factor, pct, text: `holes ${dir}` };
}
