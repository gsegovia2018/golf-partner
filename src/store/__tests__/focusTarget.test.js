import { focusTarget } from '../focusTarget';
import { issueMsg } from '../coachCausePair';
import { courseTaskFor } from '../coachWeeklyPlan';

const rec = (over) => ({
  v: 2, leakId: 'leak:approach:100-150', category: 'approach', bucket: '100-150', causeId: null, ...over,
});

describe('focusTarget', () => {
  test.each([
    ['approach', 'cause:approach:why:swing:start:left', 'approach', 'swing'],
    ['approach', 'cause:approach:why:swing:lowPoint', 'approach', 'swing'],
    ['offTheTee', 'cause:tee:why:swing:curve:right', 'drive', 'swing'],
    ['aroundGreen', 'cause:short:why:swing:lowPoint', 'short', 'swing'],
    ['approach', 'cause:approach:why:decision', 'approach', 'decision'],
    ['offTheTee', 'cause:tee:why:decision', 'drive', 'decision'],
    ['aroundGreen', 'cause:short:why:decision', 'short', 'decision'],
  ])('%s %s → %s %s', (category, causeId, shot, kind) => {
    expect(focusTarget(rec({ category, causeId }))).toMatchObject({ shot, kind, lie: null });
  });

  test('approach lie cause with focusLie → lie; without → outcome', () => {
    const base = rec({ causeId: 'cause:approach:why:lie' });
    expect(focusTarget({ ...base, focusLie: 'uphill' })).toMatchObject({ shot: 'approach', kind: 'lie', lie: 'uphill' });
    expect(focusTarget(base)).toMatchObject({ shot: 'approach', kind: 'outcome', lie: null });
  });

  test('tee and short lie causes are outcome, even with focusLie', () => {
    expect(focusTarget(rec({ category: 'offTheTee', causeId: 'cause:tee:why:lie', focusLie: 'wind' })))
      .toMatchObject({ shot: 'drive', kind: 'outcome', lie: null });
    expect(focusTarget(rec({ category: 'aroundGreen', causeId: 'cause:short:why:lie', focusLie: 'bad-lie' })))
      .toMatchObject({ shot: 'short', kind: 'outcome', lie: null });
  });

  test.each([
    ['approach', 'approach'], ['offTheTee', 'drive'], ['aroundGreen', 'short'], ['putting', 'putt'], ['penalties', 'drive'],
  ])('outcome category %s → %s', (category, shot) => {
    expect(focusTarget(rec({ category, causeId: null }))).toMatchObject({ shot, kind: 'outcome' });
    expect(focusTarget(rec({ category, causeId: 'cause:putting:lag' }))).toMatchObject({ shot, kind: 'outcome' });
  });

  test('title is the issue key for a cause and the kicker without; cue is the course task', () => {
    const withCause = rec({ causeId: 'cause:approach:why:decision' });
    const t = focusTarget(withCause);
    expect(t.title).toEqual(issueMsg({ category: 'approach', bucket: '100-150' }, { id: 'cause:approach:why:decision' }));
    expect(t.title.key).toBe('stats.my.coach.ui.issue.approach.why.decision');
    expect(t.cue).toEqual(courseTaskFor({ causeId: 'cause:approach:why:decision', category: 'approach', bucket: '100-150' }));
    const bare = focusTarget(rec({}));
    expect(bare.title).toEqual(issueMsg({ category: 'approach', bucket: '100-150' }, null));
    expect(bare.title.key).toBe('stats.my.coach.ui.kicker.bucket');
    expect(bare.cue.key).toBe('stats.my.coach.plan.course.area.approach');
    expect(bare.bucket).toBe('100-150');
  });

  test('null for a v1 record, a null focus and an unknown category', () => {
    expect(focusTarget({ insightId: 'x', area: 'putting' })).toBeNull();
    expect(focusTarget(null)).toBeNull();
    expect(focusTarget(rec({ category: 'mystery' }))).toBeNull();
  });
});
