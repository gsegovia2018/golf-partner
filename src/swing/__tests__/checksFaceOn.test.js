// Face-on checks (plan 2026-10-30 §4) on a tiny synthetic swing: 1 px = 1 cm, a 217.4 cm golfer (so a
// shoulder width, 0.23 of the height, is 50 cm), a
// right-hander filmed from the front, target to the right of the picture (+x). Frames: address 1,
// top 2, downswing 3, impact 4, finish 5. Each test moves the landmarks its row reads.
import { runFaceOnChecks, targetDir, THRESHOLDS_FO } from '../checksFaceOn';
import { LM } from '../geometry';

const blank = () => Array.from({ length: 33 }, () => [0, 0, 1]);
const pt = (x, y) => ({ x, y });
const mark = (frame, hands, head = null, extra = {}) => ({ frame, hands, head, hidden: false, source: 'user', ...extra });

// Address: ankles 170 (trail) / 230 (lead), shoulders 175 / 225 (span 1.2x), hips 188 / 212,
// shoulders' middle 4 px behind the hips' (about 4 deg away from the target), ball at 205 (58 %).
const BASE = {
  [LM.rAnk]: [170, 190], [LM.lAnk]: [230, 190],
  [LM.rSh]: [171, 40], [LM.lSh]: [221, 40],
  [LM.rHip]: [188, 100], [LM.lHip]: [212, 100],
  [LM.nose]: [195, 10],
};
const BALL = pt(205, 190);
const CPS = {
  address: mark(1, pt(200, 110)),
  top: mark(2, pt(150, 0)),
  shaftDown: mark(3, pt(170, 90)),
  impact: mark(4, pt(215, 112), pt(205, 188)),
  finish: mark(5, pt(250, 20)),
};
// Per-frame overrides on top of BASE; the downswing and the finish shift the hips by default.
const FRAMES = {
  1: {},
  2: {},
  3: { [LM.rHip]: [198, 100], [LM.lHip]: [222, 100] },
  4: { [LM.rHip]: [196, 100], [LM.lHip]: [222, 100], [LM.nose]: [196, 10] },
  5: { [LM.rHip]: [214, 100], [LM.lHip]: [238, 100], [LM.nose]: [232, 10] },
};

function poseFor(over = {}, flip = null) {
  return (f) => {
    const lm = blank();
    const pts = { ...BASE, ...FRAMES[f], ...(over[f] || {}) };
    // the head rows read the ears' middle: put the ears either side of the nose unless a test sets them
    const [nx, ny] = pts[LM.nose];
    if (!pts[LM.lEar]) pts[LM.lEar] = [nx + 6, ny];
    if (!pts[LM.rEar]) pts[LM.rEar] = [nx - 6, ny];
    Object.entries(pts).forEach(([i, p]) => { lm[i] = [flip ? flip - p[0] : p[0], p[1], 1]; });
    return lm;
  };
}
const flipPt = (p, w) => pt(w - p.x, p.y);
function run({ over = {}, cps = CPS, ball = BALL, club = 'iron', flip = null, handedness = 'right', ...extra } = {}) {
  const c = flip ? Object.fromEntries(Object.entries(cps).map(([k, m]) => [k, { ...m, hands: flipPt(m.hands, flip), head: m.head && flipPt(m.head, flip) }])) : cps;
  return runFaceOnChecks({
    checkpoints: c, ball: ball && flip ? flipPt(ball, flip) : ball, pose: poseFor(over, flip), handedness, club, pxPerCm: 1, heightCm: 217.4, finishQuietS: 1, ...extra,
  });
}
const one = (out, id) => out.checks.find((c) => c.id === id);

describe('direction', () => {
  test('the hands going back at the top set the target side; a flipped video reads the same', () => {
    expect(run().dir).toBe(1);
    const flipped = run({ flip: 400 });
    expect(flipped.dir).toBe(-1);
    const strip = (o) => o.checks.map(({ id, status, value }) => ({ id, status, value }));
    expect(strip(flipped)).toEqual(strip(run()));
  });
  test('hands that barely move fall back to the handedness', () => {
    const still = { ...CPS, top: mark(2, pt(198, 108)) }; // 2 cm from the middle of the feet
    expect(targetDir(poseFor(), still, 'right', 217.4)).toBe(1);
    expect(targetDir(poseFor(), still, 'left', 217.4)).toBe(-1);
  });
});

