// The Edit marks model on the owner fixture: draft, live recompute, marks.json round trip.
import { analyze } from '../analyze';
import {
  buildDraft, analyzeMarks, recompute, draftToMarks, isDirty, resetCheckpoint, patchCheckpoint, hitTest,
  liveChecks, pillCheck, clampPt,
} from '../editMarks';
import { marksForAnalyze } from '../labels';
import { cueFor, CHECKPOINT_DEFS, HOW_TO_MARK, timelineStep } from '../checkpoints';
import { fixtureNative, TRUTH, W, H } from './helpers';

const lab = require('./fixtures/lab-d15-pass1.json');

const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const probe = { containerFps: 29.97, captureFps: null, duplicateFrameRatio: 0 };
const base0 = { pass2: pose.pass2, probe, heightCm: 176, handedness: 'right', club: 'iron', source: 'import', swingId: 's1', createdAt: 'x' };
const first = analyze(pose, base0); // what the results screen opens with: nothing placed yet
const byId = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp));
const ctx = (analysis, marks = null) => ({ pose, probe, analysis, ...buildDraft(analysis, pose, marks) });

describe('buildDraft / recompute', () => {
  test('an untouched draft recomputes to the stored analysis and produces no marks', () => {
    const c = ctx(first);
    expect(analyzeMarks(c.draft, c.base)).toEqual({});
    const live = recompute(c);
    expect(live.checks.map((x) => [x.id, x.status, x.value])).toEqual(first.checks.map((x) => [x.id, x.status, x.value]));
    expect(isDirty(c.draft, c.draft)).toBe(false);
  });

  test('D16: placing the lead-arm clubhead turns butt_extension from unknown into a measurement', () => {
    const c = ctx(first);
    expect(byId(first, 'butt_extension').status).toBe('unknown');
    const draft = patchCheckpoint(c.draft, 'leadArm', { head: [0.24, 0.32] });
    const live = recompute({ ...c, draft });
    expect(byId(live, 'butt_extension').status).not.toBe('unknown');
    // nothing else changed
    expect(byId(live, 'spine_loss').value).toBe(byId(first, 'spine_loss').value);
    expect(byId(live, 'top_direction').status).toBe('unknown');
    expect(live.clubMarks.leadArm.source).toBe('user');
  });

  test('moving the clubhead changes clubhead_vs_plane', () => {
    const c = ctx(first);
    const near = recompute({ ...c, draft: patchCheckpoint(c.draft, 'impact', { head: [273 / W, 505 / H] }) });
    const far = recompute({ ...c, draft: patchCheckpoint(c.draft, 'impact', { head: [330 / W, 505 / H] }) });
    const a = byId(near, 'clubhead_vs_plane', 'impact');
    const b = byId(far, 'clubhead_vs_plane', 'impact');
    expect(a.status).not.toBe('unknown');
    expect(a.value).not.toBe(b.value);
  });

  test('hidden is a decision: the check says hidden rather than unplaced', () => {
    const c = ctx(first);
    const live = recompute({ ...c, draft: patchCheckpoint(c.draft, 'top', { hidden: true }) });
    expect(byId(live, 'top_direction').status).toBe('unknown');
    expect(byId(live, 'top_direction').reason).toBe('hidden');
    expect(live.clubMarks.top.hidden).toBe(true);
  });

  test('Set checkpoint to this frame moves the checkpoint, its internal frames and the automatic hands', () => {
    const c = ctx(first);
    const was = first.checkpoints.impact.i;
    const live = recompute({ ...c, draft: patchCheckpoint(c.draft, 'impact', { frame: was + 2 }) });
    expect(live.checkpoints.impact.i).toBe(was + 2);
    expect(live.internal.preImpact).toBe(first.internal.preImpact + 2);
    expect(live.internal.postImpact).toBe(first.internal.postImpact + 2);
    expect(live.clubMarks.impact.hands).not.toEqual(first.clubMarks.impact.hands); // the grip at the new frame
  });

  test('a hands-only correction keeps the club as proposed', () => {
    const c = ctx(first);
    const live = recompute({ ...c, draft: patchCheckpoint(c.draft, 'leadArm', { hands: [0.3, 0.4] }) });
    expect(live.clubMarks.leadArm.hands).toEqual([0.3, 0.4]);
    expect(live.clubMarks.leadArm.source).toBe('prior'); // still unplaced, not silently "hidden"
    expect(live.clubMarks.leadArm.hidden).toBe(false);
  });

  test('the ball mark moves the planes', () => {
    const c = ctx(first);
    const live = recompute({ ...c, draft: { ...c.draft, ball: [ball.x + 0.02, ball.y, ball.r] } });
    expect(live.reference.ball[0]).toBeCloseTo(ball.x + 0.02);
    expect(live.reference.shaftPlaneDeg).not.toBeCloseTo(first.reference.shaftPlaneDeg, 1);
  });
});

