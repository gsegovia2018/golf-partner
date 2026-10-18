// The mark-first pass (D25, D26): the six positions, confirmed / skipped / to do, the `marked`
// state, and the canvas operations of the editMarks draft, on the owner fixture.
import { analyze } from '../analyze';
import {
  MARKED_KEYS, AUTO_KEYS, statusFromMarks, passCounts, markedFromMarks, nextTodo, resumeKey, passDone,
} from '../markPass';
import {
  buildDraft, recompute, draftToMarks, markStatus, placeMark, setHidden, confirmMark, confirmPosition, confirmMoves,
  restorePosition, skipPosition, pendingMoves, primaryAction, chooseFrame, analyzeMarks,
} from '../editMarks';
import { placeLabels, chipWidth } from '../../components/swing/MarkCanvasParts';
import { emptyMarks, frameLabel, withFrame, marksForAnalyze, parseMarks } from '../labels';
import { CHECKPOINT_KEYS } from '../phases';
import { fixtureNative, TRUTH, W, H } from './helpers';

const lab = require('./fixtures/lab-d15-pass1.json');

const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const probe = { containerFps: 29.97, captureFps: null, duplicateFrameRatio: 0 };
const opts = { pass2: pose.pass2, probe, heightCm: 176, handedness: 'right', club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' };
const first = analyze(pose, opts);
const ctx = (marks = null, analysis = first) => ({ pose, probe, analysis, ...buildDraft(analysis, pose, marks) });
const save = (c, draft, passState) => draftToMarks({
  draft, base: c.base, live: recompute({ ...c, draft }), swingId: 's1', editedAt: 'now', passState,
});

describe('the seven marked positions (checks v2)', () => {
  test('P1, P2, P3, P4, P6, P7, P9 are marked in swing order; P10 stays automatic; P5 and P8 are not marked', () => {
    expect(MARKED_KEYS).toEqual(['address', 'takeaway', 'leadArm', 'top', 'shaftDown', 'impact', 'trailArm']);
    expect(AUTO_KEYS).toEqual(['finish']);
    // the analysis keeps all ten frames; transition and shaftThrough are found, never marked
    expect(CHECKPOINT_KEYS.filter((k) => ![...MARKED_KEYS, ...AUTO_KEYS].includes(k))).toEqual(['transition', 'shaftThrough']);
  });

  test('counts, the next position to do and where a resumed pass opens', () => {
    const st = { address: 'confirmed', leadArm: 'skipped', shaftDown: 'confirmed' };
    expect(passCounts(st)).toEqual({ confirmed: 2, skipped: 1, todo: 4 });
    expect(nextTodo(st, 'address')).toBe('takeaway');
    expect(nextTodo(st, 'top')).toBe('impact');
    expect(resumeKey(st)).toBe('takeaway');
    expect(nextTodo({
      ...st, takeaway: 'confirmed', impact: 'skipped', trailArm: 'confirmed', top: 'confirmed',
    }, 'address')).toBeNull();
  });
});

describe('marked state from marks.json', () => {
  const frame = (k, extra) => frameLabel({
    i: 1, checkpoint: k, hands: { proposed: [0, 0], final: [0, 0] }, head: { proposed: null, final: null }, ...extra,
  });

  test('a new swing is none; confirmed frames and the skipped list give partial or done', () => {
    expect(markedFromMarks({ ...emptyMarks({ swingId: 's' }), pass: { state: 'none', skipped: [] } })).toEqual({ state: 'none', count: 0 });
    const m = withFrame(withFrame(emptyMarks({ swingId: 's' }), frame('top', { confirmed: true })), frame('finish', { confirmed: true }));
    expect(statusFromMarks({ ...m, pass: { state: 'partial', skipped: ['impact'] } })).toEqual({ top: 'confirmed', finish: 'confirmed', impact: 'skipped' });
    expect(markedFromMarks({ ...m, pass: { state: 'partial', skipped: ['impact'] } })).toEqual({ state: 'partial', count: 1 }); // finish is not one of the seven
    expect(markedFromMarks({ ...m, pass: { state: 'done', skipped: [] } })).toEqual({ state: 'done', count: 1 });
    expect(passDone({ state: 'done', count: 1 })).toBe(true);
    expect(passDone(undefined)).toBe(false);
  });

  test('existing swings (no pass block): corrected frames among the seven are confirmed, partial until all seven', () => {
    const legacy = withFrame(withFrame(emptyMarks({ swingId: 's' }), frame('top', { hands: { proposed: [0, 0], final: [0.1, 0] } })), frame('impact'));
    expect(statusFromMarks(legacy)).toEqual({ top: 'confirmed' });
    expect(markedFromMarks(legacy)).toEqual({ state: 'partial', count: 1 });
    expect(markedFromMarks(null)).toEqual({ state: 'partial', count: 0 });
    const all = MARKED_KEYS.reduce((m, k) => withFrame(m, frame(k, { hands: { proposed: [0, 0], final: [0.1, 0] } })), emptyMarks({ swingId: 's' }));
    expect(markedFromMarks(all)).toEqual({ state: 'done', count: 7 });
    // a file finished under the D25 pass (with P8, without P2 / P9) stays done: its results do not disappear
    const oldSix = ['address', 'leadArm', 'top', 'shaftDown', 'impact', 'shaftThrough']
      .reduce((m, k) => withFrame(m, frame(k, { hands: { proposed: [0, 0], final: [0.1, 0] } })), emptyMarks({ swingId: 's' }));
    expect(markedFromMarks(oldSix)).toEqual({ state: 'done', count: 5 });
  });
});

describe('the canvas draft (D26)', () => {
  test('status words: proposed, moved after a drag, confirmed after Confirm, hidden, missing', () => {
    const c = ctx();
    const { draft, base } = c;
    expect(markStatus(draft, base, 'top', 'hands')).toBe('proposed');
    expect(markStatus(draft, base, 'top', 'head')).toBe('missing'); // D16: no clubhead proposed at the top
    expect(markStatus(draft, base, 'address', 'ball')).toBe('proposed');
    const moved = placeMark(draft, 'top', 'hands', [0.4, 0.3]);
    expect(markStatus(moved, base, 'top', 'hands')).toBe('moved');
    const ok = confirmMark(moved, base, 'top', 'hands');
    expect(markStatus(ok, base, 'top', 'hands')).toBe('confirmed');
    expect(markStatus(placeMark(ok, 'top', 'hands', [0.41, 0.3]), base, 'top', 'hands')).toBe('moved'); // moving again un-confirms
    expect(markStatus(setHidden(draft, 'top', true), base, 'top', 'head')).toBe('hidden');
    expect(confirmMark(draft, base, 'top', 'head')).toBe(draft); // nothing to confirm while missing
    expect(markStatus(placeMark(draft, 'address', 'ball', [0.5, 0.8]), base, 'address', 'ball')).toBe('moved');
  });

  test('Looks right confirms every mark that is there and the position; a missing clubhead stays missing', () => {
    const c = ctx();
    const d = confirmPosition(c.draft, c.base, 'top');
    expect(d.status.top).toBe('confirmed');
    expect(markStatus(d, c.base, 'top', 'hands')).toBe('confirmed');
    expect(markStatus(d, c.base, 'top', 'head')).toBe('missing');
    const a = confirmPosition(c.draft, c.base, 'address');
    expect(a.ballConfirmed).toBe(true);
  });

  test('the step-2 primary button says what it saves', () => {
    const c = ctx();
    expect(primaryAction(c.draft, c.base, 'top')).toBe('noHead');
    expect(primaryAction(placeMark(c.draft, 'top', 'head', [0.3, 0.2]), c.base, 'top')).toBe('save');
    expect(primaryAction(setHidden(c.draft, 'top', true), c.base, 'top')).toBe('looks');
  });

  test('skip and discard put the position back as it was on arrival; confirm-and-leave keeps the move', () => {
    const c = ctx();
    const snap = c.draft;
    const moved = placeMark(c.draft, 'address', 'ball', [0.5, 0.8]);
    expect(pendingMoves(moved, c.base, snap, 'address')).toBe(true);
    expect(pendingMoves(moved, c.base, snap, 'top')).toBe(false);
    expect(restorePosition(moved, snap, 'address').ball).toEqual(snap.ball);
    const skipped = skipPosition(moved, snap, 'address');
    expect(skipped.status.address).toBe('skipped');
    expect(skipped.ball).toEqual(snap.ball);
    const kept = confirmMoves(moved, c.base, 'address');
    expect(kept.ball).toEqual([0.5, 0.8, snap.ball[2]]);
    expect(pendingMoves(kept, c.base, snap, 'address')).toBe(false);
  });
});

describe('review fixes', () => {
  test('D28: choosing another frame resets that position\'s marks; the same frame keeps them; the ball stays', () => {
    const c = ctx();
    const placed = placeMark(placeMark(c.draft, 'impact', 'hands', [0.4, 0.5]), 'impact', 'head', [0.6, 0.6]);
    const ok = confirmPosition(placeMark(placed, 'address', 'ball', [0.5, 0.8]), c.base, 'impact');
    const f = ok.cps.impact.frame;
    const same = chooseFrame(ok, c.base, 'impact', f);
    expect(same.reset).toBe(false);
    expect(same.draft.cps.impact).toMatchObject({ hands: [0.4, 0.5], head: [0.6, 0.6], frameOk: true });
    const moved = chooseFrame(ok, c.base, 'impact', f + 2);
    expect(moved.reset).toBe(true);
    expect(moved.draft.cps.impact).toMatchObject({
      frame: f + 2, hands: null, head: null, hidden: false, confirmed: { hands: false, head: false }, frameOk: true,
    });
    expect(markStatus(moved.draft, c.base, 'impact', 'hands')).toBe('proposed'); // the tracked grip at f + 2
    expect(markStatus(moved.draft, c.base, 'impact', 'head')).toBe('missing');
    expect(moved.draft.ball).toEqual(ok.ball);
    expect(ok.status.impact).toBe('confirmed');
    expect(moved.draft.status.impact).toBeUndefined(); // confirmed on the old frame: to do again
    expect(same.draft.status.impact).toBe('confirmed');
    // back on the proposed frame the clubhead proposal returns
    const back = chooseFrame(moved.draft, c.base, 'impact', c.base.cps.impact.frame);
    expect(back.draft.cps.impact.head).toEqual(c.base.cps.impact.head);
    // the chosen frame is analysed there, with no clubhead read again from the old frame
    expect(analyzeMarks(moved.draft, c.base).impact).toEqual({ frame: f + 2 });
  });

  test('chips at address never overlap each other or another mark; the active one always gets its chip', () => {
    const items = [
      { m: 'hands', at: [100, 100], on: true, text: 'HANDS · PROPOSED' },
      { m: 'head', at: [112, 118], on: false, text: 'CLUBHEAD · PROPOSED' },
      { m: 'ball', at: [120, 130], on: false, text: 'BALL · PROPOSED' },
    ];
    const shapes = items.map(({ m, at }) => ({ m, at }));
    const spots = placeLabels(items, shapes, 300, 400);
    expect(spots.hands).toBeDefined();
    const rects = Object.entries(spots).map(([m, p]) => ({ x: p.x, y: p.y, w: chipWidth(items.find((i) => i.m === m).text), h: 16 }));
    rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }));
  });
});

