import { analyze, SCHEMA } from '../analyze';
import { SWING_STRINGS } from '../strings';
import { fixtureNative, TRUTH, W, H } from './helpers';

const lab = require('./fixtures/lab-d15-pass1.json');

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const native = (extra = {}) => fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame, ...extra });
const pass2 = { addressFrame: lab.expected.addressFrame, shaft: {} };
const ownerMarks = () => {
  const out = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
    hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
  }]));
  out.preImpact = { hands: norm({ x: 222, y: 400 }), head: norm({ x: 240, y: 470 }), hidden: false };
  return out;
};
const byId = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp));

describe('analyze: the whole pipeline on the fixture', () => {
  const a = analyze(native(), { pass2, handedness: 'right', heightCm: 176, club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' });

  test('shape of analysis.json (schema swing-analysis/1)', () => {
    expect(a.error).toBeUndefined();
    expect(a.schema).toBe(SCHEMA);
    expect(a).toMatchObject({ swingId: 's1', club: 'iron', handedness: 'right', view: 'dtl', source: 'import' });
    expect(a.fps).toMatchObject({ factor: 8, source: 'estimate', approximate: false });
    expect(a.scale.approx).toBe(false);
    expect(a.scale.pxPerCm).toBeGreaterThan(1.1);
    expect(Object.keys(a.checkpoints)).toEqual(['address', 'takeaway', 'leadArm', 'top', 'transition', 'shaftDown', 'impact', 'trailArm', 'finish']);
    expect(Object.keys(a.clubMarks)).toHaveLength(12);
    expect(a.reference.ball).toEqual([ball.x, ball.y]);
    expect(Math.abs(a.reference.shaftPlaneDeg - 52)).toBeLessThanOrEqual(6);
  });

  test('all 15 rows produce a status; counts add up', () => {
    expect(a.checks).toHaveLength(15);
    a.checks.forEach((c) => expect(['green', 'yellow', 'red', 'unknown']).toContain(c.status));
    const c = a.counts;
    expect(c.green + c.yellow + c.red + c.unknown).toBe(15);
  });

  test('D16: without placed marks the club-dependent checks are unknown, the rest are measured', () => {
    ['butt_extension', 'top_direction', 'shaft_angle_impact'].forEach((id) => expect(byId(a, id).status).toBe('unknown'));
    expect(a.checks.filter((c) => c.id === 'clubhead_vs_plane').every((c) => c.status === 'unknown')).toBe(true);
    expect(byId(a, 'spine_loss').status).not.toBe('unknown');
    expect(a.clubMarks.address.source).toBe('prior');
    expect(a.clubMarks.address.priorHead).toBeDefined();
    expect(a.clubMarks.top.priorHead).toBeUndefined();
  });

  test('main fault is early extension with evidence and drills', () => {
    expect(a.main.fault).toBe('early_extension');
    expect(a.main.evidence.length).toBeGreaterThanOrEqual(2);
    expect(a.main.drills).toEqual(['ee-silla', 'ee-pared', 'ee-palo-talones']);
  });
});

describe('analyze with the owner marks as user marks (golden)', () => {
  const a = analyze(native(), { pass2, marks: ownerMarks(), heightCm: 176 });

  test('every club check has a verdict and the early-extension story holds', () => {
    expect(a.checks.filter((c) => c.status === 'unknown').map((c) => c.id)).toEqual([]);
    expect(a.main.fault).toBe('early_extension');
    expect(a.clubMarks.impact.source).toBe('user');
    expect(byId(a, 'hands_out_impact').status).toBe('red');
    expect(byId(a, 'clubhead_vs_plane', 'impact').status).toBe('green');
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
