// Plain-language explainer copy for the My Stats (i) buttons. Each entry feeds
// StatDetailSheet's title / subtitle / explainer props. Keyed by a stable
// string used as `infoKey` on SectionCard / MetricRow / FormMetricBlock.
// The copy lives in the catalogue (stats.explainer.<infoKey>.*); this module
// only maps an infoKey to message descriptors, so it stays language-neutral.
import { tr, formatNumber } from '../../i18n';

export const statExplainerKeys = [
  'recentForm', 'strengths', 'pointsPerRound', 'scoreDifferential', 'strokesVsPar',
  'scoreMix', 'damage', 'steadyHoles', 'recentVsHistory', 'fairwaysHit', 'greensInReg',
  'putts', 'threePutts', 'scoreDistribution', 'parType', 'holeDifficulty', 'roundShape',
  'recovery', 'teeShot', 'driveBuckets', 'approachDistance', 'teeShotImpact',
  'puttingDriving', 'sgScoring', 'sgDriving', 'sgApproach', 'sgPutting', 'sgVsGroup',
  'teeClubAccuracy', 'scramblingByMiss', 'par5', 'coachPractice', 'playSmarter',
  'strokesGained', 'courseMastery', 'careerMilestones', 'courseRecord', 'courseScoreMix',
  'courseHighlights', 'courseShotDetail', 'courseHoleByHole', 'handicapIndex',
];

const KEY_SET = new Set(statExplainerKeys);

// Returns { title, subtitle, explainer } message descriptors ({ key, params }),
// or null for an unknown infoKey. Render each with tr().
export function getStatExplainer(infoKey, { targetHandicap } = {}) {
  if (!KEY_SET.has(infoKey)) return null;
  const base = `stats.explainer.${infoKey}`;
  if (infoKey === 'strokesGained' && targetHandicap != null && targetHandicap !== 0) {
    const params = { handicap: formatNumber(targetHandicap, { maxDecimals: 2 }) };
    return {
      title: { key: `${base}.titleTarget`, params },
      subtitle: { key: `${base}.subtitleTarget`, params },
      explainer: { key: `${base}.explainerTarget`, params },
    };
  }
  return {
    title: { key: `${base}.title` },
    subtitle: { key: `${base}.subtitle` },
    explainer: { key: `${base}.explainer` },
  };
}

// Same as getStatExplainer but rendered to plain strings in the active
// language. Call at render time (never cache the result).
export function resolveStatExplainer(infoKey, opts) {
  const d = getStatExplainer(infoKey, opts);
  if (!d) return null;
  return { title: tr(d.title), subtitle: tr(d.subtitle), explainer: tr(d.explainer) };
}

// Compat: `statExplainers[infoKey]` keeps working until consumers call
// resolveStatExplainer. Entries are lazy getters (resolved at access time);
// strokesGained stays a function of the target handicap, as before.
export const statExplainers = {};
statExplainerKeys.forEach((key) => {
  if (key === 'strokesGained') {
    statExplainers[key] = (targetHandicap) => resolveStatExplainer(key, { targetHandicap });
    return;
  }
  Object.defineProperty(statExplainers, key, {
    enumerable: true,
    get: () => resolveStatExplainer(key),
  });
});
