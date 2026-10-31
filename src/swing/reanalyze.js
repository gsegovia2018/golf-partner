// Re-run analyze() for a stored swing with another club (D19), or to bring an older analysis to
// the current schema (swing checks v2, spec §7). No native call: the stored pose.json (with its
// pass-2 clubhead seeds), probe.json and marks.json are all it needs, and the club only changes
// which THRESHOLDS column the checks read. Pure.

import { analyze, SCHEMA } from './analyze';
import { marksForAnalyze, viewOverrideOf } from './labels';

/**
 * @param {{pose:object, probe:object|null, marks:object|null, analysis:object}} stored
 * @param {'iron'|'driver'} club
 * @returns {object} the new analysis, or `{ error }` as analyze() reports it
 */
export function reanalyzeForClub({
  pose, probe, marks, analysis,
}, club) {
  return analyze(pose, {
    pass2: pose.pass2 ?? {},
    probe: probe ?? {},
    marks: marksForAnalyze(marks),
    ball: marks?.ball?.final ?? undefined,
    view: viewOverrideOf(marks),
    handedness: analysis.handedness,
    heightCm: analysis.scale?.approx ? undefined : analysis.scale?.heightCm,
    club,
    source: analysis.source,
    swingId: analysis.swingId,
    createdAt: analysis.createdAt,
  });
}

/**
 * A stored analysis at the current SCHEMA: an older one is re-run with its own club. Returns
 * `{ analysis, upgraded }`; a re-run that cannot run (no pose) or fails keeps the stored analysis
 * and names the reason in `error`.
 */
export function upgradeAnalysis({
  pose, probe, marks, analysis,
}) {
  if (!analysis || analysis.error || analysis.schema === SCHEMA) return { analysis, upgraded: false };
  if (!pose) return { analysis, upgraded: false, error: 'no_pose' };
  try {
    const next = reanalyzeForClub({
      pose, probe, marks, analysis,
    }, analysis.club);
    if (next.error) return { analysis, upgraded: false, error: next.error };
    return { analysis: next, upgraded: true };
  } catch (e) {
    return { analysis, upgraded: false, error: e?.message ?? 'failed' };
  }
}
