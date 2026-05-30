const DEFAULT_MIN_SAMPLE = 6;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLowSample(sample, minSample = DEFAULT_MIN_SAMPLE) {
  return isNumber(sample) && sample > 0 && sample < minSample;
}

function lowSampleLabel(sample, minSample = DEFAULT_MIN_SAMPLE) {
  return isLowSample(sample, minSample) ? 'low sample' : null;
}

function comparisonMeta(basis, parts = [], { sample, minSample = DEFAULT_MIN_SAMPLE } = {}) {
  return [
    basis,
    ...parts,
    lowSampleLabel(sample, minSample),
  ].filter(Boolean).join(' · ');
}

function toneFromDelta(delta, {
  tolerance = 0.05,
  sample,
  minSample = DEFAULT_MIN_SAMPLE,
} = {}) {
  if (!isNumber(delta) || isLowSample(sample, minSample) || Math.abs(delta) <= tolerance) {
    return 'neutral';
  }
  return delta > 0 ? 'good' : 'bad';
}

function toneFromComparison({
  value,
  target,
  polarity,
  tolerance = 0,
  sample,
  minSample = DEFAULT_MIN_SAMPLE,
}) {
  if (!isNumber(value) || !isNumber(target) || isLowSample(sample, minSample)) return 'neutral';
  const advantage = polarity === 'lower'
    ? target - value
    : value - target;
  return toneFromDelta(advantage, { tolerance });
}

function toneFromSigned(value, options) {
  return toneFromDelta(value, options);
}

function toneFromRate(value, target, options) {
  return toneFromComparison({
    value,
    target,
    polarity: 'higher',
    tolerance: 0,
    ...options,
  });
}

function toneColor(theme, tone) {
  if (tone === 'good') return theme.scoreColor('good');
  if (tone === 'bad') return theme.destructive;
  return theme.text.secondary;
}

function toneFill(theme, tone) {
  if (tone === 'good') return theme.accent.light;
  if (tone === 'bad') return theme.isDark ? 'rgba(248,113,113,0.14)' : '#fee2e2';
  return theme.bg.secondary;
}

export {
  comparisonMeta,
  isLowSample,
  lowSampleLabel,
  toneColor,
  toneFill,
  toneFromComparison,
  toneFromDelta,
  toneFromRate,
  toneFromSigned,
};
