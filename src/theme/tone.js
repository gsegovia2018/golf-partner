import { light, semantic } from './tokens';

// The tone rule (DESIGN.md "The Tone Rule"): wherever a value is judged,
// good is green, mid is ink and bad is red — the Informe de vuelta's colours.
// A tone is 'good' | 'neutral' | 'bad'; polarity (lower handicap is better,
// fewer putts are better) is folded in by whoever picks the tone, never here.
// Gold is ceremony (bests, winners) and amber is "in progress" or a score
// conflict: neither ever stands for good, mid or bad.

export function toneColor(theme, tone) {
  if (tone === 'good') return theme.accent.primary;
  if (tone === 'bad') return theme.destructive;
  return theme.text.primary;
}

// The wash behind a toned chip or callout.
export function toneFill(theme, tone) {
  if (tone === 'good') return theme.accent.light;
  if (tone === 'bad') return theme.isDark ? theme.semantic.destructive.washDark : theme.semantic.destructive.washLight;
  return theme.bg.secondary;
}

// A filled verdict surface (the report hero, the Form hero). Text on it is
// theme.text.inverse.
export function toneSurface(theme, tone) {
  if (tone === 'bad') return theme.destructive;
  if (tone === 'good') return theme.accent.primary;
  return theme.text.primary;
}

// toneSurface in the light theme's colours whatever the theme, for a verdict
// card that keeps light text in both (the Play tab's After card): in dark mode
// toneSurface's mid is near-white.
export function toneSurfaceFixed(tone) {
  if (tone === 'bad') return semantic.destructive.light;
  if (tone === 'good') return light.accent.primary;
  return light.text.primary;
}

// 'up' / 'down' / 'flat' as the stats engines report it — already
// polarity-aware ('up' always means improving).
export function toneOfDirection(direction) {
  if (direction === 'up') return 'good';
  if (direction === 'down') return 'bad';
  return 'neutral';
}

// A signed value where positive is good (strokes gained, points vs average).
// Exactly zero — or anything within `tolerance` — is mid, never green.
export function toneOfSigned(value, tolerance = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) <= tolerance) return 'neutral';
  return value > 0 ? 'good' : 'bad';
}

// The tone of a trend line: the later half's average against the earlier
// half's, so one odd first or last round cannot flip the colour. `values` may
// be numbers or `{ value }` points; gaps are skipped. `lowerIsBetter` for
// handicap / differential / strokes.
export function toneOfSeries(values, { lowerIsBetter = false, tolerance = 0 } = {}) {
  const nums = (values || [])
    .map((v) => (v && typeof v === 'object' ? v.value : v))
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return 'neutral';
  const half = Math.floor(nums.length / 2);
  const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const change = mean(nums.slice(nums.length - half)) - mean(nums.slice(0, half));
  return toneOfSigned(lowerIsBetter ? -change : change, tolerance);
}

// The golf result scale (score mixes, the hole heat grid): birdie or better
// green, par ink-grey, bogey sand, double red at half strength, worse red.
// Par is the expected result, so it is mid, never green.
const SAND = '#e7d7b4';
export function scoreBandColors(theme) {
  return {
    birdiePlus: theme.accent.primary,
    par: theme.text.secondary,
    bogey: SAND,
    double: theme.isDark ? 'rgba(248,113,113,0.45)' : 'rgba(200,16,46,0.45)',
    worse: theme.destructive,
  };
}