describe('a sound swing is green everywhere', () => {
  test('every position row and both extras are measured and green (iron)', () => {
    const out = run({ motionStart: 0 });
    const bad = out.checks.filter((c) => c.status !== 'green' && c.id !== 'tempo');
    expect(bad.map((c) => `${c.id}:${c.status}:${c.value}`)).toEqual([]);
    expect(new Set(out.checks.filter((c) => !c.extra).map((c) => c.position))).toEqual(new Set(['address', 'top', 'shaftDown', 'impact', 'finish']));
  });
});

describe('address', () => {
  test('stance: ankle span over shoulder width, per club', () => {
    expect(one(run(), 'fo_stance')).toMatchObject({ status: 'green', value: 1.2, fault: 'stance_width' });
    const narrow = run({ over: { 1: { [LM.rAnk]: [182, 190], [LM.lAnk]: [218, 190] } } });
    expect(one(narrow, 'fo_stance')).toMatchObject({ status: 'red', value: 0.72, dir: 'narrow' });
    // 1.2x is narrow for a driver (1.1-1.5 green): still green, but 1.0 is yellow there
    const tight = run({ club: 'driver', over: { 1: { [LM.rAnk]: [175, 190], [LM.lAnk]: [225, 190] } } });
    expect(one(tight, 'fo_stance')).toMatchObject({ status: 'yellow', dir: 'narrow' });
  });
  test('ball position: share of the stance from the trail ankle; a driver wants it forward', () => {
    expect(one(run(), 'fo_ball_pos')).toMatchObject({ status: 'green', value: 58, fault: 'ball_position' });
    expect(one(run({ club: 'driver' }), 'fo_ball_pos')).toMatchObject({ status: 'red', dir: 'back' });
    expect(one(run({ club: 'driver', ball: pt(222, 190) }), 'fo_ball_pos')).toMatchObject({ status: 'green', value: 87 });
    expect(one(run({ ball: null }), 'fo_ball_pos')).toMatchObject({ status: 'unknown', reason: 'nodata' });
    // a 'ball' far outside the stance is not the golfer's ball: no ball, not a fault
    expect(one(run({ ball: pt(90, 190) }), 'fo_ball_pos')).toMatchObject({ status: 'unknown', reason: 'nodata' });
    expect(one(run({ ball: pt(90, 190) }), 'fo_head_behind')).toMatchObject({ status: 'unknown', reason: 'nodata' });
  });
  test('setup tilt: + = shoulders behind the hips', () => {
    expect(one(run(), 'fo_setup_tilt')).toMatchObject({ status: 'green', value: 4, fault: 'posture' });
    const toward = run({ over: { 1: { [LM.rSh]: [185, 40], [LM.lSh]: [235, 40] } } });
    expect(one(toward, 'fo_setup_tilt')).toMatchObject({ status: 'red', value: -9 });
  });
});

describe('top', () => {
  test('sway: the trail hip past the trail ankle', () => {
    expect(one(run(), 'fo_sway')).toMatchObject({ status: 'green', fault: 'sway', position: 'top' });
    const out = (x) => one(run({ over: { 2: { [LM.rHip]: [x, 100] } } }), 'fo_sway');
    expect(out(165)).toMatchObject({ status: 'yellow', value: 5 });
    expect(out(161)).toMatchObject({ status: 'red', value: 9 });
    expect(out(161).text).toMatch(/outside the trail foot/);
  });
  test('head: sideways either way, driver gets more room', () => {
    const head = (x, club) => one(run({ club, over: { 2: { [LM.nose]: [x, 10] } } }), 'fo_head_top');
    expect(head(189).status).toBe('yellow'); // 6 cm back
    expect(head(189, 'driver').status).toBe('green');
    expect(head(207).status).toBe('red'); // 12 cm toward the target
  });
});

describe('downswing', () => {
  test('hips shift toward the target from the top: 5 cm is green, 2 yellow, less red', () => {
    expect(one(run(), 'fo_hips_shift')).toMatchObject({ status: 'green', value: 10, fault: 'hanging_back' });
    const short = run({ over: { 3: { [LM.rHip]: [191, 100], [LM.lHip]: [215, 100] } } });
    expect(one(short, 'fo_hips_shift')).toMatchObject({ status: 'yellow', value: 3 });
    const stuck = run({ over: { 3: { [LM.rHip]: [188, 100], [LM.lHip]: [212, 100] } } });
    expect(one(stuck, 'fo_hips_shift')).toMatchObject({ status: 'red', value: 0 });
  });
  test('head stays back: past its address spot toward the target is a fault', () => {
    const fwd = run({ over: { 3: { [LM.nose]: [204, 10] } } });
    expect(one(fwd, 'fo_head_back')).toMatchObject({ status: 'yellow', value: 9, fault: 'head_sway' });
    expect(one(run({ over: { 3: { [LM.nose]: [210, 10] } } }), 'fo_head_back')).toMatchObject({ status: 'red', value: 15 });
  });
});

