import { metricLabel, buildCheck } from '../coachCheck';
import { METRICS } from '../coachMetrics';
import en from '../../i18n/locales/en';
import es from '../../i18n/locales/es';

const WHY_KEYS = Object.keys(METRICS).filter((k) => k.includes('.why.'));

describe('metricLabel: why metrics', () => {
  test('there are why metrics to label', () => {
    expect(WHY_KEYS.length).toBeGreaterThan(40);
  });

  test.each(WHY_KEYS)('%s has a label whose keys exist in en and es', (key) => {
    const label = metricLabel(key);
    expect(label).toBeTruthy();
    const keys = [];
    const walk = (d) => {
      keys.push(d.key);
      Object.values(d.params ?? {}).forEach((v) => { if (v && typeof v === 'object' && v.key) walk(v); });
    };
    walk(label);
    keys.forEach((k) => {
      expect([k, typeof en[k]]).toEqual([k, 'string']);
      expect([k, typeof es[k]]).toEqual([k, 'string']);
    });
  });

  test('side, bucket and scope reach the descriptor', () => {
    const l = metricLabel('approach.why.swing.start.rightRate.100-150');
    expect(l.params.side.key).toBe('stats.my.fan.right');
    expect(l.params.shot.params).toEqual({ bucket: '100-150' });
    expect(metricLabel('approach.why.lieRate.all').params.shot.key).toBe('stats.my.coach.ui.metric.why.shot.approachAll');
    expect(metricLabel('tee.why.swing.lowPointRate').params.shot.key).toBe('stats.my.coach.ui.metric.why.shot.tee');
    expect(metricLabel('short.why.decisionRate').params.shot.key).toBe('stats.my.coach.ui.metric.why.shot.short');
  });

  test('existing labels are untouched', () => {
    expect(metricLabel('approach.leftRate.100-150').key).toBe('stats.my.coach.ui.metric.approachSide');
    expect(metricLabel('short.upDownRate.sand').key).toBe('stats.my.coach.ui.metric.upDownSand');
    expect(metricLabel('tee.missSideShare.left').key).toBe('stats.my.coach.ui.metric.teeMissSide');
  });
});

describe('buildCheck: why metrics', () => {
  const row = {
    misses: 12, tagged: 8, untagged: 4, blocked: 0,
    families: { forced: 0, lie: 1, decision: 1, swing: 6 },
    subs: { start: { left: 0, right: 6 }, curve: { left: 0, right: 0 }, strike: { left: 0, right: 0 }, lowPoint: 0 },
  };
  const stats = { targetHandicap: 12, missReasons: { approach: { byBucket: {}, all: row }, tee: row, short: row } };

  test('reads the cause metric from stats.missReasons with no benchmark', () => {
    const check = buildCheck({
      leak: { benchmark: { targetHandicap: 12 } },
      cause: { metricKey: 'approach.why.swing.start.rightRate.all' },
      stats,
    });
    expect(check).toMatchObject({
      metricKey: 'approach.why.swing.start.rightRate.all', value: 75, sample: { shots: 8 }, benchmark: null, unit: 'percent', polarity: 'lower',
    });
  });
});