describe('confirmed / pass persistence in marks.json (swing-club-labels/1, extended)', () => {
  test('a confirmed position is written even when nothing moved, and changes no measurement', () => {
    const c = ctx();
    const draft = confirmPosition(confirmPosition(c.draft, c.base, 'address'), c.base, 'top');
    const marks = save(c, draft, 'partial');
    expect(marks.schema).toBe('swing-club-labels/1');
    expect(parseMarks(JSON.stringify(marks))).not.toBeNull();
    const top = marks.frames.find((f) => f.checkpoint === 'top');
    expect(top).toMatchObject({ confirmed: true, corrected: false, hands: { confirmed: true }, head: { confirmed: false } });
    expect(marks.ball.confirmed).toBe(true);
    expect(marks.pass).toEqual({ state: 'partial', skipped: [] });
    expect(marksForAnalyze(marks)).toEqual({}); // only corrections feed analyze()
  });

  test('round trip: reopening rebuilds the confirmations, the skipped list and the pass state', () => {
    const c = ctx();
    let draft = confirmPosition(c.draft, c.base, 'address');
    draft = confirmPosition(placeMark(draft, 'leadArm', 'head', [0.24, 0.32]), c.base, 'leadArm');
    draft = skipPosition(draft, draft, 'top');
    const marks = save(c, draft, 'partial');
    expect(markedFromMarks(marks)).toEqual({ state: 'partial', count: 2 });
    expect(marks.pass.skipped).toEqual(['top']);
    const again = buildDraft(analyze(pose, { ...opts, marks: marksForAnalyze(marks) }), pose, marks).draft;
    expect(again.status).toEqual({ address: 'confirmed', leadArm: 'confirmed', top: 'skipped' });
    expect(again.cps.leadArm.confirmed).toEqual({ hands: true, head: true });
    expect(again.ballConfirmed).toBe(true);
  });

  test('passState defaults to done once all six are confirmed', () => {
    const c = ctx();
    const draft = MARKED_KEYS.reduce((d, k) => confirmPosition(d, c.base, k), c.draft);
    expect(save(c, draft).pass.state).toBe('done');
    expect(save(c, confirmPosition(c.draft, c.base, 'top')).pass.state).toBe('partial');
  });

  test('marks from before D26 (no pass): a corrected frame opens confirmed', () => {
    const c = ctx();
    const old = draftToMarks({
      draft: placeMark(c.draft, 'top', 'head', [0.3, 0.2]), base: c.base, live: first, swingId: 's1',
    });
    delete old.pass;
    old.frames.forEach((f) => { delete f.confirmed; delete f.hands.confirmed; delete f.head.confirmed; });
    const d = buildDraft(analyze(pose, { ...opts, marks: marksForAnalyze(old) }), pose, old).draft;
    expect(d.status).toEqual({ top: 'confirmed' });
    expect(markStatus(d, c.base, 'top', 'head')).toBe('confirmed');
  });
});
