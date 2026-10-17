import { buildCoachWeek, weekPills, previousPlanFor, advancePlanMemory } from '../coachWeek';
import { buildCheck, metricLabel } from '../coachCheck';
import {
  onePutting, tieStats, teeLeft, fewRounds, noDetail, approachShort, week, driverSwing, focusRecord, verdictOf,
  mkLeak, mkDiagnosis, mkStats,
} from '../../components/mystats/__tests__/coachFixtures';

describe('buildCoachWeek: which state the tab is in', () => {
  it('no coachDiagnosis (baseline-only stats) is null', () => {
    expect(buildCoachWeek({ stats: { roundCount: 3 } })).toBeNull();
    expect(buildCoachWeek({})).toBeNull();
  });

  it('one clear leak: one chain with drills, task and a check', () => {
    const w = week(onePutting());
    expect(w.kind).toBe('one');
    expect(w.chains).toHaveLength(1);
    const [c] = w.chains;
    expect(c.leak.id).toBe('leak:putting:6+');
    expect(c.drills.length).toBeGreaterThan(0);
    expect(c.drills.every((d) => ['focus', 'swing'].includes(d.role))).toBe(true);
    expect(c.courseTask.key).toBe('stats.my.coach.plan.course.putting.lag');
    expect(c.check.metricKey).toBe('putting.threePuttRate.6+');
    expect(w.plan.mode).toBe('focus');
  });

  it('strategy tips stay in Play smarter: the chain carries none', () => {
    const w = week(onePutting());
    expect(w.chains[0].tip).toBeUndefined();
    expect(w.shownTipIds).toBeUndefined();
  });

  it('a tie gives two chains, each with its own blocks, and a 45/45 plan', () => {
    const w = week(tieStats());
    expect(w.kind).toBe('tie');
    expect(w.chains.map((c) => c.leak.category)).toEqual(['approach', 'offTheTee']);
    expect(w.plan.mode).toBe('tie');
    expect(w.chains[0].drills.every((d) => d.role === 'tie')).toBe(true);
    expect(w.chains[1].drills.every((d) => d.role === 'second')).toBe(true);
    expect(w.chains[1].courseTask.key).toBe('stats.my.coach.plan.course.tee.side');
  });

  it('a committed focus keeps its category as the chain and ignores the tie', () => {
    const stats = tieStats();
    const focus = focusRecord({ leakId: 'leak:offTheTee', category: 'offTheTee', bucket: null, causeId: 'cause:tee:side:left', metricKey: 'tee.missSideShare.left' });
    const w = week(stats, { focus, verdict: verdictOf({ metricKey: 'tee.missSideShare.left' }) });
    expect(w.kind).toBe('focus');
    expect(w.chains).toHaveLength(1);
    expect(w.chains[0].leak.category).toBe('offTheTee');
    expect(w.chains[0].isFocus).toBe(true);
    expect(w.chains[0].check.metricKey).toBe('tee.missSideShare.left');
    expect(w.chains[0].check.baseline).toBe(71);
  });

  it('few rounds, no shot detail, candidate and no leak are their own kinds', () => {
    expect(week(fewRounds()).kind).toBe('few');
    expect(week(noDetail()).kind).toBe('noDetail');
    expect(week(mkStats(mkDiagnosis({ candidate: mkLeak('putting', null, -0.3) }))).kind).toBe('candidate');
    expect(week(mkStats(mkDiagnosis())).kind).toBe('noLeak');
    expect(week(fewRounds()).plan.mode).toBe('collect');
  });

  it('the swing link follows the chain leak', () => {
    expect(week(teeLeft(), { swings: [driverSwing()] }).swingLink.state).toBe('linked');
    expect(week(teeLeft(), { swings: [] }).swingLink.state).toBe('none');
    expect(week(onePutting(), { swings: [] }).swingLink.state).toBe('notSwing');
  });

  it('the plan follows the minutes setting', () => {
    expect(week(onePutting(), { minutesPerWeek: 120 }).plan.minutes).toBe(120);
  });
});

describe('weekPills', () => {
  const board = {
    fixFirst: [{ id: 'leak:putting:6+', category: 'putting' }],
    nextGains: [{ id: 'leak:approach:150-200', category: 'approach' }],
    keepDoing: [{ id: 'strength:offTheTee', area: 'offTheTee' }],
    watch: [{ id: 'round-shape:closing', area: 'roundShape' }],
  };

  it('gives the focus and second leak their session and minutes', () => {
    const w = week(onePutting(), { minutesPerWeek: 120 });
    const pills = weekPills(w.plan, board);
    expect(pills['leak:putting:6+']).toEqual({ kind: 'putting', minutes: expect.any(Number) });
    expect(pills['leak:approach:150-200'].kind).toBe('range');
    expect(pills['round-shape:closing']).toBeUndefined();
  });

  it('a collect plan has no pills', () => {
    expect(weekPills(week(fewRounds()).plan, board)).toEqual({});
  });
});

