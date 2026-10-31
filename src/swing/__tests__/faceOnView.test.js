// The face-on view end to end (plan 2026-10-30): which checks run, how the main fault ranks, the
// results steps, the marking pass and the golfer's view correction, on the real face-on fixture
// and a down-the-line one.
import { analyzeReference, byName } from './referenceSwings';
import { stepsOf, stepStatuses, neighbour } from '../resultsSteps';
import { positionsOf, normView } from '../checkpointChecks';
import {
  markedKeysOf, markTotalOf, markedFromMarks, nextTodo,
} from '../markPass';
import { mainFault } from '../priority';
import { emptyMarks, viewOverrideOf } from '../labels';
import {
  buildDraft, draftToMarks, MARKS_AT, confirmPosition,
} from '../editMarks';

const faceOn = () => analyzeReference(byName('faceon-mcilroy-driver'));
const dtl = () => analyzeReference(byName('tour-mcilroy-driver'));

describe('analyze picks the checks by view', () => {
  test('the face-on fixture is detected face-on and gets the face-on rows only', () => {
    const a = faceOn();
    expect(a.view).toBe('faceOn');
    expect(a.viewDetected).toBe('faceOn');
    const ids = new Set(a.checks.map((c) => c.id));
    expect(ids.has('fo_sway')).toBe(true);
    expect(ids.has('hip_drift')).toBe(false);
    expect(a.checks.filter((c) => !c.extra).every((c) => positionsOf('faceOn').includes(c.position))).toBe(true);
    expect([1, -1]).toContain(a.targetDir);
  });
  test('a tour pivot reads sound: no sway, the hips lead, no slide, the weight finishes forward', () => {
    // McIlroy, right-handed, filmed from the front: the target is to the right of the picture. The
    // clip has no still address (it is trimmed into the takeaway), so the address rows are not judged here.
    const a = faceOn();
    expect(a.targetDir).toBe(1);
    const st = (id) => a.checks.find((c) => c.id === id).status;
    ['fo_sway', 'fo_hips_shift', 'fo_slide', 'fo_finish_weight'].forEach((id) => expect([id, st(id)]).toEqual([id, 'green']));
  });
  test('the golfer\'s correction wins over the detection, both ways', () => {
    const fx = byName('faceon-mcilroy-driver');
    const forced = analyzeReference({ ...fx, marks: fx.marks ?? {} }, { view: 'dtl' });
    expect(forced.view).toBe('dtl');
    expect(forced.viewDetected).toBe('faceOn');
    expect(forced.checks.some((c) => c.id === 'hip_drift')).toBe(true);
    const back = analyzeReference(byName('tour-mcilroy-driver'), { view: 'faceOn' });
    expect(back.view).toBe('faceOn');
    expect(back.checks.some((c) => c.id === 'fo_stance')).toBe(true);
  });
  test('a down-the-line swing is unchanged: no face-on rows, no target direction', () => {
    const a = dtl();
    expect(a.view).toBe('dtl');
    expect(a.checks.some((c) => c.id.startsWith('fo_'))).toBe(false);
    expect(a.targetDir).toBeUndefined();
  });
});

describe('results steps and the main fault follow the view', () => {
  test('face-on: five positions and Extras; the neighbours walk them', () => {
    const a = faceOn();
    expect(stepsOf(a)).toEqual(['address', 'top', 'shaftDown', 'impact', 'finish', 'extras']);
    expect(Object.keys(stepStatuses(a)).sort()).toEqual(['address', 'extras', 'finish', 'impact', 'shaftDown', 'top']);
    expect(neighbour('top', 1, stepsOf(a))).toBe('shaftDown');
    expect(neighbour('finish', 1, stepsOf(a))).toBe('extras');
  });
  test('down the line keeps its seven positions', () => {
    expect(stepsOf(dtl())).toHaveLength(8);
    expect(stepsOf(null)).toHaveLength(8);
  });
  test('face-on tiers rank impact before the top, and "starts at" looks only at face-on positions', () => {
    const red = (id, position, severity = 1) => ({ id, position, status: 'red', fault: id, severity });
    const m = mainFault([red('sway', 'top', 3), red('slide', 'impact', 1)], 'faceOn');
    expect(m.fault).toBe('slide');
    expect(m.startsAt).toBe('top');
    expect(normView('anything')).toBe('dtl');
  });
});

