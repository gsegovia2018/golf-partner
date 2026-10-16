import { buildWeeklyPlan } from '../coachWeeklyPlan';
import { DRILLS } from '../coachDrills';

const TODAY = '2026-10-16';
const leak = (category, bucket = null, strokesPerRound = -1.2) => ({
  id: bucket ? `leak:${category}:${bucket}` : `leak:${category}`, category, bucket, strokesPerRound, confidence: 'high',
});
const cat = (category, strokesPerRound, confidence = 'high') => ({ category, strokesPerRound, confidence });
const putting = leak('putting', '6+');
const approach = leak('approach', '150-200', -0.8);
const diag = (over = {}) => ({
  leaks: [putting, approach], top: putting, tie: null, candidate: null, insufficient: [],
  categories: [cat('putting', -1.2), cat('approach', -0.8), cat('offTheTee', 0.5), cat('aroundGreen', 0.2), cat('penalties', 0)],
  ...over,
});
const causes = (id = 'cause:putting:lag', strength = 'likely') => ({ primary: { id, strength }, alsoPossible: [] });
const focusRec = (over = {}) => ({
  v: 2, leakId: 'leak:putting:6+', category: 'putting', bucket: '6+', causeId: 'cause:putting:lag', ...over,
});
const base = (over = {}) => ({ diagnosis: diag(), causes: causes(), minutesPerWeek: 60, today: TODAY, ...over });
const total = (p) => p.sessions.reduce((a, s) => a + s.minutes, 0);
const drillsOf = (p) => p.sessions.flatMap((s) => s.drills);

describe('sizing', () => {
  it.each([30, 60, 90, 120])('sessions sum to the %i min budget within 5', (m) => {
    const p = buildWeeklyPlan(base({ minutesPerWeek: m }));
    expect(Math.abs(total(p) - m)).toBeLessThanOrEqual(5);
    expect(p.sessions.length).toBeLessThanOrEqual(4);
    p.sessions.forEach((s) => expect(s.minutes).toBeGreaterThanOrEqual(10));
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.putting.lag');
  });

  it('30 min is one session (the focus block) plus the on-course task', () => {
    const p = buildWeeklyPlan(base({ minutesPerWeek: 30 }));
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0].kind).toBe('putting');
    expect(p.sessions[0].roles).toEqual(['focus']);
    expect(p.courseTask).toBeTruthy();
  });

  it('a block under 10 min folds into the session of its kind, else into the focus session', () => {
    // 60 min: keep block is 6 min (offTheTee keep -> range) and folds into the focus (putting) session
    const p = buildWeeklyPlan(base({ minutesPerWeek: 60 }));
    expect(p.sessions.map((s) => s.kind)).toEqual(['putting', 'range']);
    expect(p.sessions.every((s) => !s.roles.includes('keep'))).toBe(true);
    // second block of the same kind as the focus is 15 min: stays its own block inside one putting session
    const same = buildWeeklyPlan(base({
      diagnosis: diag({ leaks: [putting, leak('putting', '2-3', -0.5)] }),
      minutesPerWeek: 60,
    }));
    // distinct leak id, same category is skipped for the second block -> no second session
    expect(same.sessions.map((s) => s.kind)).toEqual(['putting']);
  });

  it('a second leak of the focus kind merges into the focus session', () => {
    const aroundGreen = leak('aroundGreen', null, -0.7);
    const penalties = leak('penalties', null, -0.6);
    const p = buildWeeklyPlan(base({
      diagnosis: diag({ leaks: [putting, penalties, aroundGreen] }), minutesPerWeek: 90,
    }));
    expect(p.sessions.map((s) => s.kind)).toContain('course');
    expect(new Set(p.sessions.map((s) => s.kind)).size).toBe(p.sessions.length);
  });

  it('nothing renders under 10 min', () => {
    [30, 60, 90, 120].forEach((m) => {
      buildWeeklyPlan(base({ minutesPerWeek: m })).sessions.forEach((s) => expect(s.minutes).toBeGreaterThanOrEqual(10));
    });
  });
});