describe('plan memory (re-plan note)', () => {
  const sigA = { focusLeakId: 'leak:putting:6+', focusCategory: 'putting', level: 1 };
  const sigB = { focusLeakId: 'leak:approach', focusCategory: 'approach', level: 1 };

  it('first sight remembers the plan and compares to nothing', () => {
    const m = advancePlanMemory(undefined, 'r1', sigA);
    expect(m).toEqual({ round: 'r1', base: null, last: sigA });
    expect(previousPlanFor(m, 'r1')).toBeNull();
  });

  it('a new latest round promotes the last plan to the base to compare against', () => {
    const m1 = advancePlanMemory(null, 'r1', sigA);
    const m2 = advancePlanMemory(m1, 'r2', sigB);
    expect(m2).toEqual({ round: 'r2', base: sigA, last: sigB });
    expect(previousPlanFor(m2, 'r2')).toEqual(sigA);
    // reading it again changes nothing
    expect(advancePlanMemory(m2, 'r2', sigB)).toBe(m2);
  });

  it('the same round keeps the base while the plan drifts within it', () => {
    const m = { round: 'r2', base: sigA, last: sigA };
    const next = advancePlanMemory(m, 'r2', { ...sigA, level: 2 });
    expect(next.base).toEqual(sigA);
    expect(next.last.level).toBe(2);
  });

  it('committing a different focus inside a round clears the note: that change is the player\'s', () => {
    const m = { round: 'r2', base: sigA, last: sigA };
    const next = advancePlanMemory(m, 'r2', sigB);
    expect(next.base).toEqual(sigB);
    expect(previousPlanFor(next, 'r2')).toEqual(sigB);
  });

  it('feeds the weekly plan: a changed top leak after a new round produces the note', () => {
    const stats = approachShort();
    const prev = { collect: false, focusLeakId: 'leak:putting:6+', focusCategory: 'putting', causeId: null, secondCategory: null, keepCategory: null, level: 1, tie: false, swingDrillId: null };
    const w = week(stats, { previousPlan: prev, lastRound: { course: 'Alhaurín', date: '2026-10-14' } });
    expect(w.plan.replan.note.key).toBe('stats.my.coach.plan.replanned');
    expect(w.plan.replan.note.params.date).toBe('2026-10-14');
    expect(week(stats).plan.replan).toBeNull();
  });
});

describe('buildCheck', () => {
  it('names the focus metric, reads it now and carries the commit baseline', () => {
    const stats = approachShort();
    const check = buildCheck({ leak: stats.coachDiagnosis.top, focus: focusRecord(), stats });
    expect(check.metricKey).toBe('approach.shortRate.100-150');
    expect(check.value).toBe(71);
    expect(check.baseline).toBe(71);
    expect(check.unit).toBe('percent');
    expect(check.minRounds).toBe(2);
    expect(check.settlesAt).toBe(4);
  });

  it('without a focus: the cause metric, else the leak bucket, else the category', () => {
    const stats = onePutting();
    const top = stats.coachDiagnosis.top;
    expect(buildCheck({ leak: top, cause: top.causes.primary, stats }).metricKey).toBe('putting.threePuttRate.6+');
    expect(buildCheck({ leak: top, stats }).metricKey).toBe('sg.putting.bucket.6+');
    expect(buildCheck({ leak: mkLeak('putting', null, -1), stats }).metricKey).toBe('sg.putting');
  });

  it('a benchmark only where a table has the same metric', () => {
    const stats = onePutting();
    expect(buildCheck({ leak: mkLeak('putting', null, -1), stats }).benchmark).toBe(0);
    expect(buildCheck({ leak: stats.coachDiagnosis.top, cause: stats.coachDiagnosis.top.causes.primary, stats }).benchmark).toBeNull();
    const putts = { ...mkLeak('putting', null, -1), metricKey: 'putting.per18' };
    const withShots = { ...stats, shots: { putts: { per18: 33, holes: 100 } } };
    expect(buildCheck({ leak: putts, stats: withShots }).benchmark).toBeGreaterThan(30);
  });

  it('a metric the registry does not know is null; labels are descriptors', () => {
    expect(buildCheck({ leak: { metricKey: 'nope' }, stats: {} })).toBeNull();
    expect(metricLabel('approach.leftRate.100-150')).toEqual({
      key: 'stats.my.coach.ui.metric.approachSide',
      params: { bucket: '100-150', side: { key: 'stats.my.fan.left', params: undefined, lower: true } },
    });
  });
});