describe('impact', () => {
  test('hands against the ball: behind = scoop, far ahead = excess lean; the driver meets it level', () => {
    const ahead = (hands, club) => one(run({ club, cps: { ...CPS, impact: mark(4, hands) } }), 'fo_hands_ahead');
    expect(ahead(pt(215, 112))).toMatchObject({ status: 'green', value: 10, dir: null });
    expect(ahead(pt(200, 112))).toMatchObject({ status: 'red', value: -5, fault: 'scoop', dir: 'back' });
    expect(ahead(pt(235, 112))).toMatchObject({ status: 'red', value: 30, fault: 'excess_lean', dir: 'forward' });
    expect(ahead(pt(205, 112), 'driver')).toMatchObject({ status: 'green', value: 0 });
  });
  test('no row waits for a clubhead face-on', () => {
    const noHead = run({ cps: Object.fromEntries(Object.entries(CPS).map(([k, m]) => [k, { ...m, head: null, source: 'prior' }])) });
    expect(noHead.checks.filter((c) => c.reason === 'unplaced' || c.reason === 'hidden')).toEqual([]);
    expect(one(noHead, 'fo_hands_ahead').status).toBe('green');
  });
  test('hips moved to the target by impact', () => {
    expect(one(run(), 'fo_hips_impact')).toMatchObject({ status: 'green', value: 9, fault: 'hanging_back' });
    const stayed = run({ over: { 4: { [LM.rHip]: [189, 100], [LM.lHip]: [213, 100] } } });
    expect(one(stayed, 'fo_hips_impact')).toMatchObject({ status: 'red', value: 1 });
  });
  test('slide: the lead hip past the lead ankle', () => {
    const slid = run({ over: { 4: { [LM.lHip]: [237, 100] } } });
    expect(one(slid, 'fo_slide')).toMatchObject({ status: 'yellow', value: 7, fault: 'slide' });
  });
  test('head behind the ball, and its drop since address', () => {
    expect(one(run(), 'fo_head_behind')).toMatchObject({ status: 'green', value: 9 });
    const ahead = run({ over: { 4: { [LM.nose]: [212, 10] } } });
    expect(one(ahead, 'fo_head_behind')).toMatchObject({ status: 'red', value: -7 });
    const dip = run({ over: { 4: { [LM.nose]: [196, 16] } } });
    expect(one(dip, 'fo_head_dip')).toMatchObject({ status: 'yellow', value: 6, fault: 'head_dip' });
  });
  test('impact rows inherit approximate; the address rows do not', () => {
    const out = run({ approximate: true });
    expect(one(out, 'fo_slide').approximate).toBe(true);
    expect(one(out, 'fo_stance').approximate).toBe(false);
  });
});

describe('finish', () => {
  test('weight: the pelvis share of the way to the lead ankle', () => {
    expect(one(run(), 'fo_finish_weight')).toMatchObject({ status: 'green', value: 93 });
    const back = run({ over: { 5: { [LM.rHip]: [196, 100], [LM.lHip]: [220, 100] } } });
    expect(one(back, 'fo_finish_weight')).toMatchObject({ status: 'red', value: 63, fault: 'hanging_back' });
  });
  test('head over the lead foot at the finish', () => {
    expect(one(run(), 'fo_finish_head')).toMatchObject({ status: 'green', fault: 'hanging_back' });
    const back = run({ over: { 5: { [LM.nose]: [200, 10] } } });
    expect(one(back, 'fo_finish_head')).toMatchObject({ status: 'red', value: 30 });
    // a driver finishes with the head further back
    expect(one(run({ club: 'driver', over: { 5: { [LM.nose]: [200, 10] } } }), 'fo_finish_head')).toMatchObject({ status: 'yellow', value: 30 });
  });
  test('balance extra reads the same face-on sides', () => {
    expect(one(run(), 'finish_balance')).toMatchObject({ status: 'green', extra: true });
    expect(one(run({ finishQuietS: 0.1 }), 'finish_balance').status).toBe('yellow');
  });
});

test('every club has every limit', () => {
  expect(Object.keys(THRESHOLDS_FO.driver).sort()).toEqual(Object.keys(THRESHOLDS_FO.iron).sort());
});
