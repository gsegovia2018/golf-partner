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

const LOW_SAMPLE_MAX = 5;
const HIGH_CONFIDENCE_SAMPLE = 12;
const STRONG_LEAK_SCORE = -0.5;
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

function normalizeArea(area) {
  const key = String(area || '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
  return AREA_ALIASES[key] || 'scoring';
}

function actionItemArea(item) {
  const area = String(item?.area || '');
  if (area.replace(/[^a-zA-Z]/g, '').toLowerCase() === 'strokesgained') {
    const labelArea = normalizeArea(item?.label);
    if (labelArea !== 'scoring') return item.label;
  }
  return item?.area;
}

function actionItemBasis(item) {
  if (item?.basis) return item.basis;
  const unit = String(item?.unit || '').toLowerCase();
  if (unit.includes('sg')) return 'vs target hcp';
  if (unit.includes('pts')) return 'vs your avg';
  return 'tracked sample';
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

function valueFormUnit(metric) {
  if (VALUE_FORM_UNITS[metric?.key]) return VALUE_FORM_UNITS[metric.key];
  const unit = String(metric?.unit || '');
  if (unit.includes('SG') || unit.includes('pts')) return unit;
  return null;
}

function makeInsight({
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
}) {
  const normalizedArea = normalizeArea(area);
  return {
    id: `${normalizedArea}:${slug(title)}`,
    group,
    area: normalizedArea,
    areaLabel: AREA_LABELS[normalizedArea],
    title,
    reason,
    metric,
    ...(Number.isFinite(impact) ? { impact: round2(impact) } : {}),
    ...(Number.isFinite(sample) ? { sample } : {}),
    ...(basis ? { basis } : {}),
    confidence: confidence || confidenceForSample(sample),
    tone,
    priority,
  };
}

function actionItemInsight(item, group, tone) {
  if (!item?.label) return null;
  const sample = Number(item.sample);
  const confidence = confidenceForSample(sample);
  const metric = `${formatSigned(item.score)} ${item.unit || 'pts'}`;
  const reason = tone === 'good'
    ? `${item.label} is gaining ${metric} ${samplePhrase(sample, item.unit, item.sampleUnit)}.`
    : `${item.label} is costing ${metric.replace('-', '')} ${samplePhrase(sample, item.unit, item.sampleUnit)}.`;
  return makeInsight({
    group,
    area: actionItemArea(item),
    title: item.label,
    reason,
    metric,
    impact: item.score,
    sample,
    basis: actionItemBasis(item),
    confidence,
    tone,
  });
}

function routeLeakInsight(insight, score) {
  if (!insight) return null;
  if (insight.confidence === 'low') {
    return { ...insight, group: 'watch', tone: 'watch' };
  }
  if (Number.isFinite(score) && score > STRONG_LEAK_SCORE) {
    return { ...insight, group: 'nextGain', tone: 'neutral' };
  }
  return { ...insight, group: 'fixFirst', tone: 'bad' };
}

function addLeakInsight(board, item, seen) {
  const insight = actionItemInsight(item, 'fixFirst', 'bad');
  addUnique(board, routeLeakInsight(insight, item?.score), seen);
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
    impact: item.deviation,
    sample,
    basis: 'vs your avg',
    confidence: confidenceForSample(sample),
    tone: 'watch',
    priority: 3,
  });
}

