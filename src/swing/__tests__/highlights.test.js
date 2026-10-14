import { highlightFor } from '../highlights';

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
