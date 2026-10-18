import { analyze } from '../analyze';
import {
  fixtureNative, TRUTH, W, H,
} from './helpers';
import {
  STEPS, EXTRAS, openingStep, stepStatuses, stepRows, pendingSteps, mainSoFar, tagOf, neighbour, defaultRow, swipeDir, clubheadOpen,
} from '../resultsSteps';
import { placeHead } from '../placeHead';
import { markedFromMarks } from '../markPass';
import { emptyMarks, frameLabel, withFrame } from '../labels';

const lab = require('./fixtures/lab-d15-pass1.json');

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const base = {
  pass2: pose.pass2, heightCm: 176, handedness: 'right', swingId: 's1', createdAt: '2026-10-11T16:42:00.000Z',
};
const ownerMarks = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
}]));
const MARKED = analyze(pose, { ...base, marks: ownerMarks });
const UNMARKED = analyze(pose, base);

describe('results steps', () => {
  test('the seven positions plus Extras, in swing order', () => {
    expect(STEPS).toEqual(['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm', EXTRAS]);
  });

  test('opens on the main fault when the Downswing clubhead is placed or hidden', () => {
    expect(openingStep(MARKED)).toEqual({ step: MARKED.main.position, place: false });
    expect(mainSoFar(MARKED)).toBe(false);
  });

  test('opens on the Downswing in place mode while its clubhead is unplaced', () => {
    expect(pendingSteps(UNMARKED).shaftDown).toBe(true);
    expect(clubheadOpen(UNMARKED.clubMarks, 'shaftDown')).toBe(true);
    expect(openingStep(UNMARKED)).toEqual({ step: 'shaftDown', place: true });
    expect(mainSoFar(UNMARKED)).toBe(true);
  });

  test('a clubhead below the gate counts as unplaced; the golfers own mark and a hidden one do not', () => {
    const marks = (m) => ({ shaftDown: m });
    expect(clubheadOpen(marks({
      head: { x: 1, y: 1 }, source: 'model', conf: 0.05, hidden: false,
    }), 'shaftDown')).toBe(true);
    expect(clubheadOpen(marks({
      head: { x: 1, y: 1 }, source: 'model', conf: 0.9, hidden: false,
    }), 'shaftDown')).toBe(false);
    expect(clubheadOpen(marks({
      head: { x: 1, y: 1 }, source: 'user', conf: 1, hidden: false,
    }), 'shaftDown')).toBe(false);
    expect(clubheadOpen(marks({
      head: null, source: 'user', conf: 1, hidden: true,
    }), 'shaftDown')).toBe(false);
  });

  test('no fault opens on Address; an extra as the main fault opens the Extras step', () => {
    expect(openingStep({
      ...MARKED, main: null, clubMarks: {}, checks: [],
    })).toEqual({ step: 'address', place: false });
    expect(openingStep({
      ...MARKED, main: { ...MARKED.main, position: null }, clubMarks: {}, checks: [],
    })).toEqual({ step: EXTRAS, place: false });
  });

  test('statuses per step; extras never colour a position and have their own', () => {
    const st = stepStatuses(MARKED);
    expect(Object.keys(st)).toEqual(STEPS);
    expect(st[MARKED.main.position]).toBe('red');
    expect(['green', 'yellow', 'red', 'unknown']).toContain(st[EXTRAS]);
  });

  test('rows: a position lists its own, Extras lists every extra', () => {
    stepRows(MARKED.checks, 'impact').forEach((c) => {
      expect(c.position).toBe('impact');
      expect(c.extra).toBeFalsy();
    });
    const extras = stepRows(MARKED.checks, EXTRAS);
    expect(extras.length).toBeGreaterThan(0);
    extras.forEach((c) => expect(c.extra).toBe(true));
  });

  test('tags: the main fault is first, its likely start is starts', () => {
    const main = { position: 'shaftDown', startsAt: 'takeaway' };
    expect(tagOf('shaftDown', main)).toBe('first');
    expect(tagOf('takeaway', main)).toBe('starts');
    expect(tagOf('top', main)).toBeNull();
    expect(tagOf('top', null)).toBeNull();
    expect(tagOf(EXTRAS, { position: null })).toBe('first');
  });

  test('neighbour stops at both ends', () => {
    expect(neighbour('address', -1)).toBeNull();
    expect(neighbour('address', 1)).toBe('takeaway');
    expect(neighbour('trailArm', 1)).toBe(EXTRAS);
    expect(neighbour(EXTRAS, 1)).toBeNull();
  });

  test('the default row: the main evidence on its step, else the worst row; none for Extras', () => {
    const row = defaultRow(MARKED.checks, MARKED.main.position, MARKED.main);
    expect(row.position).toBe(MARKED.main.position);
    expect(defaultRow(MARKED.checks, EXTRAS, MARKED.main)).toBeNull();
    const rows = stepRows(MARKED.checks, 'address');
    const worst = ['red', 'yellow'].find((s) => rows.some((c) => c.status === s));
    const at = defaultRow(MARKED.checks, 'address', MARKED.main);
    if (worst) expect(at.status).toBe(worst);
    else expect(at).toBe(rows[0]);
  });

  test('a swipe: left is next, right is previous, short or mostly vertical is nothing', () => {
    expect(swipeDir(-80, 5)).toBe(1);
    expect(swipeDir(80, -5)).toBe(-1);
    expect(swipeDir(-30, 0)).toBe(0);
    expect(swipeDir(-60, 70)).toBe(0);
  });
});

