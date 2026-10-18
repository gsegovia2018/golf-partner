// What the committed coach focus asks of the next round (round focus loop spec
// §2.1, plan §4.1). Pure: no language, no I/O. Titles and cues are descriptors
// the screen renders (statsMsg).
//
// focusTarget(focus) → null | {
//   shot    'approach' | 'drive' | 'short' | 'putt'   which shot the focus is about
//   bucket  focus.bucket (distance bucket) or null
//   kind    'swing' | 'lie' | 'decision' | 'outcome'  how the round asks about it
//   lie     the focus lie for kind 'lie', else null
//   title   descriptor, the issue name (coachCausePair.issueMsg)
//   cue     descriptor, the on-course task (coachWeeklyPlan.courseTaskFor)
// }
// null unless the record is a v2 focus on a known strokes-gained category.
// A lie focus is approach-only and needs the `focusLie` stored at commit; a tee
// or short lie cause, or an approach one without a lie, reads as 'outcome'.
import { isV2Focus } from './coachFocus';
import { SG_CATEGORIES } from './coachMetrics';
import { issueMsg } from './coachCausePair';
import { courseTaskFor } from './coachWeeklyPlan';

const AREA_SHOT = { approach: 'approach', tee: 'drive', short: 'short' };
const CATEGORY_SHOT = {
  approach: 'approach', offTheTee: 'drive', aroundGreen: 'short', putting: 'putt', penalties: 'drive',
};

export function focusTarget(focus) {
  if (!isV2Focus(focus) || !SG_CATEGORIES.includes(focus.category)) return null;
  const { category, causeId = null } = focus;
  const bucket = focus.bucket ?? null;
  const why = /^cause:(approach|tee|short):why:(swing|lie|decision)/.exec(causeId ?? '');
  let shot = CATEGORY_SHOT[category];
  let kind = 'outcome';
  let lie = null;
  if (why) {
    shot = AREA_SHOT[why[1]];
    if (why[2] === 'lie') {
      if (why[1] === 'approach' && focus.focusLie) { kind = 'lie'; lie = focus.focusLie; }
    } else kind = why[2];
  }
  return {
    shot,
    bucket,
    kind,
    lie,
    title: issueMsg({ category, bucket }, causeId ? { id: causeId } : null),
    cue: courseTaskFor({ causeId, category, bucket }),
  };
}
