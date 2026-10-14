import {
  fixKey, fixCopy, drillForCheck, fixesFor,
} from '../fixes';
import { SWING_STRINGS } from '../strings';

const KEYS = {
  posture_address: ['tall', 'over'],
  hands_under_shoulders: ['out', 'in'],
  waist_bend: ['over', 'tall'],
  back_line: ['dropped', 'up'],
  hand_gap: ['close', 'far'],
  hands_between_planes: ['steep', 'flat'],
  butt_extension: ['flat', 'steep'],
  top_direction: ['across', 'laid_off'],
  hands_over_heels: ['deep', 'shallow'],
  lead_arm_shoulder_plane: ['above', 'below'],
  downswing_path: ['out'],
  shaft_down_shallow: ['shallow', 'steep'],
  shaft_through_steep: ['flat'],
  clubhead_vs_plane: ['steep', 'under'],
  hands_height_impact: ['up', 'down'],
  hands_out_impact: ['in', 'out'],
  shaft_angle_impact: ['up', 'down'],
  spine_loss: ['lost'],
  hip_drift: ['toward'],
  head_drift: ['moved'],
  tempo: ['fast', 'slow'],
  finish_balance: ['off'],
};
const EE = ['hands_height_impact', 'hands_out_impact', 'shaft_angle_impact', 'spine_loss', 'hip_drift'];
const row = (id, status, extra = {}) => ({ id, status, ...(EE.includes(id) ? { cluster: 'early_extension' } : {}), ...extra });

describe('fixCopy strings', () => {
  const pairs = Object.entries(KEYS).flatMap(([id, dirs]) => dirs.map((d) => [id, d]));

  test.each(pairs)('%s.%s has complete copy and a drill', (id, dir) => {
    const c = SWING_STRINGS.fixCopy[id][dir];
    expect(c.headline.length).toBeLessThanOrEqual(45);
    expect(c.headline).not.toMatch(/\d/);
    expect(c.cue.length).toBeLessThanOrEqual(80);
    expect(c.cost.length).toBeGreaterThan(0);
    expect(c.steps).toHaveLength(3);
    c.steps.forEach((s) => expect(s.length).toBeLessThanOrEqual(70));
    [c.headline, c.cost, c.cue, ...c.steps].forEach((s) => expect(s).not.toMatch(/—/));
    expect(drillForCheck(row(id, 'red', { dir, value: dir === 'down' || dir === 'out' ? -9 : 9 }))).toBeTruthy();
  });

  test('every key list matches the catalogue', () => {
    expect(Object.keys(SWING_STRINGS.fixCopy).sort()).toEqual(Object.keys(KEYS).sort());
    Object.entries(KEYS).forEach(([id, dirs]) => expect(Object.keys(SWING_STRINGS.fixCopy[id]).sort()).toEqual([...dirs].sort()));
  });
});

describe('fixKey', () => {
  test('null for green and unknown', () => {
    expect(fixKey(row('hip_drift', 'green'))).toBeNull();
    expect(fixKey(row('hip_drift', 'unknown'))).toBeNull();
    expect(fixCopy(row('hip_drift', 'green'))).toBeNull();
  });
  test('uses dir when it is a copy key', () => {
    expect(fixKey(row('butt_extension', 'red', { dir: 'flat' }))).toBe('flat');
    expect(fixKey(row('shaft_down_shallow', 'yellow', { dir: 'steep' }))).toBe('steep');
  });
  test('derives the key for dir-less checks', () => {
    expect(fixKey(row('posture_address', 'red', { value: 12 }))).toBe('tall');
    expect(fixKey(row('posture_address', 'yellow', { value: 44 }))).toBe('over');
    expect(fixKey(row('downswing_path', 'red', { value: 9 }))).toBe('out');
    expect(fixKey(row('hands_height_impact', 'red', { value: 9 }))).toBe('up');
    expect(fixKey(row('hands_height_impact', 'red', { value: -9 }))).toBe('down');
    expect(fixKey(row('hands_out_impact', 'red', { value: 9 }))).toBe('in');
    expect(fixKey(row('hands_out_impact', 'red', { value: -9 }))).toBe('out');
    expect(fixKey(row('shaft_angle_impact', 'red', { value: 12 }))).toBe('up');
    expect(fixKey(row('shaft_angle_impact', 'red', { value: -12 }))).toBe('down');
    expect(fixKey(row('spine_loss', 'red', { value: 9 }))).toBe('lost');
    expect(fixKey(row('hip_drift', 'red', { value: 9 }))).toBe('toward');
    expect(fixKey(row('head_drift', 'red', { value: 15 }))).toBe('moved');
    expect(fixKey(row('finish_balance', 'yellow', { value: 1 }))).toBe('off');
  });
});

