import {
  fixKey, fixCopy, drillForCheck, fixesFor,
} from '../fixes';
import { SWING_STRINGS } from '../strings';

const KEYS = {
  posture_address: ['tall', 'over'],
  hands_under_shoulders: ['out', 'in'],
  back_line: ['dropped', 'up'],
  knee_flex: ['stiff', 'squat'],
  shaft_plane: ['upright', 'flat'],
  clubhead_plane_takeaway: ['steep', 'flat'],
  spine_hold: ['up', 'down'],
  knee_hold: ['straighten', 'flex'],
  butt_extension: ['flat', 'steep'],
  lead_arm_spine: ['upright', 'flat'],
  hands_over_heels: ['deep', 'shallow'],
  clubhead_plane_down: ['steep', 'under'],
  down_vs_takeaway: ['steeper'],
  hip_drift: ['toward'],
  spine_loss: ['lost'],
  shaft_through_ball: ['beyond', 'inside'],
  through_vs_halfway: ['beyond', 'inside'],
  tempo: ['fast', 'slow'],
  finish_balance: ['off'],
  head_drift: ['moved'],
  hands_height_impact: ['up', 'down'],
  hands_out_impact: ['in', 'out'],
  shaft_angle_impact: ['up', 'down'],
  // face-on (plan 2026-10-30)
  fo_stance: ['narrow', 'wide'],
  fo_ball_pos: ['back', 'forward'],
  fo_setup_tilt: ['upright', 'much'],
  fo_sway: ['out'],
  fo_head_top: ['moved'],
  fo_hips_shift: ['stuck'],
  fo_head_back: ['forward'],
  fo_hands_ahead: ['back', 'forward'],
  fo_hips_impact: ['stuck'],
  fo_finish_head: ['back'],
  fo_slide: ['past'],
  fo_head_behind: ['ahead'],
  fo_head_dip: ['down'],
  fo_finish_weight: ['back'],
  hands_bicep: ['out', 'deep'],
  finish_trail_foot: ['flat'],
};
// The fault each row names (checks.js), by id and, where it depends on it, direction.
const FAULT = {
  posture_address: 'posture', hands_under_shoulders: 'posture', back_line: 'posture', knee_flex: 'posture', shaft_plane: 'posture',
  clubhead_plane_takeaway: { steep: 'steep_backswing', flat: 'flat_backswing' },
  spine_hold: 'posture_loss', knee_hold: 'posture_loss',
  butt_extension: { steep: 'steep_backswing', flat: 'flat_backswing' },
  lead_arm_spine: 'top_position', hands_over_heels: 'top_position',
  clubhead_plane_down: { steep: 'over_the_top', under: 'stuck' }, down_vs_takeaway: 'over_the_top',
  hip_drift: 'early_extension', spine_loss: 'early_extension',
  shaft_through_ball: { beyond: 'flip', inside: 'over_the_top' }, through_vs_halfway: 'flip',
  tempo: { fast: 'tempo_fast', slow: 'tempo_slow' }, finish_balance: 'balance', head_drift: 'head_sway',
  hands_height_impact: 'early_extension', hands_out_impact: 'early_extension', shaft_angle_impact: 'early_extension',
  fo_stance: 'stance_width', fo_ball_pos: 'ball_position', fo_setup_tilt: 'posture', fo_sway: 'sway', fo_head_top: 'head_sway',
  fo_hips_shift: 'hanging_back', fo_head_back: 'head_sway', fo_hands_ahead: { back: 'scoop', forward: 'excess_lean' }, fo_slide: 'slide',
  fo_hips_impact: 'hanging_back', fo_finish_head: 'hanging_back',
  fo_head_behind: 'head_sway', fo_head_dip: 'head_dip', fo_finish_weight: 'hanging_back',
  hands_bicep: { out: 'steep_backswing', deep: 'flat_backswing' }, finish_trail_foot: 'balance',
};
const faultOf = (id, dir) => (typeof FAULT[id] === 'object' ? FAULT[id][dir] : FAULT[id]) ?? null;
const POS = { hip_drift: 'impact', spine_loss: 'impact', hands_under_shoulders: 'address', back_line: 'address', knee_flex: 'address' };
const row = (id, status, extra = {}) => ({
  id, status, position: POS[id] ?? null, fault: faultOf(id, extra.dir), severity: 0, ...extra,
});

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
    expect(fixKey(row('clubhead_plane_down', 'yellow', { dir: 'under' }))).toBe('under');
    expect(fixKey(row('knee_hold', 'red', { dir: 'straighten' }))).toBe('straighten');
  });
  test('derives the key for dir-less checks', () => {
    expect(fixKey(row('posture_address', 'red', { value: 12 }))).toBe('tall');
    expect(fixKey(row('posture_address', 'yellow', { value: 44 }))).toBe('over');
    expect(fixKey(row('down_vs_takeaway', 'red', { value: 9, dir: 'steeper' }))).toBe('steeper');
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
    expect(drillForCheck(row('knee_flex', 'red', { dir: 'stiff' })).id).toBe('su-rodillas');
    expect(drillForCheck(row('knee_hold', 'red', { dir: 'straighten' })).id).toBe('pl-rodilla');
    expect(drillForCheck(row('clubhead_plane_takeaway', 'red', { dir: 'flat' })).id).toBe('tk-plano');
    expect(drillForCheck(row('posture_address', 'red', { value: 12 })).id).toBe('po-espejo');
  });
  test('else the fault own drill: stuck, posture loss, over the top', () => {
    expect(drillForCheck(row('clubhead_plane_down', 'red', { dir: 'under' })).id).toBe('st-salida');
    expect(drillForCheck(row('spine_hold', 'red', { dir: 'up' })).id).toBe('pl-columna');
    expect(drillForCheck(row('clubhead_plane_down', 'red', { dir: 'steep' })).id).toBe('ott-toalla');
  });
  test('null for a check with no fault', () => {
    expect(drillForCheck(row('nope', 'red'))).toBeNull();
  });
});