describe('marks.json', () => {
  const edited = () => {
    const c = ctx(first);
    let draft = patchCheckpoint(c.draft, 'leadArm', { head: [0.24, 0.32] });
    draft = patchCheckpoint(draft, 'top', { hidden: true });
    draft = patchCheckpoint(draft, 'impact', { frame: first.checkpoints.impact.i + 1, head: [0.58, 0.6] });
    draft = { ...draft, ball: [ball.x + 0.01, ball.y, ball.r] };
    const live = recompute({ ...c, draft });
    const marks = draftToMarks({ draft, base: c.base, live, swingId: 's1', video: { width: W, height: H }, editedAt: 'now' });
    return { c, draft, live, marks };
  };

  test('only corrected frames are written, with proposed and final side by side and the corrected flags', () => {
    const { marks } = edited();
    expect(marks.frames.map((f) => f.checkpoint).sort()).toEqual(['impact', 'leadArm', 'top']);
    const lead = marks.frames.find((f) => f.checkpoint === 'leadArm');
    expect(lead).toMatchObject({ corrected: true, editedAt: 'now' });
    expect(lead.head.proposed).toBeNull();
    expect(lead.head.final).toEqual([0.24, 0.32]);
    const top = marks.frames.find((f) => f.checkpoint === 'top');
    expect(top.head).toMatchObject({ finalHidden: true, final: null });
    const impact = marks.frames.find((f) => f.checkpoint === 'impact');
    expect(impact.i).toBe(first.checkpoints.impact.i + 1);
    expect(impact.iProposed).toBe(first.checkpoints.impact.i);
    expect(marks.ball.corrected).toBe(true);
    expect(marks.ball.proposed).toEqual([ball.x, ball.y, ball.r]);
  });

  test('a frame-only change is a correction too', () => {
    const c = ctx(first);
    const draft = patchCheckpoint(c.draft, 'finish', { frame: first.checkpoints.finish.i + 3 });
    const live = recompute({ ...c, draft });
    const marks = draftToMarks({ draft, base: c.base, live, swingId: 's1' });
    expect(marks.frames.map((f) => f.checkpoint)).toEqual(['finish']);
    expect(marksForAnalyze(marks).finish.frame).toBe(first.checkpoints.finish.i + 3);
  });

  test('saved marks re-applied by analyze() give the same result, and reopening rebuilds the same draft', () => {
    const { c, draft, live, marks } = edited();
    const again = analyze(pose, { ...base0, marks: marksForAnalyze(marks), ball: marks.ball.final });
    expect(again.checks.map((x) => [x.id, x.cp, x.status, x.value])).toEqual(live.checks.map((x) => [x.id, x.cp, x.status, x.value]));
    const reopened = buildDraft(again, pose, marks);
    expect(reopened.draft.cps.leadArm.head).toEqual(draft.cps.leadArm.head);
    expect(reopened.draft.cps.top.hidden).toBe(true);
    expect(reopened.draft.cps.impact.frame).toBe(draft.cps.impact.frame);
    expect(reopened.draft.ball).toEqual(draft.ball);
    // proposals survive the round trip: Reset still goes back to what analyze() first proposed
    expect(reopened.base.cps.impact.frame).toBe(c.base.cps.impact.frame);
    expect(reopened.base.ball).toEqual(c.base.ball);
    const round = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)); // px round trip noise
    expect(round(analyzeMarks(reopened.draft, reopened.base))).toEqual(round(analyzeMarks(draft, c.base)));
  });

  test('Reset checkpoint to auto restores the proposal, and the ball at address', () => {
    const { c, draft } = edited();
    const r = resetCheckpoint(resetCheckpoint(draft, c.base, 'impact'), c.base, 'address');
    expect(r.cps.impact).toEqual({
      frame: c.base.cps.impact.frame, hands: null, head: c.base.cps.impact.head, hidden: false, confirmed: { hands: false, head: false },
    });
    expect(r.ball).toEqual(c.base.ball);
    expect(r.cps.leadArm.head).toEqual([0.24, 0.32]); // other checkpoints untouched
  });
});