function strokesGainedCategoryInsights(stats) {
  const strokesGained = stats?.strokesGained;
  const categories = strokesGained?.byCategory ?? {};
  return Object.entries(categories).map(([category, value]) => {
    if (!Number.isFinite(value) || Math.abs(value) < 0.05) return null;
    const sample = Number(strokesGained?.sampleHolesByCategory?.[category]
      ?? strokesGained?.sampleHoles);
    const tone = value > 0 ? 'good' : 'bad';
    const title = SG_CATEGORY_TITLES[category] || AREA_LABELS[normalizeArea(category)];
    const sampleCopy = samplePhrase(sample, 'SG / round', 'holes');
    const insight = makeInsight({
      group: value > 0 ? 'keepDoing' : 'fixFirst',
      area: category,
      title,
      reason: value > 0
        ? `${title} is gaining ${formatSigned(value)} SG / round versus your target handicap ${sampleCopy}.`
        : `${title} is costing ${formatSigned(value).replace('-', '')} SG / round versus your target handicap ${sampleCopy}.`,
      metric: `${formatSigned(value)} SG / round`,
      impact: value,
      sample,
      basis: 'vs target hcp',
      confidence: confidenceForSample(sample),
      tone,
      priority: 1,
    });
    // Penalties are almost always non-positive and tracked on nearly every
    // round, so they are almost always "high confidence". Left unguarded,
    // that lets a small-but-persistent penalties cost outrank a genuinely
    // bigger leak elsewhere (which may only have medium/low confidence) for
    // the fixFirst/hero slot. Route penalties leaks through the same
    // confidence + strength gate used for actionPlan leaks so only a
    // *strong*, well-sampled penalties leak stays in fixFirst; a weak one
    // moves to nextGains/watch instead of crowding out other insights.
    if (category === 'penalties' && tone === 'bad') {
      return routeLeakInsight(insight, value);
    }
    return insight;
  }).filter(Boolean);
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

function buildBoard(stats) {
  const board = {
    fixFirst: [],
    keepDoing: [],
    gettingBetter: [],
    gettingWorse: [],
    nextGains: [],
    watch: [],
  };
  const seen = new Set();
  const actionPlan = stats.actionPlan || {};

  (actionPlan.improvements || []).forEach((item) => addLeakInsight(board, item, seen));

  if (actionPlan.improve && !(actionPlan.improvements || []).some((item) => item.label === actionPlan.improve.label)) {
    addLeakInsight(board, actionPlan.improve, seen);
  }

  if (actionPlan.practice) {
    addLeakInsight(board, actionPlan.practice, seen);
  }

  (actionPlan.strengths || []).forEach((item) => {
    addUnique(board, actionItemInsight(item, 'keepDoing', 'good'), seen);
  });

  if (actionPlan.keep && !(actionPlan.strengths || []).some((item) => item.label === actionPlan.keep.label)) {
    addUnique(board, actionItemInsight(actionPlan.keep, 'keepDoing', 'good'), seen);
  }

  (stats.form?.metrics || []).forEach((metric) => {
    addUnique(board, formInsight(metric), seen);
  });

  (stats.ranking?.weaknesses || []).forEach((item) => {
    addUnique(board, rankingWeaknessInsight(item), seen);
  });

  strokesGainedCategoryInsights(stats).forEach((insight) => addUnique(board, insight, seen));

  roundShapeInsights(stats).forEach((insight) => addUnique(board, insight, seen));

  board.fixFirst = sortByImpact(board.fixFirst, 'asc');
  board.nextGains = sortByImpact(board.nextGains, 'asc');
  board.keepDoing = sortByImpact(board.keepDoing, 'desc');
  board.gettingBetter = sortByImpact(board.gettingBetter, 'desc');
  board.gettingWorse = sortByImpact(board.gettingWorse, 'asc');
  board.watch = sortByImpact(board.watch, 'asc');
  return board;
}

function pickHero(board) {
  const strongLeak = board.fixFirst.find((insight) => insight.confidence === 'high')
    || board.fixFirst[0];
  if (strongLeak) return strongLeak;
  return board.gettingBetter[0] || board.keepDoing[0] || board.nextGains[0] || board.watch[0] || null;
}

function practiceTitle(prefix, insight) {
  return insight ? `${prefix}: ${insight.title}` : prefix;
}

function practiceReason(insight, fallback) {
  return insight?.reason || fallback;
}

function buildPracticePlan(board) {
  const first = board.fixFirst[0] || board.nextGains[0] || board.gettingWorse[0] || null;
  const primaryFixes = board.fixFirst.filter((insight) => (insight.priority ?? 0) === 0);
  const benchmarkFixes = board.fixFirst.filter((insight) => (insight.priority ?? 0) > 0);
  const secondary = [
    ...board.nextGains,
    ...board.gettingWorse,
    ...primaryFixes,
    ...board.keepDoing,
    ...benchmarkFixes,
    ...board.watch,
    ...board.gettingBetter,
  ].find((insight) => insight && insight.id !== first?.id && insight.area !== first?.area)
    || board.nextGains.find((insight) => insight.id !== first?.id)
    || null;
  const cue = board.watch.find((insight) => insight.title === 'Closing 3 holes')
    || board.watch.find((insight) => insight.area === 'roundShape')
    || board.watch.find((insight) => insight.id !== first?.id && insight.id !== secondary?.id)
    || board.gettingBetter[0]
    || null;

  return [
    {
      id: 'practice-first',
      role: 'practiceFirst',
      title: practiceTitle('Practice first', first),
      instruction: first
        ? `Spend the first block on ${first.title.toLowerCase()} with a simple make-or-miss target.`
        : 'Log one complete round with scores and shot details.',
      reason: practiceReason(first, 'More complete scoring data will make the next coach view sharper.'),
      ...(first ? { sourceInsightId: first.id } : {}),
    },
    {
      id: 'secondary-focus',
      role: 'secondaryFocus',
      title: practiceTitle('Secondary focus', secondary),
      instruction: secondary
        ? `Use a shorter second block for ${secondary.title.toLowerCase()} so one area does not dominate practice.`
        : 'Review the strongest recent form trend and keep the same pre-shot routine.',
      reason: practiceReason(secondary, 'Balancing practice keeps the plan from overfitting one category.'),
      ...(secondary ? { sourceInsightId: secondary.id } : {}),
    },
    {
      id: 'on-course-cue',
      role: 'onCourseCue',
      title: practiceTitle('On-course cue', cue),
      instruction: cue
        ? `Before those shots, choose the conservative target and commit to the same tempo.`
        : 'Capture fairways, greens, putts, and basic shot outcomes during the next round.',
      reason: practiceReason(cue, 'The selector needs shot data to separate real leaks from noise.'),
      ...(cue ? { sourceInsightId: cue.id } : {}),
    },
  ];
}

export function buildCoachInsights(stats = {}) {
  const board = buildBoard(stats || {});
  return {
    hero: pickHero(board),
    board: {
      ...EMPTY_BOARD,
      ...board,
    },
    practicePlan: buildPracticePlan(board),
  };
}
