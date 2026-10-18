import { buildWeeklyPlan, courseTaskFor } from '../coachWeeklyPlan';
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
  it.each([30, 60, 90, 120])('sessions never exceed the %i min budget', (m) => {
    [base({ minutesPerWeek: m }), base({ minutesPerWeek: m, diagnosis: diag({ leaks: [putting] }) })].forEach((input) => {
      const p = buildWeeklyPlan(input);
      expect(total(p)).toBeLessThanOrEqual(m);
      expect(total(p)).toBeGreaterThan(m - 25);
    });
    const p = buildWeeklyPlan(base({ minutesPerWeek: m }));
    p.sessions.forEach((s) => expect(s.minutes).toBeGreaterThanOrEqual(10));
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.putting.lag');
  });

  it('a session is at most 45 min: a bigger block splits into numbered sessions of the same kind', () => {
    const single = diag({ leaks: [putting] });
    [60, 90, 120].forEach((m) => {
      const p = buildWeeklyPlan(base({ minutesPerWeek: m, diagnosis: single }));
      p.sessions.forEach((s) => expect(s.minutes).toBeLessThanOrEqual(45));
      expect(total(p)).toBeLessThanOrEqual(m);
    });
    const p = buildWeeklyPlan(base({ minutesPerWeek: 120, diagnosis: single }));
    const putts = p.sessions.filter((s) => s.kind === 'putting');
    expect(putts.length).toBeGreaterThan(1);
    expect(putts.map((s) => s.part)).toEqual(putts.map((_, i) => i + 1));
    putts.forEach((s) => expect(s.parts).toBe(putts.length));
    expect(new Set(p.sessions.map((s) => s.id)).size).toBe(p.sessions.length);
    expect(buildWeeklyPlan(base({ minutesPerWeek: 30 })).sessions[0]).toMatchObject({ part: 1, parts: 1 });
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
    expect(new Set(same.sessions.map((s) => s.kind))).toEqual(new Set(['putting']));
  });

  it('a second leak of the focus kind merges into the focus session', () => {
    const aroundGreen = leak('aroundGreen', null, -0.7);
    const penalties = leak('penalties', null, -0.6);
    const p = buildWeeklyPlan(base({
      diagnosis: diag({ leaks: [putting, penalties, aroundGreen] }), minutesPerWeek: 90,
    }));
    expect(p.sessions.map((s) => s.kind)).toContain('course');
    expect(p.sessions.every((s) => s.minutes <= 45)).toBe(true);
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
    const focusMin = drillsOf(p).filter((d) => d.role === 'focus').reduce((a, d) => a + d.minutes, 0);
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

  const WHY_COURSE = [
    ['cause:approach:why:swing:start:right', 'approach.why.swing.start', 'right'],
    ['cause:approach:why:swing:curve:left', 'approach.why.swing.curve', 'left'],
    ['cause:approach:why:swing:strike:right', 'approach.why.swing.strike', 'right'],
    ['cause:approach:why:swing:lowPoint', 'approach.why.swing.lowPoint', null],
    ['cause:approach:why:lie', 'approach.why.lie', null],
    ['cause:approach:why:decision', 'approach.why.decision', null],
    ['cause:tee:why:swing:start:left', 'tee.why.swing.start', 'left'],
    ['cause:tee:why:swing:curve:right', 'tee.why.swing.curve', 'right'],
    ['cause:tee:why:swing:strike:left', 'tee.why.swing.strike', 'left'],
    ['cause:tee:why:swing:lowPoint', 'tee.why.swing.lowPoint', null],
    ['cause:tee:why:lie', 'tee.why.lie', null],
    ['cause:tee:why:decision', 'tee.why.decision', null],
    ['cause:short:why:swing:lowPoint', 'short.why.swing.lowPoint', null],
    ['cause:short:why:lie', 'short.why.lie', null],
    ['cause:short:why:decision', 'short.why.decision', null],
  ];

  it.each(WHY_COURSE)('why cause %s has its own course task', (causeId, key, side) => {
    const t = courseTaskFor({ causeId, category: 'approach', bucket: '100-150' });
    expect(t.key).toBe(`stats.my.coach.plan.course.${key}`);
    if (side) expect(t.params.side).toMatchObject({ key: `stats.my.fan.${side}`, lower: true });
    else expect(t.params).not.toHaveProperty('side');
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
    const ranges = p.sessions.filter((s) => s.kind === 'range');
    expect(ranges.flatMap((s) => s.roles)).toContain('swing');
    expect(drillsOf(p).some((d) => d.source === 'swing')).toBe(true);
    expect(total(p)).toBeLessThanOrEqual(90);
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
    expect(p.sessions[0].why.key).toBe(`stats.my.coach.plan.why.collect.${reason}`);
    expect(p.logAsk.key).toBe('stats.my.coach.plan.log.collect');
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.collect');
    expect(total(p)).toBeLessThanOrEqual(60);
    p.sessions.forEach((s) => expect(s.minutes).toBeLessThanOrEqual(45));
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
    expect(next.replan.note.params.what.params.b.lower).toBe(true);
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

describe('strategy-only causes (lie, decision) get no drill minutes', () => {
  const apprLeak = leak('approach', null, -1.4);
  const lieDiag = diag({ leaks: [apprLeak, putting], top: apprLeak });
  const byId = Object.fromEntries(DRILLS.map((d) => [d.id, d]));
  const lieInput = (id, over = {}) => base({
    diagnosis: lieDiag, causes: causes(id), secondCauses: causes('cause:putting:lag'), ...over,
  });

  it.each([
    'cause:approach:why:lie', 'cause:approach:why:decision',
    'cause:tee:why:lie', 'cause:tee:why:decision',
    'cause:short:why:lie', 'cause:short:why:decision',
  ])('%s as focus: no area drills, the minutes go to the next block', (id) => {
    const p = buildWeeklyPlan(lieInput(id));
    const drills = drillsOf(p);
    expect(drills.some((d) => d.role === 'focus')).toBe(false);
    expect(drills.some((d) => ['approach', 'offTheTee', 'shortGame'].includes(byId[d.drillId]?.area))).toBe(false);
    // the second block (putting) inherits the focus block's 55 %: more than its own 25 %
    const second = drills.filter((d) => d.role === 'second').reduce((a, d) => a + d.minutes, 0);
    expect(second).toBeGreaterThan(15);
    expect(total(p)).toBeLessThanOrEqual(60);
  });

  it('the course task still names the cause', () => {
    expect(buildWeeklyPlan(lieInput('cause:approach:why:lie')).courseTask.key)
      .toBe('stats.my.coach.plan.course.approach.why.lie');
    expect(buildWeeklyPlan(lieInput('cause:tee:why:decision')).courseTask.key)
      .toBe('stats.my.coach.plan.course.tee.why.decision');
  });

  it('with no other block the plan has no drills for it, only the course task', () => {
    const p = buildWeeklyPlan(lieInput('cause:approach:why:lie', {
      diagnosis: diag({ leaks: [apprLeak], top: apprLeak, categories: [cat('approach', -1.4)] }),
      secondCauses: undefined, minutesPerWeek: 30,
    }));
    expect(p.sessions).toEqual([]);
    expect(p.courseTask.key).toBe('stats.my.coach.plan.course.approach.why.lie');
    expect(p.signature.causeId).toBe('cause:approach:why:lie');
  });

  it('a strategy-only second leak gives its minutes to the focus block', () => {
    const p = buildWeeklyPlan(base({ minutesPerWeek: 60, secondCauses: causes('cause:approach:why:lie') }));
    expect(drillsOf(p).some((d) => d.role === 'second')).toBe(false);
    expect(drillsOf(p).filter((d) => d.role === 'focus').length).toBeGreaterThan(0);
  });

  it('a swing why cause still gets its drill', () => {
    const p = buildWeeklyPlan(lieInput('cause:approach:why:swing:curve:right'));
    expect(drillsOf(p).filter((d) => d.role === 'focus')[0].drillId).toBe('appr-path-gate');
  });
});
