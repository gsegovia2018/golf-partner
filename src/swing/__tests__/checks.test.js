// Golden checks: the owner's labelled marks (owner-truth.json) on the fixture pose, read by the
// swing checks v2 rows (spec 2026-10-18). Values are what the provisional limits give, not tuned.
import { runChecks, getPlanes } from '../checks';
import { mainFault, positionStatuses } from '../priority';
import { scaleFromWindow } from '../scale';
import { fixtureSamples, TRUTH } from './helpers';

const { idx, L } = fixtureSamples();
const poseAt = (f) => (idx.includes(f) ? L[idx.indexOf(f)] : null);
const scale = scaleFromWindow(idx, L, [328, 338], 'right', 176);

const marks = () => Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  frame: c.frame, hands: c.hands, head: c.hidden ? null : c.head, hidden: c.hidden, source: 'user',
}]));
const input = (over = {}) => ({
  checkpoints: marks(),
  ball: TRUTH.ball,
  pose: poseAt,
  handedness: 'right',
  pxPerCm: scale.pxPerCm,
  heightCm: 176,
  motionStart: 385,
  finishQuietS: 0.6,
  approximate: false,
  ...over,
});
const byId = (checks, id, cp) => checks.find((c) => c.id === id && (!cp || c.cp === cp));