describe('allocation', () => {
  it('focus block is at least 50 % unless tie; second leak gets its own session', () => {
    const p = buildWeeklyPlan(base({ minutesPerWeek: 120 }));
    expect(p.mode).toBe('focus');
    const focusMin = p.sessions.find((s) => s.roles.includes('focus')).minutes;
    expect(focusMin / total(p)).toBeGreaterThanOrEqual(0.5);
    expect(p.sessions.find((s) => s.roles.includes('second')).kind).toBe('range');
  });

  it('tie splits 45/45 with no committed focus', () => {
    const p = buildWeeklyPlan(base({ diagnosis: diag({ tie: approach }), minutesPerWeek: 90 }));
    expect(p.mode).toBe('tie');
    const a = p.sessions.find((s) => s.roles.includes('tie'));
    const b = p.sessions.find((s) => s.roles.includes('second'));
    expect(Math.abs(a.minutes - b.minutes)).toBeLessThanOrEqual(10);
    expect(a.minutes).toBeGreaterThanOrEqual(35);
    expect(b.minutes).toBeGreaterThanOrEqual(35);
    expect(p.signature.tie).toBe(true);
  });

  it('a committed focus keeps its block even when a tie exists', () => {
    const p = buildWeeklyPlan(base({
      diagnosis: diag({ tie: approach }), focus: focusRec(), verdict: { level: 1, state: 'flat' },
    }));
    expect(p.mode).toBe('focus');
  });

  it('the focus block follows the committed focus, not the ranking', () => {
    const p = buildWeeklyPlan(base({
      focus: focusRec({ leakId: 'leak:approach:150-200', category: 'approach', bucket: '150-200', causeId: 'cause:approach:distance' }),
      verdict: { level: 1, state: 'flat' },
    }));
    expect(p.sessions[0].kind).toBe('range');
    expect(p.sessions[0].why.params.area.key).toBe('stats.my.coach.plan.area.approach');
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.approach.distance');
    expect(p.sessions.find((s) => s.roles.includes('second')).kind).toBe('putting');
  });

  it('every drill comes from the catalogue with a matching pass target', () => {
    drillsOf(buildWeeklyPlan(base({ minutesPerWeek: 90 }))).forEach((d) => {
      const def = DRILLS.find((x) => x.id === d.drillId);
      expect(def).toBeTruthy();
      expect(d.passTarget).toBe(def.levels[d.level - 1].passTarget);
    });
  });

  it('side causes carry the side in the course task', () => {
    const p = buildWeeklyPlan(base({
      diagnosis: diag({ top: leak('offTheTee'), leaks: [leak('offTheTee')] }),
      causes: causes('cause:tee:side:left'),
    }));
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.tee.side');
    expect(p.courseTask.params.side.lower).toBe(true);
  });

  it('asks for more data when the cause is only possible, or a category is insufficient', () => {
    expect(buildWeeklyPlan(base({ causes: causes('cause:putting:lag', 'possible') })).logAsk.key)
      .toBe('stats.my.coach.plan.log.possible');
    const p = buildWeeklyPlan(base({ diagnosis: diag({ insufficient: [{ category: 'approach' }] }) }));
    expect(p.logAsk.key).toBe('stats.my.coach.plan.log.insufficient');
  });
});

describe('swing', () => {
  const link = { state: 'linked', strength: 'consistent', fault: 'over_the_top' };
  const teeDiag = diag({ top: leak('offTheTee'), leaks: [leak('offTheTee')] });

  it('the swing drill joins the range session and replaces the keep block', () => {
    const p = buildWeeklyPlan(base({ diagnosis: teeDiag, causes: causes('cause:tee:side:right'), swingLink: link, minutesPerWeek: 90 }));
    const range = p.sessions.find((s) => s.kind === 'range');
    expect(range.roles).toContain('swing');
    expect(range.drills.some((d) => d.source === 'swing')).toBe(true);
    expect(p.swing.fault).toBe('over_the_top');
    expect(p.sessions.every((s) => !s.roles.includes('keep'))).toBe(true);
  });

  it('creates a range session when the focus is elsewhere; absent when not linked or at 30 min', () => {
    const p = buildWeeklyPlan(base({ swingLink: link }));
    expect(p.sessions.find((s) => s.kind === 'range').drills.some((d) => d.source === 'swing')).toBe(true);
    expect(buildWeeklyPlan(base({ swingLink: { ...link, state: 'stale' } })).swing).toBeNull();
    expect(buildWeeklyPlan(base({ swingLink: link, minutesPerWeek: 30 })).swing).toBeNull();
  });
});

describe('level', () => {
  const lv = (verdict, roundsSinceCommit) => buildWeeklyPlan(base({ focus: focusRec(), verdict, roundsSinceCommit })).level;

  it('comes from the verdict level', () => {
    expect(lv({ level: 3, state: 'flat' }, 0)).toBe(3);
    expect(lv({ level: 2, state: 'worse' }, 9)).toBe(2);
  });

  it('falls back to focusLevel(roundsSinceCommit): 1 / 2 / 3, worse holds it back', () => {
    expect(lv(null, 0)).toBe(1);
    expect(lv(null, 2)).toBe(2);
    expect(lv(null, 5)).toBe(3);
    expect(lv({ state: 'worse' }, 4)).toBe(2);
    expect(lv({ state: 'worse' }, 0)).toBe(1);
  });

  it('is 1 without a focus; drills use the level pass target', () => {
    expect(buildWeeklyPlan(base()).level).toBe(1);
    const p = buildWeeklyPlan(base({ focus: focusRec(), verdict: { level: 3, state: 'improving' } }));
    expect(p.sessions[0].drills[0].level).toBe(3);
    expect(p.readyToMove).toBe(true);
    expect(buildWeeklyPlan(base({ focus: focusRec(), verdict: { level: 2, state: 'improving' } })).readyToMove).toBe(false);
  });
});