describe('drillForCheck', () => {
  test('an aimed drill wins over the fault generic one', () => {
    expect(drillForCheck(row('hand_gap', 'red', { dir: 'far' })).id).toBe('su-palmo');
    expect(drillForCheck(row('posture_address', 'red', { value: 12 })).id).toBe('po-espejo');
    expect(drillForCheck(row('clubhead_vs_plane', 'red', { dir: 'under' })).id).toBe('pl-palo-atras');
  });
  test('null for an unknown check', () => {
    expect(drillForCheck(row('nope', 'red'))).toBeNull();
  });
});

describe('fixesFor', () => {
  const setup = (id, status, extra) => row(id, status, { phase: 'setup', ...extra });
  const ids = (checks, max) => fixesFor({ checks }, max).map((f) => f.check.id);

  test('empty when everything is green', () => {
    expect(fixesFor({ checks: [row('hip_drift', 'green'), row('tempo', 'unknown')] })).toEqual([]);
    expect(fixesFor(null)).toEqual([]);
  });

  test('one per fault, the setup fault before the impact fault', () => {
    const checks = [
      row('hip_drift', 'red', { phase: 'impact', cluster: 'early_extension', value: 9 }),
      row('spine_loss', 'red', { phase: 'impact', cluster: 'early_extension', value: 12 }),
      setup('hands_under_shoulders', 'red', { dir: 'out', value: 9 }),
    ];
    const out = fixesFor({ checks });
    expect(out.map((f) => [f.check.id, f.fault])).toEqual([
      ['hands_under_shoulders', 'posture'],
      ['hip_drift', 'early_extension'], // a tie keeps analysis order; spine_loss never repeats the fault
    ]);
    expect(ids(checks, 2)).toEqual(['hands_under_shoulders', 'hip_drift']);
    expect(out[0].copy.headline).toBe("You're reaching for the ball");
    expect(out[0].drill.id).toBe('su-brazos');
  });

  test('the worst check of a fault: red before yellow, then analysis order', () => {
    const checks = [
      setup('hand_gap', 'yellow', { dir: 'far', value: 24 }),
      setup('hands_under_shoulders', 'red', { dir: 'out', value: 9 }),
      setup('back_line', 'red', { dir: 'dropped', value: 25 }),
    ];
    expect(ids(checks, 1)).toEqual(['hands_under_shoulders']);
  });

  test('reds fill after the fault entries, by phase', () => {
    const checks = [
      setup('hands_under_shoulders', 'red', { dir: 'out', value: 9 }),
      row('finish_balance', 'red', { phase: 'finish', value: 0 }),
      row('hands_between_planes', 'yellow', { phase: 'backswing', dir: 'steep', value: 3 }),
      row('top_direction', 'yellow', { phase: 'backswing', dir: 'across', value: 0.2 }),
    ];
    // posture (significant) first, then the lone red; yellows only fill the rest
    expect(ids(checks, 3)).toEqual(['hands_under_shoulders', 'finish_balance', 'hands_between_planes']);
  });

  test('yellows fill only while there is room, capped at max', () => {
    const checks = [
      setup('hand_gap', 'yellow', { dir: 'far', value: 22 }),
      row('top_direction', 'yellow', { phase: 'backswing', dir: 'across', value: 0.2 }),
      row('head_drift', 'yellow', { phase: 'impact', value: 7 }),
      row('finish_balance', 'yellow', { phase: 'finish', value: 1 }),
    ];
    expect(ids(checks)).toEqual(['hand_gap', 'top_direction', 'head_drift']);
    expect(ids(checks, 2)).toEqual(['hand_gap', 'top_direction']);
    const reds = [
      setup('hands_under_shoulders', 'red', { dir: 'out', value: 9 }),
      setup('waist_bend', 'red', { dir: 'over', value: 100 }),
      setup('hand_gap', 'red', { dir: 'far', value: 30 }),
      row('finish_balance', 'red', { phase: 'finish', value: 0 }),
    ];
    // one fix per fault: the other posture reds never take a slot of their own
    expect(ids([...reds, setup('back_line', 'yellow', { dir: 'up', value: 15 })])).toEqual(['hands_under_shoulders', 'finish_balance']);
  });
});
