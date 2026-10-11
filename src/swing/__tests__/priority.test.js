import { mainFault, FAULTS } from '../priority';
import { runChecks } from '../checks';
import { scaleFromWindow } from '../scale';
import { SWING_STRINGS } from '../strings';
import { fixtureSamples, TRUTH } from './helpers';

const row = (id, status, extra = {}) => ({ id, status, ...extra });
const ee = (status) => ({ cluster: 'early_extension', status });

describe('priority: the one main fault', () => {
  test('golden: early extension on the owner marks, not the yellow tempo', () => {
    const { idx, L } = fixtureSamples();
    const scale = scaleFromWindow(idx, L, [328, 338], 'right', 176);
    const cps = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
      frame: c.frame, hands: c.hands, head: c.hidden ? null : c.head, hidden: c.hidden, source: 'user',
    }]));
    const { checks } = runChecks({
      checkpoints: cps, ball: TRUTH.ball, pose: (f) => L[idx.indexOf(f)] || null, pxPerCm: scale.pxPerCm, heightCm: 176, motionStart: 385, finishQuietS: 0.6,
    });
    const main = mainFault(checks);
    expect(main.fault).toBe('early_extension');
    expect(main.label).toBe('Early extension');
    expect(main.evidence.map((c) => c.id)).toEqual(expect.arrayContaining(['spine_loss', 'hands_height_impact', 'hands_out_impact']));
    expect(main.drills[0]).toBe('ee-silla');
  });

  test('over the top beats tempo', () => {
    const main = mainFault([
      row('downswing_path', 'red'),
      row('clubhead_vs_plane', 'yellow', { dir: 'steep' }),
      row('tempo', 'red', { dir: 'fast' }),
    ]);
    expect(main.fault).toBe('over_the_top');
    expect(main.score).toBeCloseTo(0.95 * 1.5 * 1.25, 2);
  });

  test('a single yellow never becomes main; two agreeing yellows do', () => {
    expect(mainFault([row('spine_loss', 'green'), { ...ee('yellow'), id: 'spine_loss' }, row('tempo', 'yellow', { dir: 'fast' })])).toBeNull();
    const two = mainFault([{ ...ee('yellow'), id: 'spine_loss' }, { ...ee('yellow'), id: 'hip_drift' }]);
    expect(two.fault).toBe('early_extension');
    expect(two.score).toBeCloseTo(1.0 * 1.0 * 1.25, 2);
  });

  test('a lone red does qualify, and unknown checks are ignored', () => {
    expect(mainFault([row('head_drift', 'red')]).fault).toBe('head_sway');
    expect(mainFault([row('head_drift', 'unknown'), row('tempo', 'green')])).toBeNull();
  });

  test('top_direction alone is never main', () => {
    expect(mainFault([row('top_direction', 'yellow', { dir: 'across' })])).toBeNull();
  });

  test('ties go to the earliest fault in the causal chain', () => {
    // posture 0.7 x 1 vs head_sway 0.7 x 1: posture comes first
    expect(mainFault([row('head_drift', 'red'), row('posture_address', 'red')]).fault).toBe('posture');
  });

  test('steep and flat backswing read the direction of the checks', () => {
    expect(mainFault([row('hands_between_planes', 'red', { dir: 'steep' })]).fault).toBe('steep_backswing');
    expect(mainFault([row('butt_extension', 'red', { dir: 'flat' })]).fault).toBe('flat_backswing');
    expect(mainFault([row('tempo', 'red', { dir: 'slow' })]).fault).toBe('tempo_slow');
  });

  test('every fault has a label, and the weights follow the plan', () => {
    FAULTS.forEach((f) => expect(SWING_STRINGS.fault[f.id]).toBeTruthy());
    expect(Object.fromEntries(FAULTS.map((f) => [f.id, f.weight]))).toMatchObject({
      early_extension: 1.0, over_the_top: 0.95, steep_backswing: 0.8, head_sway: 0.7, tempo_fast: 0.6, balance: 0.5, posture: 0.7,
    });
  });
});
