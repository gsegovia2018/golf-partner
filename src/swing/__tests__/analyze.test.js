import { analyze, SCHEMA } from '../analyze';
import { SWING_STRINGS } from '../strings';
import { fixtureNative, TRUTH, W, H } from './helpers';

const lab = require('./fixtures/lab-d15-pass1.json');

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const native = (extra = {}) => fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame, ...extra });
const pass2 = { addressFrame: lab.expected.addressFrame, shaft: {} };
const ownerMarks = () => Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
}]));
const byId = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp));

describe('analyze: the whole pipeline on the fixture', () => {
  const a = analyze(native(), { pass2, handedness: 'right', heightCm: 176, club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' });

  test('shape of analysis.json (schema swing-analysis/4)', () => {
    expect(a.error).toBeUndefined();
    expect(a.schema).toBe(SCHEMA);
    expect(SCHEMA).toBe('swing-analysis/4');
    expect(a).toMatchObject({ swingId: 's1', club: 'iron', handedness: 'right', view: 'dtl', source: 'import' });
    expect(a.fps).toMatchObject({ factor: 8, source: 'estimate', approximate: false });
    expect(a.scale.approx).toBe(false);
    expect(a.scale.pxPerCm).toBeGreaterThan(1.1);
    expect(Object.keys(a.checkpoints)).toEqual(['address', 'takeaway', 'leadArm', 'top', 'transition', 'shaftDown', 'impact', 'shaftThrough', 'trailArm', 'finish']);
    // checks v2: the club is resolved at the seven positions and the finish only (P5 and P8 are not checkpoints any more)
    expect(Object.keys(a.clubMarks)).toEqual(['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm', 'finish']);
    expect(a.reference.ball).toEqual([ball.x, ball.y]);
    expect(Math.abs(a.reference.shaftPlaneDeg - 52)).toBeLessThanOrEqual(6);
  });

  test('all 27 rows produce a status; counts add up', () => {
    expect(a.checks).toHaveLength(27);
    a.checks.forEach((c) => expect(['green', 'yellow', 'red', 'unknown']).toContain(c.status));
    const c = a.counts;
    expect(c.green + c.yellow + c.red + c.unknown).toBe(27);
  });

  test('D16: without placed marks the club-dependent checks are unknown, the rest are measured', () => {
    expect(a.checks.filter((c) => c.status === 'unknown').map((c) => c.id)).toEqual([
      'shaft_plane', 'clubhead_plane_takeaway', 'butt_extension', 'clubhead_plane_down', 'down_vs_takeaway',
      'shaft_through_ball', 'through_vs_halfway', 'shaft_angle_impact',
    ]);
    a.checks.filter((c) => c.status === 'unknown').forEach((c) => expect(c.reason).toBe('unplaced'));
    expect(byId(a, 'spine_loss').status).not.toBe('unknown');
    expect(a.clubMarks.address.source).toBe('prior');
    expect(a.clubMarks.address.priorHead).toBeDefined();
    expect(a.clubMarks.top.priorHead).toBeUndefined();
  });

  test('main fault (spec §6): impact is tier 1 and red, so early extension leads; nothing red before it', () => {
    // Without marks the takeaway and halfway-back clubheads are unplaced, and the top is a yellow
    // since the lab table (hands over heels 6 / 18 cm), so there is no earlier red to start from.
    expect(a.main).toMatchObject({ fault: 'early_extension', position: 'impact', startsAt: null, consequences: [] });
    expect(a.main.evidence[0].id).toBe('hip_drift');
    expect(a.main.drills[0]).toBe('ee-silla');
  });
});

describe('analyze with the owner marks as user marks (golden)', () => {
  const a = analyze(native(), { pass2, marks: ownerMarks(), heightCm: 176 });

  test('every club check with a visible clubhead has a verdict; early extension leads, starting at the takeaway', () => {
    // The owner marked the clubhead hidden at shaft down (P6) and at the trail arm (P9).
    expect(a.checks.filter((c) => c.status === 'unknown').map((c) => [c.id, c.reason])).toEqual([
      ['clubhead_plane_down', 'hidden'], ['down_vs_takeaway', 'hidden'], ['shaft_through_ball', 'hidden'], ['through_vs_halfway', 'hidden'],
    ]);
    expect(a.main).toMatchObject({ fault: 'early_extension', position: 'impact', startsAt: 'takeaway' });
    expect(a.clubMarks.impact.source).toBe('user');
    expect(byId(a, 'hands_out_impact').status).toBe('red');
    expect(byId(a, 'clubhead_plane_takeaway')).toMatchObject({ status: 'red', dir: 'flat' });
  });

  test('a user mark replaces the proposed hands and survives as normalised coordinates', () => {
    expect(a.clubMarks.address.hands[0]).toBeCloseTo(210 / W, 6);
    expect(a.clubMarks.impact.head[1]).toBeCloseTo(511.5 / H, 6);
    expect(a.clubMarks.shaftDown.hidden).toBe(true);
    expect(a.clubMarks.shaftDown.head).toBeNull();
  });
});

describe('analyze: native clubhead seeds and approximations', () => {
  test('a confident native candidate at impact is used; a low-confidence one is a prior', () => {
    const base = analyze(native(), { pass2 });
    const f = base.checkpoints.impact.i;
    const mk = (conf) => ({ ...pass2, shaft: { [f]: { head: [274, 511], hidden: false, conf, source: 'edge' } } });
    expect(analyze(native(), { pass2: mk(0.8) }).clubMarks.impact.source).toBe('edge');
    expect(analyze(native(), { pass2: mk(0.2) }).clubMarks.impact.source).toBe('prior');
  });

  test('the clubhead gate (spec §5): a 0.05 model head at shaft down is proposed to the canvas but no check reads it', () => {
    const base = analyze(native(), { pass2 });
    const f = base.checkpoints.shaftDown.i;
    const at = (conf) => analyze(native(), { pass2: { ...pass2, shaft: { [f]: { head: [260, 430], hidden: false, conf, source: 'model' } } } });
    const weak = at(0.05);
    expect(weak.clubMarks.shaftDown).toMatchObject({ source: 'model', conf: 0.05 });
    expect(weak.clubMarks.shaftDown.head).not.toBeNull();
    expect(byId(weak, 'clubhead_plane_down')).toMatchObject({ status: 'unknown', reason: 'unplaced' });
    expect(byId(at(0.5), 'clubhead_plane_down').status).not.toBe('unknown');
  });

  test('frame-doubled slow-mo is approximate and flagged on impact checks', () => {
    const a = analyze(native(), { pass2, probe: { duplicateFrameRatio: 0.6 } });
    expect(a.approximate).toBe(true);
    expect(byId(a, 'spine_loss').approximate).toBe(true);
    expect(byId(a, 'posture_address').approximate).toBe(false);
  });

  test('capture fps from the file metadata wins over the estimate', () => {
    const a = analyze(native(), { pass2, probe: { captureFps: 240 } });
    expect(a.fps).toMatchObject({ source: 'metadata', factor: 8 });
  });

  test('an unanswered height uses the default and says so', () => {
    const a = analyze(native(), { pass2, gender: 'female' });
    expect(a.scale).toMatchObject({ heightCm: 163, approx: true });
  });
});

describe('analyze errors (D12)', () => {
  test('no golfer found', () => {
    const n = native();
    expect(analyze({ ...n, frames: n.frames.map((f) => ({ ...f, lm: null })) })).toEqual({ error: 'no_pose' });
    expect(analyze({ ...n, frames: [] })).toEqual({ error: 'no_pose' });
  });

  test('pose lost for part of the clip', () => {
    const n = native();
    const frames = n.frames.map((f, k) => (k % 3 === 0 ? { ...f, lm: null } : f));
    expect(analyze({ ...n, frames })).toEqual({ error: 'partial_pose' });
  });

  test('whole body not in frame (low visibility)', () => {
    const n = native();
    const frames = n.frames.map((f) => ({ ...f, lm: f.lm.map(([x, y]) => [x, y, 0.1]) }));
    expect(analyze({ ...n, frames })).toEqual({ error: 'partial_pose' });
  });

  test('a clip longer than 15 captured seconds', () => {
    const n = native();
    expect(analyze({ ...n, video: { ...n.video, frameCount: 9000 } })).toEqual({ error: 'too_long' });
  });

  test('every error has a message', () => {
    ['no_pose', 'partial_pose', 'too_long'].forEach((e) => expect(SWING_STRINGS.errors[e].length).toBeGreaterThan(10));
  });
});

describe('analyze: the club picks the thresholds (D19)', () => {
  const run = (club) => analyze(native(), { pass2, marks: ownerMarks(), heightCm: 176, club });

  test('no club, null, an unknown club and iron are the same iron analysis, stored as iron', () => {
    const iron = run('iron');
    expect(iron.club).toBe('iron');
    ['wood', null, undefined].forEach((c) => {
      const a = run(c);
      expect(a.club).toBe('iron');
      expect(a.checks).toEqual(iron.checks);
    });
  });

  test('driver keeps the measurements and moves the statuses the table says it moves', () => {
    const iron = run('iron');
    const driver = run('driver');
    expect(driver.club).toBe('driver');
    expect(driver.checks.map((c) => c.value)).toEqual(iron.checks.map((c) => c.value));
    expect(byId(iron, 'hands_height_impact').status).toBe('red');
    expect(byId(driver, 'hands_height_impact').status).toBe('yellow');
    expect(byId(iron, 'butt_extension').status).toBe('red');
    expect(byId(driver, 'butt_extension').status).toBe('yellow');
    expect(driver.counts.red).toBeLessThan(iron.counts.red);
  });
});

describe('analyze: where tempo starts the backswing', () => {
  const run = (marks) => analyze(native(), { pass2, marks, heightCm: 176 });
  const ratio = (a, start) => Math.round(((a.checkpoints.top.i - start) / (a.checkpoints.impact.i - a.checkpoints.top.i)) * 10) / 10;

  test('without marks, from where the grip starts to rise (not motionStart, the end of the still window)', () => {
    const a = run(undefined);
    expect(a.internal.backswingStart).toBeLessThan(a.internal.motionStart);
    expect(byId(a, 'tempo').value).toBe(ratio(a, a.internal.backswingStart));
  });

  test('a moved address frame is the start', () => {
    const auto = run(undefined);
    const frame = auto.internal.backswingStart - 20;
    const a = run({ address: { hands: null, head: null, hidden: false, frame } });
    expect(a.checkpoints.address.i).toBe(frame);
    expect(byId(a, 'tempo').value).toBe(ratio(a, frame));
    expect(byId(a, 'tempo').value).toBeGreaterThan(byId(auto, 'tempo').value);
  });
});
