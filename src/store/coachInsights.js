import { buildDiagnosis } from './coachDiagnosis';
import { msg, n, raw } from './statsMsg';

const EMPTY_BOARD = {
  fixFirst: [],
  keepDoing: [],
  gettingBetter: [],
  gettingWorse: [],
  nextGains: [],
  watch: [],
};

const AREA_LABELS = {
  form: 'Form',
  driving: 'Driving',
  approach: 'Approach',
  putting: 'Putting',
  shortGame: 'Short game',
  scoring: 'Scoring',
  roundShape: 'Round shape',
  penalties: 'Penalties',
};

const AREA_ALIASES = {
  tee: 'driving',
  offthetee: 'driving',
  drive: 'driving',
  driving: 'driving',
  fairwaypct: 'driving',
  approach: 'approach',
  girpct: 'approach',
  putting: 'putting',
  putt: 'putting',
  puttsperround: 'putting',
  threeputtsperround: 'putting',
  aroundgreen: 'shortGame',
  aroundthegreen: 'shortGame',
  shortgame: 'shortGame',
  scoring: 'scoring',
  form: 'form',
  roundshape: 'roundShape',
  closing: 'roundShape',
  penalties: 'penalties',
};

const STRENGTH_MIN = 0.1; // strokes/round gained before a category counts as a strength
const LOW_SAMPLE_MAX = 5;
const HIGH_CONFIDENCE_SAMPLE = 12;
const CONFIDENCE_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
};
const VALUE_FORM_UNITS = {
  avgPoints: 'pts / round',
};
const SG_CATEGORY_TITLES = {
  offTheTee: 'Off the tee',
  approach: 'Approach',
  aroundGreen: 'Short game',
  putting: 'Putting',
  penalties: 'Penalties',
};

const round2 = (value) => Math.round(value * 100) / 100;

// Display descriptors (docs/i18n.md). Every insight keeps its English
// title/reason/metric/basis strings, which ids, drills and saved focuses key
// off, and also carries the same text as titleMsg/reasonMsg/metricMsg/basisMsg
// for the screen to render in the active language.
const SG_CATEGORY_KEYS = {
  offTheTee: 'stats.my.sgCategory.offTheTee',
  approach: 'stats.my.sgCategory.approach',
  aroundGreen: 'stats.my.sgCategory.aroundGreen',
  putting: 'stats.my.sgCategory.putting',
  penalties: 'stats.my.sgCategory.penalties',
};
const BASIS_KEYS = {
  'vs your avg': 'stats.my.basis.vsAvg',
  'vs target hcp': 'stats.my.basis.vsTarget',
  'recent vs previous': 'stats.my.basis.recentVsPrevious',
  'opening vs closing': 'stats.my.basis.openingVsClosing',
  'front vs back': 'stats.my.basis.frontVsBack',
  'tracked sample': 'stats.my.basis.tracked',
};
const UNIT_KEYS = {
  pts: 'stats.my.unit.pts',
  'pts / hole': 'stats.my.unit.ptsHole',
  'pts / round': 'stats.my.unit.ptsRound',
  'SG / shot': 'stats.my.unit.sgShot',
  'SG / putt': 'stats.my.unit.sgPutt',
  'SG / round': 'stats.my.unit.sgRound',
};
const ACROSS_KEYS = {
  rounds: 'stats.my.coach.across.rounds',
  drives: 'stats.my.coach.across.drives',
  holes: 'stats.my.coach.across.holes',
  putts: 'stats.my.coach.across.putts',
  shots: 'stats.my.coach.across.shots',
  samples: 'stats.my.coach.across.samples',
};
const basisMsg = (basis) => (BASIS_KEYS[basis] ? msg(BASIS_KEYS[basis]) : raw(basis));
const unitMsg = (unit) => (UNIT_KEYS[unit] ? msg(UNIT_KEYS[unit]) : raw(unit));
const signedN = (value, opts = {}) => (
  Number.isFinite(value) ? n(round2(value), { signed: true, ...opts }) : '0'
);
const metricMsg = (value, unit, opts) => msg('stats.my.coach.metric', { value: signedN(value, opts), unit: unitMsg(unit) });
const plainMetricMsg = (value, unit) => msg('stats.my.coach.metric', { value: n(round2(value)), unit: unitMsg(unit) });