describe('golden checks on the owner marks', () => {
  const { checks } = runChecks(input());

  test('all 30 rows produce a status (26 ids: spine_hold at four positions, knee_hold at two)', () => {
    expect(checks).toHaveLength(30);
    expect(new Set(checks.map((c) => c.id)).size).toBe(26);
    checks.forEach((c) => expect(['green', 'yellow', 'red', 'unknown']).toContain(c.status));
    expect(checks.filter((c) => c.id === 'spine_hold').map((c) => c.cp)).toEqual(['takeaway', 'leadArm', 'top', 'shaftDown']);
    expect(checks.filter((c) => c.id === 'knee_hold').map((c) => c.cp)).toEqual(['takeaway', 'leadArm']);
  });

  test('the owner swing, position by position (iron, provisional limits)', () => {
    const v = (id, cp) => {
      const c = byId(checks, id, cp);
      return [c.status, c.value, c.dir ?? null];
    };
    // Address: a good setup; the hands a hair over 8 cm out are yellow, the shaft points at the belt.
    expect(v('posture_address')).toEqual(['green', 32, null]);
    expect(v('hands_under_shoulders')).toEqual(['yellow', 8, 'out']);
    expect(v('back_line')).toEqual(['green', 38, 'dropped']);
    expect(v('knee_flex')).toEqual(['green', 22, null]);
    expect(v('shaft_plane')).toEqual(['green', 4, 'upright']);
    // Takeaway: the clubhead 20 cm under the plane (inside); the spine and the trail knee hold.
    expect(v('clubhead_plane_takeaway')).toEqual(['red', -20, 'flat']);
    expect(v('spine_hold', 'takeaway')).toEqual(['green', -1, 'down']);
    expect(v('knee_hold', 'takeaway')).toEqual(['green', -4, 'straighten']);
    // Halfway back: the shaft line lands 24 cm beyond the ball (flat).
    expect(v('butt_extension')).toEqual(['red', 24, 'flat']);
    expect(v('spine_hold', 'leadArm')).toEqual(['green', -3, 'down']);
    expect(v('knee_hold', 'leadArm')).toEqual(['green', -5, 'straighten']);
    // Top: the hands 16 cm in front of the trail heel (a watch since the lab table), the lead arm 17 degrees upright.
    expect(v('lead_arm_spine')).toEqual(['yellow', 17, 'upright']);
    expect(v('hands_over_heels')).toEqual(['yellow', 16, 'shallow']);
    expect(v('spine_hold', 'top')).toEqual(['green', -1, 'down']);
    // Downswing: the owner marked the clubhead hidden, so only the spine reads (3 degrees up: yellow).
    expect(byId(checks, 'clubhead_plane_down')).toMatchObject({ status: 'unknown', reason: 'hidden' });
    expect(byId(checks, 'down_vs_takeaway')).toMatchObject({ status: 'unknown', reason: 'hidden' });
    expect(v('spine_hold', 'shaftDown')).toEqual(['yellow', 3, 'up']);
    // Impact: the backside 7 cm toward the ball and 8 degrees of spine lost.
    expect(v('hip_drift')).toEqual(['red', 7, null]);
    expect(v('spine_loss')).toEqual(['red', 8, null]);
    // Follow-through: the clubhead is hidden at the trail arm too.
    expect(byId(checks, 'shaft_through_ball')).toMatchObject({ status: 'unknown', reason: 'hidden' });
    expect(byId(checks, 'through_vs_halfway')).toMatchObject({ status: 'unknown', reason: 'hidden' });

    expect(positionStatuses(checks)).toEqual({
      address: 'yellow', takeaway: 'red', leadArm: 'red', top: 'yellow', shaftDown: 'yellow', impact: 'red', trailArm: 'unknown',
    });
    // Tier 1 first: impact's hip drift (1.48 yellow bands past its red limit) leads; the takeaway is
    // the earliest red position. The spec expected the downswing, but the owner's P6 clubhead is hidden.
    const main = mainFault(checks);
    expect(main).toMatchObject({
      fault: 'early_extension', position: 'impact', tier: 1, severity: 0.61, startsAt: 'takeaway', consequences: [],
    });
    expect(main.evidence[0].id).toBe('spine_loss');
  });

  // Hands 10 cm high and 9 cm out are a watch since the tour reference swings (referenceSwings.test.js): the
  // backside line and the spine carry the early extension.
  test('the early-extension cluster: spine loss red (7 deg), hands 10 cm high, hands 9 cm toward the ball', () => {
    const spine = byId(checks, 'spine_loss');
    expect(spine.status).toBe('red');
    expect(Math.abs(spine.value - 7)).toBeLessThanOrEqual(2);
    const height = byId(checks, 'hands_height_impact');
    expect(height.status).toBe('yellow');
    expect(Math.abs(height.value - 10)).toBeLessThanOrEqual(3);
    const out = byId(checks, 'hands_out_impact'); // D11
    expect(out.status).toBe('yellow');
    expect(Math.abs(out.value - 9)).toBeLessThanOrEqual(2);
    expect(out).toMatchObject({ fault: 'early_extension', extra: true, position: null });
    const shaft = byId(checks, 'shaft_angle_impact');
    expect(['yellow', 'red']).toContain(shaft.status);
    expect(Math.abs(shaft.value - 8)).toBeLessThanOrEqual(3);
  });

  test('tempo is yellow (D9): 110 : 61 frames is about 1.8', () => {
    const t = byId(checks, 'tempo');
    expect(t.status).toBe('yellow');
    expect(t.value).toBe(1.8);
    expect(t.dir).toBe('fast');
  });

  test('posture and the other pose checks have measured values', () => {
    expect(byId(checks, 'posture_address').value).toBe(32);
    expect(byId(checks, 'hip_drift').unit).toBe('cm');
    expect(byId(checks, 'head_drift').status).not.toBe('unknown');
  });

  test('finish balance reads the hold and the lead ankle', () => {
    expect(byId(checks, 'finish_balance').status).not.toBe('unknown');
    const still = byId(runChecks(input({ finishQuietS: 0.1 })).checks, 'finish_balance');
    const held = byId(checks, 'finish_balance');
    expect(held.value - still.value).toBe(1);
  });
});