describe('fixesFor', () => {
  const ids = (checks, max) => fixesFor({ checks }, max).map((f) => f.check.id);

  test('empty when everything is green', () => {
    expect(fixesFor({ checks: [row('hip_drift', 'green'), row('tempo', 'unknown')] })).toEqual([]);
    expect(fixesFor(null)).toEqual([]);
  });

  test('one per fault, in the order of the main fault: tier, then severity', () => {
    const checks = [
      row('hip_drift', 'red', { value: 9, severity: 0.5 }),
      row('spine_loss', 'red', { value: 12, severity: 1.2 }),
      row('hands_under_shoulders', 'red', { dir: 'out', value: 14, severity: 0.5 }),
    ];
    const out = fixesFor({ checks });
    expect(out.map((f) => [f.check.id, f.fault])).toEqual([
      ['spine_loss', 'early_extension'], // tier 1, the most severe; hip_drift never repeats the fault
      ['hands_under_shoulders', 'posture'],
    ]);
    expect(ids(checks, 1)).toEqual(['spine_loss']);
    expect(out[1].copy.headline).toBe("You're reaching for the ball");
    expect(out[1].drill.id).toBe('su-brazos');
  });

  test('reds before yellows, capped at max', () => {
    const checks = [
      row('knee_flex', 'yellow', { dir: 'stiff', value: 12, position: 'address', severity: 0.6 }),
      row('lead_arm_spine', 'red', { dir: 'upright', value: 25, position: 'top', severity: 0.5 }),
      row('head_drift', 'yellow', { value: 7, extra: true, severity: 0.4 }),
      row('finish_balance', 'red', { value: 0, extra: true, severity: 1 }),
    ];
    expect(ids(checks)).toEqual(['lead_arm_spine', 'finish_balance', 'knee_flex']);
    expect(ids(checks, 2)).toEqual(['lead_arm_spine', 'finish_balance']);
  });
});
