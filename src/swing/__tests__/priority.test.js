// Swing checks v2 priority (spec 2026-10-18 §6): importance tier, then severity; earlier red
// positions are where the fault likely starts, later ones what it likely causes.
import {
  mainFault, rankedRows, positionStatuses, tierOf, FAULTS,
} from '../priority';
import { runChecks } from '../checks';
import { scaleFromWindow } from '../scale';
import { SWING_STRINGS } from '../strings';
import { DRILLS } from '../drills';
import { fixtureSamples, TRUTH } from './helpers';

const row = (id, position, status, fault, severity = 0, extra = {}) => ({
  id, position, status, fault, severity, ...extra,
});
const extraRow = (id, status, fault, severity = 0) => ({
  id, position: null, extra: true, status, fault, severity,
});

describe('tiers', () => {
  test('1 = address, downswing, impact; 2 = halfway back, top; 3 = takeaway, follow-through, extras', () => {
    expect(['address', 'shaftDown', 'impact', 'leadArm', 'top', 'takeaway', 'trailArm'].map((p) => tierOf({ position: p })))
      .toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(tierOf({ extra: true, position: null })).toBe(3);
  });
});

describe('the main fault', () => {
  test('tier beats severity: a barely red downswing row leads a very red top row', () => {
    const main = mainFault([
      row('hands_over_heels', 'top', 'red', 'top_position', 3),
      row('clubhead_plane_down', 'shaftDown', 'red', 'over_the_top', 0.1),
    ]);
    expect(main).toMatchObject({ fault: 'over_the_top', position: 'shaftDown', tier: 1, severity: 0.1 });
    expect(main.label).toBe('Over the top');
    expect(main.startsAt).toBe('top'); // the top is red and comes before the downswing
  });

  test('within a tier the most severe red row leads', () => {
    const main = mainFault([
      row('shaft_plane', 'address', 'red', 'posture', 0.4),
      row('spine_loss', 'impact', 'red', 'early_extension', 1.2),
    ]);
    expect(main).toMatchObject({ fault: 'early_extension', position: 'impact' });
    expect(main.startsAt).toBe('address');
  });

  test('a yellow row leads only when nothing is red', () => {
    const yellows = [
      row('shaft_plane', 'address', 'yellow', 'posture', 0.5),
      row('lead_arm_spine', 'top', 'yellow', 'top_position', 0.9),
    ];
    expect(mainFault(yellows)).toMatchObject({ fault: 'posture', startsAt: null, consequences: [] });
    expect(mainFault([...yellows, row('clubhead_plane_takeaway', 'takeaway', 'red', 'flat_backswing', 0.1)]).fault).toBe('flat_backswing');
  });

  test('startsAt is the earliest earlier position with a red row; yellow ones do not count', () => {
    const main = mainFault([
      row('shaft_plane', 'address', 'yellow', 'posture', 0.5),
      row('clubhead_plane_takeaway', 'takeaway', 'red', 'flat_backswing', 0.7),
      row('butt_extension', 'leadArm', 'red', 'flat_backswing', 0.2),
      row('spine_loss', 'impact', 'red', 'early_extension', 0.6),
    ]);
    expect(main).toMatchObject({ fault: 'early_extension', startsAt: 'takeaway' });
    expect(mainFault([row('spine_loss', 'impact', 'red', 'early_extension', 0.6)]).startsAt).toBeNull();
  });

  test('consequences are the faults of the red positions after the main one (worst row, deduplicated)', () => {
    const main = mainFault([
      row('shaft_plane', 'address', 'red', 'posture', 0.5),
      row('spine_hold', 'takeaway', 'red', 'posture_loss', 0.3, { cp: 'takeaway' }),
      row('lead_arm_spine', 'top', 'red', 'top_position', 0.2),
      row('hands_over_heels', 'top', 'red', 'top_position', 0.4),
      row('clubhead_plane_down', 'shaftDown', 'yellow', 'over_the_top', 0.9),
      row('hip_drift', 'impact', 'red', 'early_extension', 0.1),
      row('spine_loss', 'impact', 'red', 'early_extension', 0.05),
      row('shaft_through_ball', 'trailArm', 'red', 'flip', 1),
    ]);
    expect(main).toMatchObject({ fault: 'posture', position: 'address', startsAt: null });
    expect(main.consequences).toEqual(['posture_loss', 'top_position', 'early_extension', 'flip']);
  });

  test('evidence is every red / yellow row of the main fault, most important first', () => {
    const main = mainFault([
      row('hip_drift', 'impact', 'yellow', 'early_extension', 0.4),
      extraRow('hands_height_impact', 'red', 'early_extension', 2),
      row('spine_loss', 'impact', 'red', 'early_extension', 0.6),
      row('spine_hold', 'shaftDown', 'red', 'early_extension', 0.1, { cp: 'shaftDown' }),
    ]);
    expect(main.position).toBe('impact');
    expect(main.evidence.map((c) => c.id)).toEqual(['spine_loss', 'spine_hold', 'hands_height_impact', 'hip_drift']);
    expect(main.drills[0]).toBe('ee-silla');
  });

  test('an extra leads only after the positions of its tier lose on severity; it has no position', () => {
    const main = mainFault([
      row('clubhead_plane_takeaway', 'takeaway', 'red', 'flat_backswing', 0.1),
      extraRow('tempo', 'red', 'tempo_fast', 0.8),
    ]);
    expect(main).toMatchObject({ fault: 'tempo_fast', position: null, phase: 'extras', startsAt: 'takeaway', consequences: [] });
  });

  test('every position green or unknown, or only rows with no fault: no main fault', () => {
    expect(mainFault([row('knee_flex', 'address', 'green', 'posture'), row('clubhead_plane_down', 'shaftDown', 'unknown', 'over_the_top')])).toBeNull();
    expect(mainFault([])).toBeNull();
  });

  test('rankedRows: red before yellow, tier, severity, then swing order', () => {
    const r = rankedRows([
      row('a', 'trailArm', 'yellow', 'flip', 3),
      row('b', 'top', 'red', 'top_position', 0.5),
      row('c', 'address', 'red', 'posture', 0.5),
      row('d', 'impact', 'red', 'early_extension', 0.5),
      row('e', 'leadArm', 'red', 'flat_backswing', 0.9),
    ]);
    expect(r.map((c) => c.id)).toEqual(['c', 'd', 'e', 'b', 'a']);
  });

  test('positionStatuses: the worst measured row per position; extras never colour one', () => {
    expect(positionStatuses([
      row('knee_flex', 'address', 'green', 'posture'),
      row('shaft_plane', 'address', 'yellow', 'posture'),
      row('clubhead_plane_down', 'shaftDown', 'unknown', 'over_the_top'),
      extraRow('tempo', 'red', 'tempo_fast'),
    ])).toEqual({
      address: 'yellow', takeaway: 'unknown', leadArm: 'unknown', top: 'unknown', shaftDown: 'unknown', impact: 'unknown', trailArm: 'unknown',
    });
  });

  test('every fault has a label and at least one drill', () => {
    FAULTS.forEach((f) => {
      expect(SWING_STRINGS.fault[f]).toBeTruthy();
      expect(DRILLS.some((d) => d.fault === f || d.also?.includes(f))).toBe(true);
    });
    expect(SWING_STRINGS.fault.posture_loss).toBe('Losing posture');
    expect(SWING_STRINGS.fault.stuck).toBe('Stuck');
  });
});

describe('golden: the owner swing', () => {
  test('early extension at impact leads, likely starting at the takeaway', () => {
    const { idx, L } = fixtureSamples();
    const scale = scaleFromWindow(idx, L, [328, 338], 'right', 176);
    const cps = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
      frame: c.frame, hands: c.hands, head: c.hidden ? null : c.head, hidden: c.hidden, source: 'user',
    }]));
    const { checks } = runChecks({
      checkpoints: cps, ball: TRUTH.ball, pose: (f) => L[idx.indexOf(f)] || null, pxPerCm: scale.pxPerCm, heightCm: 176, motionStart: 385, finishQuietS: 0.6,
    });
    const main = mainFault(checks);
    expect(main).toMatchObject({
      fault: 'early_extension', label: 'Early extension', position: 'impact', phase: 'impact', startsAt: 'takeaway', consequences: [],
    });
    expect(main.evidence.map((c) => c.id)).toEqual([
      'hip_drift', 'spine_loss', 'hands_height_impact', 'hands_out_impact', 'spine_hold', 'shaft_angle_impact',
    ]);
    expect(main.drills).toEqual(['ee-silla', 'ee-pared', 'ee-palo-talones']);
  });
});