function normalizeArea(area) {
  const key = String(area || '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
  return AREA_ALIASES[key] || 'scoring';
}

function slug(value) {
  return String(value || 'insight')
    .toLowerCase()
    .replace(/\+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'insight';
}

function confidenceForSample(sample) {
  if (!Number.isFinite(sample)) return 'medium';
  if (sample <= LOW_SAMPLE_MAX) return 'low';
  if (sample >= HIGH_CONFIDENCE_SAMPLE) return 'high';
  return 'medium';
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = round2(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function samplePhrase(sample, unit, sampleUnit) {
  if (!Number.isFinite(sample) || sample <= 0) return 'in the tracked sample';
  if (sampleUnit) return `across ${sample} ${sampleUnit}`;

  const normalizedUnit = String(unit || '').toLowerCase();
  if (normalizedUnit.includes('round')) return `across ${sample} rounds`;
  if (normalizedUnit.includes('drive')) return `across ${sample} drives`;
  if (normalizedUnit.includes('hole')) return `across ${sample} holes`;
  if (normalizedUnit.includes('putt')) return `across ${sample} putts`;
  if (normalizedUnit.includes('shot')) return `across ${sample} shots`;
  return `across ${sample} samples`;
}

function samplePhraseMsg(sample, unit, sampleUnit) {
  if (!Number.isFinite(sample) || sample <= 0) return msg('stats.my.coach.across.tracked');
  if (sampleUnit) {
    return ACROSS_KEYS[sampleUnit]
      ? msg(ACROSS_KEYS[sampleUnit], { count: sample })
      : msg('stats.my.coach.across.other', { count: sample, unit: sampleUnit });
  }
  const normalizedUnit = String(unit || '').toLowerCase();
  if (normalizedUnit.includes('round')) return msg(ACROSS_KEYS.rounds, { count: sample });
  if (normalizedUnit.includes('drive')) return msg(ACROSS_KEYS.drives, { count: sample });
  if (normalizedUnit.includes('hole')) return msg(ACROSS_KEYS.holes, { count: sample });
  if (normalizedUnit.includes('putt')) return msg(ACROSS_KEYS.putts, { count: sample });
  if (normalizedUnit.includes('shot')) return msg(ACROSS_KEYS.shots, { count: sample });
  return msg(ACROSS_KEYS.samples, { count: sample });
}

function valueFormUnit(metric) {
  if (VALUE_FORM_UNITS[metric?.key]) return VALUE_FORM_UNITS[metric.key];
  const unit = String(metric?.unit || '');
  if (unit.includes('SG') || unit.includes('pts')) return unit;
  return null;
}

function makeInsight({
  id,
  group,
  area,
  title,
  reason,
  metric,
  impact,
  sample,
  basis,
  confidence,
  tone,
  priority = 0,
  pointsPerRound,
  titleMsg,
  reasonMsg,
  metricMsg: metricDescriptor,
  basisMsg: basisDescriptor,
}) {
  const normalizedArea = normalizeArea(area);
  return {
    id: id ?? `${normalizedArea}:${slug(title)}`,
    group,
    area: normalizedArea,
    areaLabel: AREA_LABELS[normalizedArea],
    title,
    reason,
    metric,
    titleMsg: titleMsg ?? raw(title),
    reasonMsg: reasonMsg ?? raw(reason),
    ...(metricDescriptor ? { metricMsg: metricDescriptor } : {}),
    ...(Number.isFinite(impact) ? { impact: round2(impact) } : {}),
    ...(Number.isFinite(sample) ? { sample } : {}),
    ...(basis ? { basis, basisMsg: basisDescriptor ?? basisMsg(basis) } : {}),
    ...(Number.isFinite(pointsPerRound) ? { pointsPerRound: round2(pointsPerRound) } : {}),
    confidence: confidence || confidenceForSample(sample),
    tone,
    priority,
  };
}

function formInsight(metric) {
  if (!metric?.label || !Number.isFinite(metric.delta)) return null;
  const unit = valueFormUnit(metric);
  if (!unit) return null;
  const improved = metric.polarity === 'lower' ? metric.delta < 0 : metric.delta > 0;
  if (metric.delta === 0) return null;
  const group = improved ? 'gettingBetter' : 'gettingWorse';
  const tone = improved ? 'good' : 'bad';
  return makeInsight({
    group,
    area: metric.shot ? metric.key : 'form',
    title: metric.label,
    reason: `${metric.label} moved from ${metric.history} to ${metric.recent} ${unit}.`,
    metric: `${formatSigned(metric.delta)} ${unit}`,
    titleMsg: metric.labelKey ? msg(metric.labelKey) : raw(metric.label),
    reasonMsg: msg('stats.my.coach.reason.moved', {
      label: metric.labelKey ? msg(metric.labelKey) : raw(metric.label),
      history: n(metric.history, { maxDecimals: 4 }),
      recent: n(metric.recent, { maxDecimals: 4 }),
      unit: unitMsg(unit),
    }),
    metricMsg: metricMsg(metric.delta, unit),
    impact: metric.delta,
    basis: 'recent vs previous',
    confidence: 'medium',
    tone,
  });
}

function rankingWeaknessInsight(item) {
  if (!item?.label) return null;
  const sample = Number(item.sample);
  return makeInsight({
    group: 'watch',
    area: item.label.toLowerCase().includes('closing') ? 'roundShape' : 'scoring',
    title: item.label,
    reason: `${item.label} is below your scoring baseline by ${formatSigned(item.deviation)} points.`,
    metric: `${round2(item.avgPoints || 0)} pts / hole`,
    titleMsg: item.labelMsg ?? raw(item.label),
    reasonMsg: msg('stats.my.coach.reason.belowBaseline', {
      label: item.labelMsg ?? raw(item.label),
      value: signedN(item.deviation),
    }),
    metricMsg: plainMetricMsg(item.avgPoints || 0, 'pts / hole'),
    impact: item.deviation,
    sample,
    basis: 'vs your avg',
    confidence: confidenceForSample(sample),
    tone: 'watch',
    priority: 3,
  });
}

function roundShapeInsights(stats) {
  const insights = [];
  const closing = stats.warmupClosing?.closing;
  const warmup = stats.warmupClosing?.warmup;
  if (closing && warmup && Number.isFinite(closing.avgPoints) && Number.isFinite(warmup.avgPoints)) {
    const gap = closing.avgPoints - warmup.avgPoints;
    if (gap < -0.4) {
      insights.push(makeInsight({
        group: 'watch',
        area: 'roundShape',
        title: 'Closing 3 holes',
        reason: `The closing stretch is ${formatSigned(gap)} points per hole versus your warmup holes.`,
        metric: `${round2(closing.avgPoints)} pts / hole`,
        titleMsg: msg('stats.my.coach.closing.title'),
        reasonMsg: msg('stats.my.coach.reason.closing', { value: signedN(gap) }),
        metricMsg: plainMetricMsg(closing.avgPoints, 'pts / hole'),
        impact: gap,
        sample: closing.holes,
        basis: 'opening vs closing',
        confidence: confidenceForSample(Number(closing.holes)),
        tone: 'watch',
      }));
    }
  }

  const frontBack = stats.frontBack;
  if (frontBack && Number.isFinite(frontBack.frontAvg) && Number.isFinite(frontBack.backAvg)) {
    const gap = frontBack.backAvg - frontBack.frontAvg;
    if (gap < -1.5) {
      insights.push(makeInsight({
        group: 'watch',
        area: 'roundShape',
        title: 'Back nine scoring',
        reason: `The back nine is ${formatSigned(gap)} points compared with the front nine.`,
        metric: `${round2(frontBack.backAvg)} pts`,
        titleMsg: msg('stats.my.coach.backNine.title'),
        reasonMsg: msg('stats.my.coach.reason.backNine', { value: signedN(gap) }),
        metricMsg: plainMetricMsg(frontBack.backAvg, 'pts'),
        impact: gap,
        sample: frontBack.rounds?.length,
        basis: 'front vs back',
        confidence: confidenceForSample(frontBack.rounds?.length),
        tone: 'watch',
      }));
    }
  }
  return insights;
}

function addUnique(board, insight, seen) {
  if (!insight) return;
  const key = `${insight.area}:${slug(insight.title)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const boardKey = insight.group === 'nextGain' ? 'nextGains' : insight.group;
  board[boardKey].push(insight);
}

function sortByImpact(insights, direction = 'asc') {
  return [...insights].sort((a, b) => {
    const priorityGap = (a.priority ?? 0) - (b.priority ?? 0);
    if (priorityGap !== 0) return priorityGap;
    const confidenceGap = (CONFIDENCE_ORDER[a.confidence] ?? 1) - (CONFIDENCE_ORDER[b.confidence] ?? 1);
    if (confidenceGap !== 0) return confidenceGap;
    const ai = Number.isFinite(a.impact) ? Math.abs(a.impact) : 0;
    const bi = Number.isFinite(b.impact) ? Math.abs(b.impact) : 0;
    if (ai !== bi) return bi - ai;
    const rawA = Number.isFinite(a.impact) ? a.impact : 0;
    const rawB = Number.isFinite(b.impact) ? b.impact : 0;
    return direction === 'asc' ? rawA - rawB : rawB - rawA;
  });
}


// Leak insights: id = leak id (`leak:<category>` or `leak:<category>:<bucket>`).
// Carries the diagnosis numbers beside the fields the board rows render today.
function leakInsight(leak, group, tone) {
  const category = leak.category;
  const title = SG_CATEGORY_TITLES[category];
  const titleMsg = msg(SG_CATEGORY_KEYS[category]);
  const value = leak.strokesPerRound;
  const sample = leak.sample?.holes;
  const cost = Number.isFinite(value) ? Math.abs(round2(value)) : 0;
  return {
    ...makeInsight({
      id: leak.id,
      group,
      area: category,
      title,
      reason: `${title} is costing ${cost} SG / round versus your target handicap ${samplePhrase(sample, 'SG / round', 'holes')}.`,
      metric: `${formatSigned(value)} SG / round`,
      titleMsg,
      reasonMsg: msg('stats.my.coach.reason.sgCosting', {
        title: titleMsg,
        value: signedN(value, { noMinus: true }),
        phrase: samplePhraseMsg(sample, 'SG / round', 'holes'),
      }),
      metricMsg: metricMsg(value, 'SG / round'),
      impact: value,
      sample,
      basis: 'vs target hcp',
      confidence: leak.confidence,
      tone,
      pointsPerRound: value,
    }),
    category,
    bucket: leak.bucket ?? null,
    strokesPerRound: value,
    se: leak.se ?? null,
  };
}

// Positive categories (sufficient sample, at least STRENGTH_MIN strokes/round
// gained, not a low-confidence reading) → Keep doing. Id `strength:<category>`.
function strengthInsight(category) {
  const title = SG_CATEGORY_TITLES[category.category];
  const titleMsg = msg(SG_CATEGORY_KEYS[category.category]);
  const value = category.strokesPerRound;
  const sample = category.sample?.holes;
  return makeInsight({
    id: `strength:${category.category}`,
    group: 'keepDoing',
    area: category.category,
    title,
    reason: `${title} is gaining ${formatSigned(value)} SG / round versus your target handicap ${samplePhrase(sample, 'SG / round', 'holes')}.`,
    metric: `${formatSigned(value)} SG / round`,
    titleMsg,
    reasonMsg: msg('stats.my.coach.reason.sgGaining', {
      title: titleMsg, value: signedN(value), phrase: samplePhraseMsg(sample, 'SG / round', 'holes'),
    }),
    metricMsg: metricMsg(value, 'SG / round'),
    impact: value,
    sample,
    basis: 'vs target hcp',
    confidence: category.confidence,
    tone: 'good',
    pointsPerRound: value,
  });
}

// A category under the sample gates: never ranked, shown in Monitor with what
// it still needs (`needs` is kept on the insight for the screen).
function insufficientInsight(category) {
  const title = SG_CATEGORY_TITLES[category.category];
  const titleMsg = msg(SG_CATEGORY_KEYS[category.category]);
  return {
    ...makeInsight({
      id: category.id,
      group: 'watch',
      area: category.category,
      title,
      reason: `${title} needs more tracked data before it can be ranked.`,
      metric: '',
      titleMsg,
      reasonMsg: msg('stats.my.coach.reason.insufficient', { title: titleMsg }),
      sample: category.sample?.holes,
      basis: 'tracked sample',
      confidence: 'low',
      tone: 'watch',
      priority: 2,
    }),
    category: category.category,
    needs: category.needs ?? null,
  };
}

// Board from the diagnosis (coach v2 spec §6): top leak (and its tie) →
// fixFirst, remaining medium/high leaks → nextGains, low-confidence leaks and
// under-sampled categories → watch, positive categories → keepDoing. Form
// trends, ranking weaknesses and round shape are unchanged.
function buildBoard(stats, diagnosis) {
  const board = {
    fixFirst: [],
    keepDoing: [],
    gettingBetter: [],
    gettingWorse: [],
    nextGains: [],
    watch: [],
  };
  const seen = new Set();
  const leaks = diagnosis?.leaks ?? [];
  const fixFirstIds = new Set([diagnosis?.top?.id, diagnosis?.tie?.id].filter(Boolean));

  leaks.forEach((leak) => {
    if (fixFirstIds.has(leak.id)) {
      addUnique(board, leakInsight(leak, 'fixFirst', 'bad'), seen);
    } else if (leak.confidence === 'low') {
      addUnique(board, leakInsight(leak, 'watch', 'watch'), seen);
    } else {
      addUnique(board, leakInsight(leak, 'nextGain', 'neutral'), seen);
    }
  });
  if (diagnosis?.candidate) {
    addUnique(board, leakInsight(diagnosis.candidate, 'nextGain', 'neutral'), seen);
  }

  (diagnosis?.categories ?? [])
    .filter((c) => c.confidence !== 'insufficient' && c.confidence !== 'low' && c.strokesPerRound >= STRENGTH_MIN)
    .forEach((c) => addUnique(board, strengthInsight(c), seen));
  (diagnosis?.insufficient ?? []).forEach((c) => addUnique(board, insufficientInsight(c), seen));

  (stats.form?.metrics || []).forEach((metric) => {
    addUnique(board, formInsight(metric), seen);
  });
  (stats.ranking?.weaknesses || []).forEach((item) => {
    addUnique(board, rankingWeaknessInsight(item), seen);
  });
  roundShapeInsights(stats).forEach((insight) => addUnique(board, insight, seen));

  // fixFirst / nextGains keep the diagnosis order (strokes/round, confidence,
  // trainability); the rest sort by impact as before.
  board.keepDoing = sortByImpact(board.keepDoing, 'desc');
  board.gettingBetter = sortByImpact(board.gettingBetter, 'desc');
  board.gettingWorse = sortByImpact(board.gettingWorse, 'asc');
  board.watch = sortByImpact(board.watch, 'asc');
  return board;
}

function pickHero(board, diagnosis) {
  const top = diagnosis?.top && board.fixFirst.find((insight) => insight.id === diagnosis.top.id);
  if (top) return top;
  return board.gettingBetter[0] || board.keepDoing[0] || board.nextGains[0] || board.watch[0] || null;
}

// `diagnosis` defaults to buildDiagnosis(stats); computeMyStats passes the one
// it already built so the board and `coachDiagnosis` agree.
export function buildCoachInsights(stats = {}, diagnosis = buildDiagnosis(stats || {})) {
  const board = buildBoard(stats || {}, diagnosis);
  return {
    hero: pickHero(board, diagnosis),
    board: {
      ...EMPTY_BOARD,
      ...board,
    },
  };
}