describe('helpers', () => {
  test('hitTest picks the nearest handle inside 28 px and prefers the active target on a tie', () => {
    const h = { hands: [100, 100], head: [130, 100], ball: null };
    expect(hitTest([104, 100], h)).toBe('hands');
    expect(hitTest([128, 102], h)).toBe('head');
    expect(hitTest([115, 100], h, 'head')).toBe('head');
    expect(hitTest([115, 100], h, 'hands')).toBe('hands');
    expect(hitTest([300, 300], h)).toBeNull();
    expect(hitTest([100, 100], { hands: null, head: null, ball: [102, 100] })).toBe('ball');
  });

  test('clampPt keeps points in the frame', () => {
    expect(clampPt([-0.1, 1.2])).toEqual([0, 1]);
  });

  test('live rows are the club-dependent checks and each checkpoint has its pill', () => {
    const rows = liveChecks(first.checks);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(['clubhead_vs_plane', 'butt_extension', 'top_direction', 'shaft_angle_impact']));
    expect(pillCheck('preImpact', first.checks).cp).toBe('preImpact');
    expect(pillCheck('leadArm', first.checks).id).toBe('butt_extension');
    expect(pillCheck('takeaway', first.checks)).toBeNull();
  });
});

describe('checkpoints.js (the lab editor cues)', () => {
  test('ten definitions in order with all four fields; P-numbers per D15 and D22', () => {
    expect(CHECKPOINT_DEFS.map((d) => d.p)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']);
    CHECKPOINT_DEFS.forEach((d) => ['name', 'what', 'stopWhen', 'markTips'].forEach((f) => expect(d[f]).toEqual(expect.any(String))));
    expect(HOW_TO_MARK.map(([k]) => k)).toEqual(['Hands', 'Clubhead', 'Ball', 'Clubhead hidden']);
  });
  test('left-handed cues mirror left and right', () => {
    expect(cueFor('leadArm', 'right').what).toMatch(/^Left arm/);
    expect(cueFor('leadArm', 'left').what).toMatch(/^Right arm/);
    expect(cueFor('trailArm', 'left').what).toMatch(/^Left arm/);
    expect(cueFor('shaftThrough', 'left').what).toMatch(/right hip/);
  });
  test('D26: every checkpoint has a short stop line (FIRST / LAST frame, condition, what to watch, strip captions)', () => {
    CHECKPOINT_DEFS.forEach((d) => {
      expect(['first', 'last']).toContain(d.stop.kind);
      ['short', 'watch', 'before', 'after'].forEach((f) => expect(d.stop[f]).toEqual(expect.any(String)));
      expect(d.stopWhen.startsWith(`the ${d.stop.kind} frame`)).toBe(true); // the badge agrees with the full cue
    });
    expect(cueFor('top').stop).toMatchObject({ kind: 'last', short: 'before the club starts down', watch: 'the clubhead, not the hands' });
    expect(cueFor('shaftDown', 'left').stop.short).toMatch(/left hip/);
    expect(cueFor('leadArm', 'left').stop.watch).toBe('the right arm');
    expect(cueFor('preImpact').stop).toBeUndefined();
  });
  test('internal frames have a cue and live under their timeline step', () => {
    expect(cueFor('preImpact').name).toBe('Pre-impact');
    expect(timelineStep('preImpact')).toBe('impact');
    expect(timelineStep('top')).toBe('top');
    expect(cueFor('nope')).toBeNull();
  });
});