describe('placeHead', () => {
  const done = { ...emptyMarks({ swingId: 's1' }), pass: { state: 'done', skipped: [] } };
  const ownerLabels = Object.entries(TRUTH.checkpoints)
    .reduce((m, [k, c]) => withFrame(m, frameLabel({
      i: c.frame, checkpoint: k, hands: { proposed: null, final: norm(c.hands), placed: true }, head: { proposed: null, final: c.hidden ? null : norm(c.head), finalHidden: c.hidden },
    })), done);
  const stored = {
    analysis: UNMARKED, pose, probe: null, marks: done,
  };
  const tap = [0.6, 0.62]; // the owner marked this head hidden: any point will do

  test('a tap on the Downswing places the head, reads it as the golfers and keeps the pass done', () => {
    expect(pendingSteps(UNMARKED).shaftDown).toBe(true);
    const out = placeHead(stored, 'shaftDown', tap);
    expect(out).not.toBeNull();
    expect(out.analysis.clubMarks.shaftDown.source).toBe('user');
    expect(out.analysis.clubMarks.shaftDown.head).toBeTruthy();
    expect(pendingSteps(out.analysis).shaftDown).toBeUndefined();
    expect(markedFromMarks(out.marks).state).toBe('done');
    const label = out.marks.frames.find((f) => f.checkpoint === 'shaftDown');
    expect(label.head.confirmed).toBe(true);
    expect(label.head.final).toEqual(tap);
    const row = out.analysis.checks.find((c) => c.position === 'shaftDown' && c.id === 'clubhead_plane_down');
    expect(row.status).not.toBe('unknown');
  });

  test('confirming the proposed dot (no point) needs a proposal; an unknown position is refused', () => {
    expect(placeHead(stored, 'shaftDown', null)).toBeNull();
    expect(placeHead(stored, 'nowhere', [0.5, 0.5])).toBeNull();
  });

  test('only the placed position changes: every other label stays byte for byte, even on an older swing whose frames moved', () => {
    const fa = UNMARKED.checkpoints.address.i;
    const ft = UNMARKED.checkpoints.takeaway.i;
    // older labels: the golfer chose frames other than the ones pass 2 proposed (333 -> 325 style), a stale proposal beside them
    let m = { ...done, ball: { proposed: [0.1, 0.2, 0.01], final: [0.1, 0.2, 0.01], confirmed: true } };
    m = withFrame(m, frameLabel({
      i: fa - 8, iProposed: fa, checkpoint: 'address', hands: { proposed: [0.3, 0.4], final: [0.31, 0.41], placed: true, confirmed: true }, head: { proposed: null, final: null, finalHidden: true }, confirmed: true, confirmedFrame: true, editedAt: 'then',
    }));
    m = withFrame(m, frameLabel({
      i: ft + 4, iProposed: ft, checkpoint: 'takeaway', hands: { proposed: [0.3, 0.4], final: [0.3, 0.4], placed: false }, head: { proposed: [0.2, 0.2], final: [0.2, 0.2], proposedSource: 'model', proposedConf: 0.4 }, editedAt: 'then',
    }));
    const stored = JSON.parse(JSON.stringify(m));
    const out = placeHead({
      analysis: UNMARKED, pose, probe: null, marks: m,
    }, 'shaftDown', [0.6, 0.62]);
    expect(out).not.toBeNull();
    ['address', 'takeaway'].forEach((k) => {
      expect(JSON.stringify(out.marks.frames.find((f) => f.checkpoint === k))).toBe(JSON.stringify(stored.frames.find((f) => f.checkpoint === k)));
    });
    expect(out.marks.frames.map((f) => f.checkpoint).sort()).toEqual(['address', 'shaftDown', 'takeaway']);
    expect(out.marks.ball).toEqual(stored.ball);
    expect(out.marks.pass).toEqual(stored.pass);
    expect(out.marks.frames.find((f) => f.checkpoint === 'shaftDown').head.confirmed).toBe(true);
  });

  test('re-placing on a swing the owner marked moves the head and re-reads', () => {
    const out = placeHead({
      analysis: MARKED, pose, probe: null, marks: ownerLabels,
    }, 'impact', norm(TRUTH.checkpoints.impact.head));
    expect(out.analysis.clubMarks.impact.source).toBe('user');
  });
});
