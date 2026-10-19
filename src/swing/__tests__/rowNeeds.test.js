import { analyze } from '../analyze';
import {
  fixtureNative, TRUTH, W, H,
} from './helpers';
import {
  rowNeeds, unlockedBy, askAt, ballMissing,
} from '../rowNeeds';
import { openingStep } from '../resultsSteps';
import { placeHead } from '../placeHead';
import { markedFromMarks, statusFromMarks } from '../markPass';
import { emptyMarks, frameLabel, withFrame } from '../labels';

const lab = require('./fixtures/lab-d15-pass1.json');

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const base = {
  pass2: { addressFrame: lab.expected.addressFrame, shaft: {} }, heightCm: 176, handedness: 'right', swingId: 's1', createdAt: 'x',
};
const WITH_BALL = analyze(fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), base);
const NO_BALL = analyze(fixtureNative({ ballGoneFrame: lab.expected.ballGoneFrame }), base);
const row = (a, id) => a.checks.find((c) => c.id === id);
const names = (needs) => needs.map((n) => `${n.kind}:${n.cp}`);

describe('what a row is still waiting for', () => {
  test('the fixtures: one swing has a ball, the other has none (no address plane)', () => {
    expect(ballMissing(WITH_BALL)).toBe(false);
    expect(ballMissing(NO_BALL)).toBe(true);
  });

  test('with the ball, the Downswing plane row needs only its clubhead; vs-takeaway needs both heads', () => {
    expect(names(rowNeeds(WITH_BALL, row(WITH_BALL, 'clubhead_plane_down')))).toEqual(['clubhead:shaftDown']);
    expect(unlockedBy(WITH_BALL, row(WITH_BALL, 'clubhead_plane_down'), 'shaftDown')).toBe(true);
    expect(names(rowNeeds(WITH_BALL, row(WITH_BALL, 'down_vs_takeaway'))).sort()).toEqual(['clubhead:shaftDown', 'clubhead:takeaway']);
    expect(unlockedBy(WITH_BALL, row(WITH_BALL, 'down_vs_takeaway'), 'shaftDown')).toBe(false);
  });

  test('without the ball the same row also needs the ball, and no clubhead alone unlocks it', () => {
    const r = row(NO_BALL, 'clubhead_plane_down');
    expect(names(rowNeeds(NO_BALL, r))).toEqual(['clubhead:shaftDown', 'ball:address']);
    expect(unlockedBy(NO_BALL, r, 'shaftDown')).toBe(false);
  });

  test('a placed halfway-back clubhead with no ball: the row asks for the ball instead of reading "hidden"', () => {
    const c = TRUTH.checkpoints.leadArm;
    const marks = { leadArm: { hands: norm(c.hands), head: norm(c.head), hidden: false } };
    const a = analyze(fixtureNative({ ballGoneFrame: lab.expected.ballGoneFrame }), { ...base, marks });
    const r = row(a, 'butt_extension');
    expect(r).toMatchObject({ status: 'unknown', reason: 'nodata' });
    expect(names(rowNeeds(a, r))).toEqual(['ball:address']);
    expect(askAt(a, 'leadArm')).toEqual({ kind: 'ball', cp: 'address' });
  });

  test('a measured row or a spine row needs nothing', () => {
    WITH_BALL.checks.filter((c) => c.status !== 'unknown').forEach((c) => expect(rowNeeds(WITH_BALL, c)).toEqual([]));
  });

  test('what to ask at the Downswing: its clubhead when that unlocks a row; the ball when the plane is missing', () => {
    expect(askAt(WITH_BALL, 'shaftDown')).toEqual({ kind: 'clubhead', cp: 'shaftDown' });
    expect(askAt(NO_BALL, 'shaftDown')).toEqual({ kind: 'ball', cp: 'address' });
    expect(askAt(WITH_BALL, 'impact')).toBeNull(); // nothing to wait for there
  });

  test('the opening rule: place mode only when placing the Downswing clubhead lets a row compute', () => {
    expect(openingStep(WITH_BALL)).toEqual({ step: 'shaftDown', place: true });
    expect(openingStep(NO_BALL)).toEqual({ step: 'shaftDown', place: false });
  });
});

describe('placing on a swing marked before the pass existed (marks.json without `pass`)', () => {
  // the six-position pass of an older swing: corrected frames are its confirmations; the frames differ from the proposed ones
  let legacy = emptyMarks({ swingId: 's1' });
  ['address', 'leadArm', 'top', 'impact'].forEach((k) => {
    const c = TRUTH.checkpoints[k];
    legacy = withFrame(legacy, frameLabel({
      i: c.frame + 1, iProposed: c.frame, checkpoint: k, hands: { proposed: norm(c.hands), final: norm(c.hands), placed: true }, head: { proposed: null, final: null, finalHidden: true },
    }));
  });
  const pose = fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame });

  test('the unconfirmed count does not move, and the file stays a pass-less one', () => {
    const before = markedFromMarks(legacy);
    expect(legacy.pass).toBeUndefined();
    const out = placeHead({
      analysis: WITH_BALL, pose: { ...pose, pass2: base.pass2 }, probe: null, marks: legacy,
    }, 'shaftDown', [0.6, 0.6]);
    expect(out.marks.pass).toBeUndefined();
    const after = markedFromMarks(out.marks);
    expect(after.count).toBeGreaterThanOrEqual(before.count);
    expect(Object.keys(statusFromMarks(out.marks))).toEqual(expect.arrayContaining(Object.keys(statusFromMarks(legacy))));
  });

  test('a file that has a pass keeps it exactly', () => {
    const withPass = { ...legacy, pass: { state: 'done', skipped: ['top'] } };
    const out = placeHead({
      analysis: WITH_BALL, pose: { ...pose, pass2: base.pass2 }, probe: null, marks: withPass,
    }, 'shaftDown', [0.6, 0.6]);
    expect(out.marks.pass).toEqual({ state: 'done', skipped: ['top'] });
  });
});
