// Golden checks: the owner's labelled marks (owner-truth.json, plus the pre-impact mark of the
// prototype's plane.py) on the fixture pose.
import { runChecks, getPlanes } from '../checks';
import { scaleFromWindow } from '../scale';
import { fixtureSamples, TRUTH } from './helpers';

const { idx, L } = fixtureSamples();
const poseAt = (f) => (idx.includes(f) ? L[idx.indexOf(f)] : null);
const scale = scaleFromWindow(idx, L, [328, 338], 'right', 176);

const marks = () => {
  const out = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
    frame: c.frame, hands: c.hands, head: c.hidden ? null : c.head, hidden: c.hidden, source: 'user',
  }]));
  out.preImpact = { frame: 550, hands: { x: 222, y: 400 }, head: { x: 240, y: 470 }, hidden: false, source: 'user' };
  return out;
};
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

  test('all 23 rows produce a status (22 ids, clubhead_vs_plane twice)', () => {
    expect(checks).toHaveLength(23);
    expect(new Set(checks.map((c) => c.id)).size).toBe(22);
    checks.forEach((c) => expect(['green', 'yellow', 'red', 'unknown']).toContain(c.status));
    expect(checks.filter((c) => c.id === 'clubhead_vs_plane').map((c) => c.cp)).toEqual(['preImpact', 'impact']);
  });

  test('the early-extension cluster: spine loss red (7 deg), hands 10 cm high, hands 9 cm toward the ball', () => {
    const spine = byId(checks, 'spine_loss');
    expect(spine.status).toBe('red');
    expect(Math.abs(spine.value - 7)).toBeLessThanOrEqual(2);
    const height = byId(checks, 'hands_height_impact');
    expect(height.status).toBe('red');
    expect(Math.abs(height.value - 10)).toBeLessThanOrEqual(3);
    const out = byId(checks, 'hands_out_impact'); // D11
    expect(out.status).toBe('red');
    expect(Math.abs(out.value - 9)).toBeLessThanOrEqual(2);
    expect(out.cluster).toBe('early_extension');
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

  test('top direction is yellow and crossed; the clubhead returns to the plane at impact', () => {
    const top = byId(checks, 'top_direction');
    expect(top.status).toBe('yellow');
    expect(top.dir).toBe('across');
    expect(byId(checks, 'clubhead_vs_plane', 'impact').status).toBe('green');
  });

  test('D21 setup and top checks on the owner swing (setup recalibrated 2026-10-18)', () => {
    const v = (id) => [byId(checks, id).status, byId(checks, id).value, byId(checks, id).dir];
    // A good address (green on swingcheck.org): only the hands, a hair over 8 cm out, are yellow.
    expect(v('hands_under_shoulders')).toEqual(['yellow', 8, 'out']);
    expect(v('waist_bend')).toEqual(['green', 134, null]);
    expect(v('back_line')).toEqual(['green', 38, 'dropped']);
    expect(v('hand_gap')).toEqual(['green', 17, null]);
    expect(v('hands_over_heels')).toEqual(['red', 16, 'shallow']);
    expect(v('lead_arm_shoulder_plane')).toEqual(['yellow', -16, 'below']);
    ['hands_under_shoulders', 'waist_bend', 'back_line', 'hand_gap'].forEach((id) => expect(byId(checks, id).phase).toBe('setup'));
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
  test('a hidden pre-impact head gives unknown with a reason, never a failure', () => {
    const cps = marks();
    cps.preImpact = { ...cps.preImpact, head: null, hidden: true };
    const row = byId(runChecks(input({ checkpoints: cps })).checks, 'clubhead_vs_plane', 'preImpact');
    expect(row.status).toBe('unknown');
    expect(row.reason).toBe('hidden');
  });

  test('with no marks at all the club checks are unknown ("place the clubhead") and the pose checks still run', () => {
    const cps = Object.fromEntries(Object.entries(marks()).map(([k, c]) => [k, { ...c, head: null, hidden: false, source: 'prior' }]));
    const { checks } = runChecks(input({ checkpoints: cps }));
    ['butt_extension', 'top_direction', 'shaft_angle_impact'].forEach((id) => {
      const row = byId(checks, id);
      expect(row.status).toBe('unknown');
      expect(row.reason).toBe('unplaced');
    });
    expect(checks.filter((c) => c.id === 'clubhead_vs_plane').every((c) => c.status === 'unknown')).toBe(true);
    expect(byId(checks, 'spine_loss').status).toBe('red');
    expect(byId(checks, 'hands_out_impact').status).toBe('red');
    expect(checks).toHaveLength(23);
  });

  test('missing ball or pose degrades to unknown, not an exception', () => {
    const { checks } = runChecks(input({ ball: null, pose: () => null }));
    expect(checks).toHaveLength(23);
    ['hands_under_shoulders', 'waist_bend', 'back_line', 'hand_gap', 'hands_over_heels', 'lead_arm_shoulder_plane']
      .forEach((id) => expect(byId(checks, id).status).toBe('unknown'));
    expect(byId(checks, 'posture_address').status).toBe('unknown');
    expect(byId(checks, 'hands_between_planes').status).toBe('unknown');
    expect(byId(checks, 'clubhead_vs_plane', 'impact').status).toBe('unknown');
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
    expect(byId(checks, 'top_direction').approximate).toBe(false);
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
