// Coach v2: everything the Coach tab shows that is derived from the stats plus
// the things only the screen knows (focus, swings, minutes, the latest round).
// Pure except the plan-memory storage helpers at the bottom. The screen
// memoises buildCoachWeek and the tab only composes (spec §6, §12).
//
// buildCoachWeek({ stats, focus, verdict, swings, profile, minutesPerWeek,
//                  previousPlan, lastRound, today }) → null | {
//   kind     'one' | 'tie' | 'focus' (a committed focus's chain) | 'few'
//            (leaks under the sample gates) | 'candidate' | 'noLeak' | 'noDetail'
//   chains   [Chain] (two on a tie): { leak, causes, swingLink, check, drills, courseTask,
//            isFocus, coverage }; coverage is { tagged, needed } while an approach / off-the-tee
//            leak has fewer pooled tagged miss reasons than the why causes need, else null; drills are the plan's drills for that chain's blocks
//   plan     buildWeeklyPlan(...) result
//   untracked  { residual, gap } when the strokes no category explains outweigh the
//            first chain's leak (see coachDiagnosis untrackedDominant), else null
//   swingLink  the first chain's link (or the swing-only link when there is no chain)
//   pills    { [insightId]: { kind, minutes } } for the board's "this week" pill
// }

import { buildSwingLink } from './coachSwingLink';
import { buildWeeklyPlan, courseTaskFor } from './coachWeeklyPlan';
import { causesForLeak, CAUSE_MIN } from './coachCauses';
import { buildCheck } from './coachCheck';
import { isV2Focus } from './coachFocus';
import { untrackedDominant } from './coachDiagnosis';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PLAN_PREFIX = '@mystats_coach_plan:';

// Miss reasons tagged so far (all approaches pooled, or the drives) against the
// floor the why causes need; null once met, for other areas, or without the stats.
function coverageFor(leak, stats) {
  const mr = stats?.missReasons;
  const row = leak?.category === 'approach' ? mr?.approach?.all : leak?.category === 'offTheTee' ? mr?.tee : null;
  if (!row) return null;
  const tagged = row.tagged ?? 0;
  return tagged < CAUSE_MIN.whyTagged ? { tagged, needed: CAUSE_MIN.whyTagged } : null;
}

const causesOf = (leak, stats) => leak?.causes ?? (leak ? causesForLeak(leak, stats) : null);

export function buildCoachWeek({
  stats, focus, verdict, swings, profile, minutesPerWeek, previousPlan, lastRound, today,
} = {}) {
  const diagnosis = stats?.coachDiagnosis ?? null;
  if (!diagnosis) return null;
  const committed = isV2Focus(focus) ? focus : null;
  const leaks = diagnosis.leaks ?? [];
  const categories = diagnosis.categories ?? [];

  // The focus's own category stays the chain even after it drops below the leak floor.
  const focusLeak = committed ? categories.find((c) => c.category === committed.category) ?? null : null;
  const primary = focusLeak ?? diagnosis.top ?? null;
  const tieLeak = !committed && diagnosis.top && diagnosis.tie ? diagnosis.tie : null;
  const secondLeak = tieLeak
    ?? leaks.find((l) => primary && l.category !== primary.category)
    ?? null;

  const causes = causesOf(primary, stats);
  const secondCauses = causesOf(secondLeak, stats);
  const swingLink = buildSwingLink({ causes: causes ?? undefined, swings, profile, today });
  const plan = buildWeeklyPlan({
    diagnosis, causes, secondCauses, focus: committed, verdict, swingLink, minutesPerWeek,
    roundsSinceCommit: verdict?.roundsSince, previousPlan, lastRound, today,
  });

  const drillsFor = (roles) => plan.sessions.flatMap((s) => s.drills
    .filter((d) => roles.includes(d.role))
    .map((d) => ({ ...d, kind: s.kind })));
  const chain = (leak, cs, roles, link, isFocus, courseTask) => ({
    leak,
    causes: cs,
    swingLink: link,
    isFocus,
    check: buildCheck({ leak, cause: cs?.primary, focus: isFocus ? committed : null, stats }),
    drills: drillsFor(roles),
    courseTask,
    coverage: coverageFor(leak, stats),
  });

  const chains = [];
  let kind;
  if (primary) {
    kind = committed ? 'focus' : tieLeak ? 'tie' : 'one';
    chains.push(chain(primary, causes, tieLeak ? ['tie', 'focus', 'swing'] : ['focus', 'swing'], swingLink, !!committed, plan.courseTask));
    if (tieLeak) {
      const causeId = secondCauses?.primary?.id ?? null;
      chains.push(chain(tieLeak, secondCauses, ['second'], null, false,
        courseTaskFor({ causeId, category: tieLeak.category, bucket: tieLeak.bucket })));
    }
  } else if ((diagnosis.insufficient ?? []).length) kind = 'few';
  else if (diagnosis.candidate) kind = 'candidate';
  else if (categories.some((c) => c.confidence !== 'insufficient')) kind = 'noLeak';
  else kind = 'noDetail';

  return {
    kind,
    chains,
    plan,
    untracked: untrackedDominant(stats, primary),
    swingLink,
    pills: weekPills(plan, stats?.coach?.board),
  };
}

