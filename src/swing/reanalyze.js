// Re-run analyze() for a stored swing with another club (D19). No native call: the stored
// pose.json (with its pass-2 clubhead seeds), probe.json and marks.json are all it needs, and
// the club only changes which THRESHOLDS column the checks read. Pure.

import { analyze } from './analyze';
import { marksForAnalyze } from './labels';

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
    handedness: analysis.handedness,
    heightCm: analysis.scale?.approx ? undefined : analysis.scale?.heightCm,
    club,
    source: analysis.source,
    swingId: analysis.swingId,
    createdAt: analysis.createdAt,
  });
}
