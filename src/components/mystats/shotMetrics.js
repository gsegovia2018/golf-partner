const DRIVE_ORDER = ['super', 'fairway', 'left', 'right', 'short'];
const DRIVE_LABELS = {
  super: 'Super drives',
  fairway: 'Fairway drives',
  left: 'Left misses',
  right: 'Right misses',
  short: 'Short drives',
};
const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
const PUTT_BUCKETS = ['0-1', '1-2', '2-3', '3-6', '6+'];
const SG_CATEGORIES = [
  { key: 'approach', label: 'Approach', area: 'Approach', signalTitle: 'Approach shots' },
  { key: 'aroundGreen', label: 'Around green', area: 'Short game' },
  { key: 'putting', label: 'Putting', area: 'Putting', signalTitle: 'Putting performance' },
  { key: 'penalties', label: 'Penalties', area: 'Scoring', signalTitle: 'Other penalties' },
];

function signed(value) {
  if (value == null) return '-';
  return value > 0 ? `+${value}` : `${value}`;
}

function formatSignedFixed(value) {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function sampleText(value, label) {
  if (value == null) return undefined;
  return `${value} ${value === 1 ? label.replace(/s$/, '') : label}`;
}

function driveRows(driveImpact) {
  return DRIVE_ORDER
    .map((bucket) => ({ bucket, label: DRIVE_LABELS[bucket], ...(driveImpact?.buckets?.[bucket] ?? {}) }))
    .filter((row) => row.holes > 0);
}

export {
  APPROACH_BUCKETS,
  DRIVE_LABELS,
  DRIVE_ORDER,
  PUTT_BUCKETS,
  SG_CATEGORIES,
  driveRows,
  formatSignedFixed,
  sampleText,
  signed,
};