// The board's "this week" pill: which plan session an insight's category got,
// and how many minutes of drills it has there. Leak rows follow the focus and
// second blocks; strength rows follow the keep block.
export function weekPills(plan, board) {
  const sig = plan?.signature;
  if (!sig || sig.collect) return {};
  const roleOf = (insight) => {
    const id = String(insight.id ?? '');
    const category = insight.category ?? id.split(':')[1];
    if (id.startsWith('leak:')) {
      if (category === sig.focusCategory) return ['focus', 'tie'];
      if (category === sig.secondCategory) return ['second'];
    } else if (id.startsWith('strength:') && category === sig.keepCategory) return ['keep'];
    return null;
  };
  const pills = {};
  Object.values(board ?? {}).flat().forEach((insight) => {
    if (!insight?.id) return;
    const roles = roleOf(insight);
    if (!roles) return;
    const hits = plan.sessions.flatMap((s) => s.drills.filter((d) => roles.includes(d.role)).map((d) => ({ ...d, kind: s.kind })));
    if (!hits.length) return;
    pills[insight.id] = { kind: hits[0].kind, minutes: hits.reduce((a, d) => a + d.minutes, 0) };
  });
  return pills;
}

// ── Plan memory: how "re-planned after your round" is detected ───────────────
// { round, base, last }: `last` is the newest plan signature seen, `base` the
// one from before the latest round (what the next build compares against).
// A new latest round promotes `last` to `base`; committing a different focus
// inside the same round resets the base, because that change is the player's,
// not the round's.

export const previousPlanFor = (memory, roundKey) => {
  if (!memory || roundKey == null) return null;
  return memory.round === roundKey ? memory.base ?? null : memory.last ?? null;
};

export function advancePlanMemory(memory, roundKey, signature) {
  if (roundKey == null || !signature) return memory ?? null;
  let next;
  if (!memory) next = { round: roundKey, base: null, last: signature };
  else if (memory.round !== roundKey) next = { round: roundKey, base: memory.last ?? null, last: signature };
  else if ((memory.last?.focusLeakId ?? null) !== signature.focusLeakId) next = { round: roundKey, base: signature, last: signature };
  else next = { ...memory, last: signature };
  return JSON.stringify(next) === JSON.stringify(memory) ? memory : next;
}

const planKey = (userId) => `${PLAN_PREFIX}${userId ?? 'anon'}`;

export async function loadPlanMemory(userId) {
  try {
    const raw = await AsyncStorage.getItem(planKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && 'round' in parsed ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function savePlanMemory(userId, memory) {
  return AsyncStorage.setItem(planKey(userId), JSON.stringify(memory));
}
