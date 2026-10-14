import { t, formatNumber } from '../../i18n';

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
// `label`, `area` and `signalTitle` are the English identities; the *Key
// fields are catalogue keys to render them in the active language.
const SG_CATEGORIES = [
  {
    key: 'offTheTee', label: 'Off the tee', labelKey: 'stats.my.snapshot.offTheTee', area: 'Driving', areaKey: 'stats.my.area.driving', signalTitle: 'Tee shots', signalTitleKey: 'stats.my.shots.signal.tee',
  },
  {
    key: 'approach', label: 'Approach', labelKey: 'stats.my.snapshot.approach', area: 'Approach', areaKey: 'stats.my.area.approach', signalTitle: 'Approach shots', signalTitleKey: 'stats.my.shots.signal.approach',
  },
  {
    key: 'aroundGreen', label: 'Around green', labelKey: 'stats.my.snapshot.aroundGreen', area: 'Short game', areaKey: 'stats.my.area.shortGame',
  },
  {
    key: 'putting', label: 'Putting', labelKey: 'stats.my.snapshot.putting', area: 'Putting', areaKey: 'stats.my.area.putting', signalTitle: 'Putting performance', signalTitleKey: 'stats.my.shots.signal.putting',
  },
  {
    key: 'penalties', label: 'Penalties', labelKey: 'stats.my.sgCategory.penalties', area: 'Scoring', areaKey: 'stats.my.area.scoring', signalTitle: 'Other penalties', signalTitleKey: 'stats.my.shots.signal.penalties',
  },
];

// Below this many contributing holes a category shows "needs N more holes"
// instead of a number (spec §1.7).
const MIN_SG_CATEGORY_SAMPLE = 10;

function signed(value) {
  if (value == null) return '-';
  return value > 0 ? `+${formatNumber(value, { maxDecimals: 4 })}` : formatNumber(value, { maxDecimals: 4 });
}

function formatSignedFixed(value) {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${formatNumber(value, { decimals: 2 })}`;
}

// Counted-noun keys for the sample captions, by the English noun callers pass.
const SAMPLE_KEYS = {
  holes: 'stats.my.count.holes',
  rounds: 'stats.my.count.rounds',
  drives: 'stats.my.count.drives',
  approaches: 'stats.my.count.approaches',
  'par 5s': 'stats.my.count.par5s',
  chances: 'stats.my.count.chances',
  shots: 'stats.my.count.shots',
  putts: 'stats.my.count.putts',
  tries: 'stats.my.count.tries',
};

function sampleText(value, label) {
  if (value == null) return undefined;
  const key = SAMPLE_KEYS[label];
  if (key) return t(key, { count: value });
  return `${value} ${value === 1 ? label.replace(/s$/, '') : label}`;
}

function driveRows(driveImpact) {
  return DRIVE_ORDER
    .map((bucket) => ({ bucket, label: t(`stats.my.drive.${bucket}`), ...(driveImpact?.buckets?.[bucket] ?? {}) }))
    .filter((row) => row.holes > 0);
}

export {
  APPROACH_BUCKETS,
  DRIVE_LABELS,
  DRIVE_ORDER,
  MIN_SG_CATEGORY_SAMPLE,
  PUTT_BUCKETS,
  SG_CATEGORIES,
  driveRows,
  formatSignedFixed,
  sampleText,
  signed,
};
