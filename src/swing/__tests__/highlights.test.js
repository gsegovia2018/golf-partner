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

  test('hip drift: the address backside line is the target, drawn at the hip farther from the ball', () => {
    const hips = (lx, rx) => {
      const lm = flat();
      lm[23] = [lx, 0.5, 0.9]; // left hip
      lm[24] = [rx, 0.5, 0.9]; // right hip
      return lm;
    };
    const hctx = { ...ctx, poseAt: (f) => (f === 1 ? hips(0.42, 0.4) : hips(0.38, 0.46)), frameOf: (k) => (k === 'address' ? 1 : 2) };
    const out = highlightFor({ id: 'hip_drift', status: 'red', value: 8, unit: 'cm' }, hctx);
    // right-handed, ball on +x: the right hip (0.40) at address, the left one (0.38) at impact
    expect(out[0]).toMatchObject({ dash: true, role: 'target', a: [0.4, 0.38] });
    expect(out[1].b).toEqual([0.38, 0.5]);
    const lefty = highlightFor({ id: 'hip_drift', status: 'red', value: 8, unit: 'cm' }, { ...hctx, analysis: { ...ctx.analysis, handedness: 'left' } });
    expect(lefty[0].a[0]).toBe(0.42);
    expect(lefty[1].b).toEqual([0.46, 0.5]);
  });

  test('a check with only your own drawing has no target', () => {
    const out = highlightFor({ id: 'knee_flex', status: 'red', value: 40, unit: '°' }, ctx);
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

  test('halfway back: your shaft line to the ground, with the toe and ball ticks', () => {
    const out = highlightFor({ id: 'butt_extension', position: 'leadArm', status: 'red', value: 12, unit: 'cm' }, kctx);
    expect(out.some((p) => p.t === 'dot' && !p.role)).toBe(true);
    expect(out.filter((p) => p.t === 'line' && p.role === 'target' && !p.dash)).toHaveLength(2);
    expect(out.filter((p) => p.t === 'label' && p.role === 'target').map((p) => p.text)).toEqual(['Toes', 'Ball']);
    expect(homeOf({ id: 'butt_extension', position: 'leadArm' })).toBe('leadArm');
  });

  test('through vs halfway: the halfway-back landing is the target dot', () => {
    const out = highlightFor({ id: 'through_vs_halfway', position: 'trailArm', status: 'red', value: 22, unit: 'cm' }, {
      ...kctx, analysis: { ...kctx.analysis, clubMarks: { ...marks, trailArm: { hands: [0.42, 0.45], head: [0.6, 0.35] } } },
    });
    expect(out.some((p) => p.t === 'dot' && p.role === 'target')).toBe(true);
  });

  test('no ground ticks without a shaft line to land on them', () => {
    expect(keyLinesAt('trailArm', kctx).extra).toEqual([]);
  });

  test('the clubhead on plane rows bring the shaft plane and ring the clubhead', () => {
    const down = highlightFor({ id: 'clubhead_plane_down', position: 'shaftDown', status: 'red', value: 12, unit: 'cm' }, kctx);
    expect(down.some((p) => p.t === 'line' && p.role === 'target')).toBe(true);
    expect(down.find((p) => p.t === 'circle')).toMatchObject({ c: [0.5, 0.65] });
    const both = highlightFor({ id: 'down_vs_takeaway', position: 'shaftDown', status: 'red', value: 12, unit: 'cm' }, {
      ...kctx, analysis: { ...kctx.analysis, clubMarks: { ...marks, takeaway: { hands: [0.44, 0.58], head: [0.38, 0.62] } } },
    });
    expect(both.filter((p) => p.t === 'circle').map((p) => p.role ?? 'you')).toEqual(['target', 'you']);
  });

  test('spine and knee holds draw at the position they were read at', () => {
    expect(highlightFor({ id: 'spine_hold', cp: 'top', position: 'top', status: 'red', value: 7, unit: '°' }, kctx).length).toBeGreaterThan(0);
    expect(highlightFor({ id: 'knee_hold', cp: 'takeaway', position: 'takeaway', status: 'red', value: -12, unit: '°' }, kctx).some((p) => p.t === 'poly')).toBe(true);
    expect(highlightFor({ id: 'lead_arm_spine', position: 'top', status: 'red', value: 25, unit: '°' }, kctx).some((p) => p.role === 'target')).toBe(true);
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

describe('references without a clubhead', () => {
  test('the follow-through shaft line still draws the ticks when the clubhead is hidden', () => {
    const out = highlightFor({ id: 'shaft_through_ball', position: 'trailArm', status: 'unknown', value: null, unit: null }, {
      analysis: { handedness: 'right', clubMarks: { trailArm: { hands: [0.42, 0.55], head: null } }, reference: { ball: [0.6, 0.85], handsAddress: [0.45, 0.6], trailShoulder: [0.4, 0.35] } },
      poseAt: () => flat(),
      frameOf: () => 1,
    });
    expect(out.filter((p) => p.t === 'label' && p.role === 'target').map((p) => p.text)).toEqual(['Toes', 'Ball']);
    expect(out.some((p) => p.t === 'dot')).toBe(false);
  });
});