describe('collect plan', () => {
  it.each([
    [[], 'noLeak'],
    [[{ category: 'putting' }], 'insufficient'],
  ])('no leak -> one collect session (%j)', (insufficient, reason) => {
    const p = buildWeeklyPlan({
      diagnosis: diag({ leaks: [], top: null, insufficient }), minutesPerWeek: 60, today: TODAY,
    });
    expect(p.mode).toBe('collect');
    expect(p.collectReason).toBe(reason);
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0].why.key).toBe(`stats.my.coach.plan.why.collect.${reason}`);
    expect(p.logAsk.key).toBe('stats.my.coach.plan.log.collect');
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.collect');
    expect(Math.abs(total(p) - 60)).toBeLessThanOrEqual(5);
  });

  it('survives an empty input', () => {
    expect(buildWeeklyPlan().mode).toBe('collect');
  });
});

describe('re-plan', () => {
  const lastRound = { course: 'El Prat', date: '2026-10-15' };
  const first = buildWeeklyPlan(base());

  it('is null when nothing changed, or there is no previous plan', () => {
    expect(buildWeeklyPlan(base({ previousPlan: first, lastRound })).replan).toBeNull();
    expect(first.replan).toBeNull();
  });

  it('names what changed: the top leak', () => {
    const next = buildWeeklyPlan(base({
      diagnosis: diag({ top: approach, leaks: [approach, putting] }), causes: causes('cause:approach:short'),
      previousPlan: first, lastRound,
    }));
    expect(next.replan.note.key).toBe('stats.my.coach.plan.replanned');
    expect(next.replan.note.params).toMatchObject({ course: 'El Prat', date: '2026-10-15' });
    expect(next.replan.changes[0]).toMatchObject({ key: 'stats.my.coach.plan.changed.topLeak' });
  });

  it('level step, tie start and swing change are each reported; several nest with "and"', () => {
    const f = buildWeeklyPlan(base({ focus: focusRec(), verdict: { level: 1, state: 'flat' } }));
    const next = buildWeeklyPlan(base({
      focus: focusRec(), verdict: { level: 2, state: 'improving' },
      swingLink: { state: 'linked', fault: 'over_the_top' }, previousPlan: f.signature, lastRound,
    }));
    const keys = next.replan.changes.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining([
      'stats.my.coach.plan.changed.level', 'stats.my.coach.plan.changed.swingAdded',
    ]));
    expect(next.replan.note.params.what.key).toBe('stats.my.coach.plan.changed.and');
    const tie = buildWeeklyPlan(base({ diagnosis: diag({ tie: approach }), previousPlan: first, lastRound }));
    expect(tie.replan.changes.map((c) => c.key)).toContain('stats.my.coach.plan.changed.tieStarted');
  });

  it('collect to leak and back', () => {
    const empty = buildWeeklyPlan({ diagnosis: diag({ leaks: [], top: null }), minutesPerWeek: 60 });
    expect(buildWeeklyPlan(base({ previousPlan: empty, lastRound })).replan.changes[0].key)
      .toBe('stats.my.coach.plan.changed.leakFound');
    expect(buildWeeklyPlan({ diagnosis: diag({ leaks: [], top: null }), previousPlan: first, lastRound }).replan.changes[0].key)
      .toBe('stats.my.coach.plan.changed.collect');
  });

  it('minutes alone do not count as a re-plan', () => {
    expect(buildWeeklyPlan(base({ minutesPerWeek: 90, previousPlan: first, lastRound })).replan).toBeNull();
  });
});

describe('determinism', () => {
  it('same inputs give identical output', () => {
    const input = base({ minutesPerWeek: 90, diagnosis: diag({ tie: approach }), swingLink: { state: 'linked', fault: 'over_the_top' } });
    expect(buildWeeklyPlan(input)).toEqual(buildWeeklyPlan(JSON.parse(JSON.stringify(input))));
    expect(buildWeeklyPlan(input)).toEqual(buildWeeklyPlan({ ...input, today: '2030-01-01' }));
  });
});