describe('the marking pass by view', () => {
  test('face-on marks four positions; the finish stays automatic', () => {
    expect(markedKeysOf('faceOn')).toEqual(['address', 'top', 'shaftDown', 'impact']);
    expect(markTotalOf('faceOn')).toBe(4);
    expect(markTotalOf()).toBe(7);
    expect(nextTodo({ address: 'confirmed' }, 'address', 'faceOn')).toBe('top');
    expect(nextTodo({ address: 'confirmed', top: 'confirmed' }, 'top', 'faceOn')).toBe('shaftDown');
  });
  test('four positions finish a face-on pass, not a down-the-line one', () => {
    const frames = ['address', 'top', 'shaftDown', 'impact'].map((checkpoint) => ({ checkpoint, confirmed: true }));
    expect(markedFromMarks({ frames, pass: { state: 'partial', skipped: [] } }, 'faceOn').count).toBe(4);
    expect(markedFromMarks({ frames, pass: { state: 'partial', skipped: [] } }, 'dtl').count).toBe(4);
    // a file from before the pass state: its corrected frames count, against the view's positions
    const legacy = { frames: frames.map(({ checkpoint }) => ({ checkpoint, corrected: true })) };
    expect(markedFromMarks(legacy, 'faceOn').state).toBe('done');
    expect(markedFromMarks(legacy, 'dtl').state).toBe('partial');
  });
});

describe('the view correction lives in marks.json', () => {
  test('only face-on / dtl count; the field survives an edit', () => {
    expect(viewOverrideOf({ viewOverride: 'faceOn' })).toBe('faceOn');
    expect(viewOverrideOf({ viewOverride: 'sideways' })).toBeUndefined();
    expect(viewOverrideOf(emptyMarks({ swingId: 's1' }))).toBeUndefined();
    const a = faceOn();
    const fx = byName('faceon-mcilroy-driver');
    const marks = { ...emptyMarks({ swingId: 's1', view: 'faceOn', viewOverride: 'faceOn' }), pass: { state: 'partial', skipped: [] } };
    const { draft, base } = buildDraft(a, { ball: fx.ball }, marks);
    expect(draft.viewOverride).toBe('faceOn');
    const out = draftToMarks({ draft, base, live: a, swingId: 's1' });
    expect(out.viewOverride).toBe('faceOn');
    expect(out.view).toBe('faceOn');
  });
});

describe('face-on marking asks for no clubhead (swingcheck.org rule set)', () => {
  test('the hands everywhere, the ball at address; down the line keeps the clubhead', () => {
    expect(MARKS_AT('address', 'faceOn')).toEqual(['hands', 'ball']);
    expect(MARKS_AT('impact', 'faceOn')).toEqual(['hands']);
    expect(MARKS_AT('impact')).toEqual(['hands', 'head']);
  });
  test('confirming a face-on position confirms the hands, not the clubhead', () => {
    const a = faceOn();
    const { draft, base } = buildDraft(a, { ball: byName('faceon-mcilroy-driver').ball }, null);
    const next = confirmPosition(draft, base, 'top', 'faceOn');
    expect(next.status.top).toBe('confirmed');
    expect(next.cps.top.confirmed).toMatchObject({ hands: true, head: false });
  });
});

describe('face-on phases on public clips (S0): the downswing, not the finish', () => {
  // Top and impact read off the stills (plan 2026-10-30 §9a). Before S0 all three locked onto the
  // hands coming down after the finish (100-300 frames late); a slow-motion amateur also read 60 fps.
  const STILLS = {
    'faceon-oosthuizen-driver': { top: 360, impact: 410, fps: 240 },
    'faceon-amateur-iron-240': { top: 235, impact: 286, fps: 240 },
    'faceon-amateur-iron-120': { top: 290, impact: 325, fps: 120 },
  };
  test.each(Object.keys(STILLS))('%s: face-on, top within 12 frames and impact within 10, at the right frame rate', (name) => {
    const a = analyzeReference(byName(name));
    const s = STILLS[name];
    expect(a.view).toBe('faceOn');
    expect(Math.abs(a.checkpoints.top.i - s.top)).toBeLessThanOrEqual(12);
    expect(Math.abs(a.checkpoints.impact.i - s.impact)).toBeLessThanOrEqual(10);
    expect(Math.round(a.fps.capture)).toBe(s.fps);
  });

  test('a tour pivot (Oosthuizen) reads sound on the frames the stills give', () => {
    const a = analyzeReference(byName('faceon-oosthuizen-driver'));
    const st = (id) => a.checks.find((c) => c.id === id).status;
    ['fo_sway', 'fo_hips_shift', 'fo_hips_impact', 'fo_slide'].forEach((id) => expect([id, st(id)]).toEqual([id, 'green']));
  });
});