describe('club-dependent checks stay unknown until the clubhead is placed (D16)', () => {
  test('a hidden takeaway head gives unknown with a reason, never a failure', () => {
    const cps = marks();
    cps.takeaway = { ...cps.takeaway, head: null, hidden: true };
    const row = byId(runChecks(input({ checkpoints: cps })).checks, 'clubhead_plane_takeaway');
    expect(row.status).toBe('unknown');
    expect(row.reason).toBe('hidden');
  });

  test('with no marks at all the club checks are unknown ("tap to place") and the pose checks still run', () => {
    const cps = Object.fromEntries(Object.entries(marks()).map(([k, c]) => [k, { ...c, head: null, hidden: false, source: 'prior' }]));
    const { checks } = runChecks(input({ checkpoints: cps }));
    ['shaft_plane', 'clubhead_plane_takeaway', 'butt_extension', 'clubhead_plane_down', 'down_vs_takeaway',
      'shaft_through_ball', 'through_vs_halfway', 'shaft_angle_impact'].forEach((id) => {
      expect(byId(checks, id)).toMatchObject({ status: 'unknown', reason: 'unplaced', text: 'Clubhead not visible — tap to place' });
    });
    expect(byId(checks, 'spine_loss').status).toBe('red');
    expect(byId(checks, 'hands_out_impact').status).toBe('yellow');
    expect(checks).toHaveLength(30);
  });

  test('the owner swing with every clubhead a weak model detection (0.05) reads like no clubhead at all', () => {
    const weak = Object.fromEntries(Object.entries(marks()).map(([k, c]) => [k, { ...c, source: 'model', conf: 0.05 }]));
    const { checks } = runChecks(input({ checkpoints: weak }));
    expect(byId(checks, 'clubhead_plane_takeaway')).toMatchObject({ status: 'unknown', reason: 'unplaced' });
    expect(byId(checks, 'butt_extension')).toMatchObject({ status: 'unknown', reason: 'unplaced' });
    const strong = Object.fromEntries(Object.entries(marks()).map(([k, c]) => [k, { ...c, source: 'model', conf: 0.5 }]));
    expect(byId(runChecks(input({ checkpoints: strong })).checks, 'butt_extension')).toMatchObject({ status: 'red', value: 24 });
  });

  test('missing ball or pose degrades to unknown, not an exception', () => {
    const { checks } = runChecks(input({ ball: null, pose: () => null }));
    expect(checks).toHaveLength(30);
    ['posture_address', 'hands_under_shoulders', 'back_line', 'knee_flex', 'shaft_plane', 'clubhead_plane_takeaway',
      'hands_over_heels', 'lead_arm_spine', 'spine_loss', 'knee_hold']
      .forEach((id) => expect(byId(checks, id).status).toBe('unknown'));
  });
});

describe('thresholds and flags', () => {
  const tempoRow = (start, top, impact) => {
    const cps = { top: { frame: top, hands: { x: 0, y: 0 } }, impact: { frame: impact, hands: { x: 0, y: 0 } } };
    return byId(runChecks({ checkpoints: cps, ball: null, pose: () => null, pxPerCm: 1, heightCm: 176, motionStart: start }).checks, 'tempo');
  };

  test('tempo bands (D9): 3:1 green, 2:1 and 4:1 yellow, 1.4:1 and 5:1 red', () => {
    expect(tempoRow(0, 300, 400).status).toBe('green');
    expect(tempoRow(0, 200, 300).status).toBe('yellow');
    expect(tempoRow(0, 400, 500).status).toBe('yellow');
    expect(tempoRow(0, 140, 240).status).toBe('red');
    expect(tempoRow(0, 500, 600).status).toBe('red');
    expect(tempoRow(0, 400, 500).dir).toBe('slow');
  });

  test('impact checks inherit approximate from the fps model; address-only ones do not', () => {
    const { checks } = runChecks(input({ approximate: true }));
    expect(byId(checks, 'spine_loss').approximate).toBe(true);
    expect(byId(checks, 'tempo').approximate).toBe(true);
    expect(byId(checks, 'posture_address').approximate).toBe(false);
    expect(byId(checks, 'hands_over_heels').approximate).toBe(false);
  });

  test('left-handers are mirrored around the ball and read the same', () => {
    const W = 478;
    const mirrorPt = (p) => (p ? { x: W - p.x, y: p.y } : p);
    const swap = (lm) => {
      const out = lm.map(([x, y, v]) => [W - x, y, v]);
      [[7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]].forEach(([a, b]) => {
        [out[a], out[b]] = [out[b], out[a]];
      });
      return out;
    };
    const cps = Object.fromEntries(Object.entries(marks()).map(([k, c]) => [k, { ...c, hands: mirrorPt(c.hands), head: mirrorPt(c.head) }]));
    const right = runChecks(input()).checks;
    const left = runChecks(input({
      checkpoints: cps, ball: mirrorPt(TRUTH.ball), pose: (f) => (poseAt(f) ? swap(poseAt(f)) : null), handedness: 'left',
    })).checks;
    right.forEach((r, n) => {
      expect(left[n].status).toBe(r.status);
      if (typeof r.value === 'number') expect(Math.abs(left[n].value - r.value)).toBeLessThanOrEqual(1);
    });
  });

  test('getPlanes: shaft plane through ball and address hands, shoulder plane to the trail shoulder', () => {
    const planes = getPlanes(input());
    expect(planes.shaft.b).toEqual({ x: 210, y: 425 });
    expect(planes.shoulder.b.y).toBeGreaterThan(300);
    expect(getPlanes({ checkpoints: {}, ball: null, pose: poseAt }).shaft).toBeNull();
  });
});
