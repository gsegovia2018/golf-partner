import { highlightFor, keyLinesAt } from '../highlights';
import { homeOf } from '../checkpointChecks';

const flat = () => Array.from({ length: 33 }, (_, i) => [0.3 + (i % 5) * 0.05, 0.2 + (i % 7) * 0.08, 0.9]);
const ctx = {
  analysis: { handedness: 'right', clubMarks: { address: { hands: [0.45, 0.55], head: [0.5, 0.8] } } },
  poseAt: () => flat(),
  frameOf: () => 1,
};

describe('highlightFor roles', () => {
  test('hands under shoulders: the plumb from the shoulders is the target, the reach is you', () => {
    const out = highlightFor({ id: 'hands_under_shoulders', status: 'red', value: 8, unit: 'cm' }, ctx);
    const lines = out.filter((p) => p.t === 'line');
    expect(lines[0]).toMatchObject({ dash: true, role: 'target' });
    expect(lines[1].role).toBeUndefined();
    expect(out.find((p) => p.t === 'label').role).toBeUndefined();
  });

  test('head drift: the address ring is the target', () => {
    const out = highlightFor({ id: 'head_drift', status: 'red', value: 5, unit: 'cm' }, ctx);
    expect(out.find((p) => p.t === 'circle').role).toBe('target');
  });

  test('a check with only your own drawing has no target', () => {
    const out = highlightFor({ id: 'waist_bend', status: 'red', value: 20, unit: '°' }, ctx);
    expect(out.filter((p) => p.role === 'target')).toHaveLength(0);
  });
});

describe('key lines and references', () => {
  const marks = {
    address: { hands: [0.45, 0.6], head: [0.5, 0.85] },
    leadArm: { hands: [0.4, 0.5], head: [0.55, 0.6] },
    shaftDown: { hands: [0.42, 0.55], head: [0.5, 0.65] },
    top: { hands: [0.35, 0.3], head: [0.3, 0.4] },
  };
  const kctx = {
    analysis: {
      handedness: 'right',
      clubMarks: marks,
      reference: { ball: [0.6, 0.85], handsAddress: [0.45, 0.6], trailShoulder: [0.4, 0.35] },
    },
    cp: 'top',
    poseAt: () => flat(),
    frameOf: () => 1,
  };

  test('shaft down shallow brings the original shaft plane and the toe and ball ticks', () => {
    const out = highlightFor({ id: 'shaft_down_shallow', cp: 'shaftDown', status: 'red', value: 12, unit: '°' }, kctx);
    const targets = out.filter((p) => p.role === 'target');
    expect(targets.find((p) => p.t === 'line' && p.dash)).toMatchObject({ a: [0.6, 0.85] });
    expect(targets.filter((p) => p.t === 'line' && !p.dash)).toHaveLength(2);
    expect(out.filter((p) => p.t === 'label' && p.role === 'target').map((p) => p.text)).toEqual(['Toes', 'Ball']);
  });

  test('hands between planes draws both planes and the hands', () => {
    const out = highlightFor({ id: 'hands_between_planes', cp: 'top', status: 'red', value: 3, unit: 'cm' }, kctx);
    expect(out.filter((p) => p.t === 'line' && p.role === 'target')).toHaveLength(2);
    expect(out.some((p) => p.t === 'rect')).toBe(true);
  });

  test('hands between planes: the value shows only at the position it was read at', () => {
    const check = { id: 'hands_between_planes', at: 'top', status: 'red', value: 3, unit: 'cm' };
    expect(highlightFor(check, kctx).some((p) => p.t === 'label')).toBe(true);
    expect(highlightFor(check, { ...kctx, cp: 'leadArm' }).some((p) => p.t === 'label')).toBe(false);
    expect(homeOf(check)).toBe('top');
  });

  test('no ground ticks without a shaft line to land on them', () => {
    expect(keyLinesAt('shaftThrough', kctx).extra).toEqual([]);
  });

  test('clubhead vs plane brings the shaft plane', () => {
    const out = highlightFor({ id: 'clubhead_vs_plane', cp: 'shaftDown', status: 'red', value: 5, unit: 'cm' }, kctx);
    expect(out.some((p) => p.t === 'line' && p.role === 'target')).toBe(true);
  });

  test('keyLinesAt: each position keeps its own lines', () => {
    expect(keyLinesAt('address', kctx)).toEqual({ shaft: true, shoulder: true, extra: [] });
    const top = keyLinesAt('top', kctx);
    expect(top).toMatchObject({ shaft: false, shoulder: true });
    expect(top.extra).toHaveLength(1);
    const sd = keyLinesAt('shaftDown', kctx);
    expect(sd).toMatchObject({ shaft: true, shoulder: false });
    expect(sd.extra.some((p) => p.t === 'dot')).toBe(true);
    expect(keyLinesAt('finish', kctx)).toEqual({ shaft: false, shoulder: false, extra: [] });
  });
});
