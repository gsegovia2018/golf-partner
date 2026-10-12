// checkpointChecks.js (timeline dots, "At <checkpoint>" lists, the D16 CTA target) and
// highlights.js (the drawing of a selected check), on the real fixture analysis.
import { analyze } from '../analyze';
import { poseAtFrame } from '../poseAt';
import {
  checksAt, worstAt, worstByCheckpoint, unplacedCheckpoint, homeOf, CHECK_KEY,
} from '../checkpointChecks';
import { highlightFor, valueText } from '../highlights';
import { fixtureNative, TRUTH, W, H } from './helpers';

const lab = require('./fixtures/lab-d15-pass1.json');

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const native = fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame });
const base = { pass2: { addressFrame: lab.expected.addressFrame, shaft: {} }, heightCm: 176, handedness: 'right' };
const ownerMarks = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
}]));

const unmarked = analyze(native, base);
const marked = analyze(native, { ...base, marks: ownerMarks });
const frameOf = (a) => (k) => a.checkpoints[k]?.i ?? a.internal[k];
const ctx = (a) => ({ analysis: a, poseAt: (f) => poseAtFrame(native, f), frameOf: frameOf(a) });
const row = (a, id, cp) => a.checks.find((c) => c.id === id && (!cp || c.cp === cp));

describe('checkpointChecks', () => {
  test('every check has a home among the nine checkpoints, and clubhead_vs_plane rows live at impact', () => {
    expect(unmarked.checks).toHaveLength(21);
    unmarked.checks.forEach((c) => expect(checksAt(unmarked.checks, homeOf(c))).toContain(c));
    expect(checksAt(unmarked.checks, 'impact').filter((c) => c.id === 'clubhead_vs_plane')).toHaveLength(2);
    expect(checksAt(unmarked.checks, 'takeaway')).toHaveLength(0);
    expect(checksAt(unmarked.checks, 'transition')).toHaveLength(0);
  });

  test('a timeline dot is the worst measured status; unknowns do not count', () => {
    expect(worstAt(marked.checks, 'impact')).toBe('red');
    const w = worstByCheckpoint(marked.checks);
    expect(Object.keys(w)).toHaveLength(9);
    expect(w.takeaway).toBe('none');
    const onlyUnknown = [{ id: 'top_direction', status: 'unknown' }];
    expect(worstAt(onlyUnknown, 'top')).toBe('none');
  });

  test('D16: an unplaced clubhead names the checkpoint to place it at; a hidden mark does not', () => {
    const butt = row(unmarked, 'butt_extension');
    expect(butt.status).toBe('unknown');
    expect(unplacedCheckpoint(butt, unmarked.clubMarks)).toBe('leadArm');
    expect(unplacedCheckpoint(row(unmarked, 'clubhead_vs_plane', 'preImpact'), unmarked.clubMarks)).toBe('preImpact');
    // The owner hid the shaft-down clubhead: a decision, not a gap.
    expect(marked.clubMarks.shaftDown.hidden).toBe(true);
    expect(unplacedCheckpoint({ ...butt, cps: ['shaftDown'] }, marked.clubMarks)).toBeNull();
    // A measured check never asks for a placement.
    expect(unplacedCheckpoint(row(marked, 'spine_loss'), marked.clubMarks)).toBeNull();
  });

  test('check rows with the same id at two checkpoints get distinct keys', () => {
    const keys = unmarked.checks.map(CHECK_KEY);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('highlights', () => {
  test('values read the way the rows do', () => {
    expect(valueText({ value: 7, unit: '°' })).toBe('7°');
    expect(valueText({ value: 10, unit: 'cm' })).toBe('10 cm');
    expect(valueText({ value: 1.8, unit: ':1' })).toBe('1.8:1');
    expect(valueText({ value: null, unit: null })).toBe('');
  });

  test('every measured check draws something (or nothing, never a crash); coordinates are normalised', () => {
    marked.checks.forEach((c) => {
      const prims = highlightFor(c, ctx(marked));
      expect(Array.isArray(prims)).toBe(true);
      prims.forEach((p) => {
        [p.a, p.b, p.c, p.at, ...(p.pts || [])].filter(Boolean).forEach(([x, y]) => {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        });
      });
    });
  });

  test('spine loss draws the vertical, the spine and the address spine ghost, with the loss in degrees', () => {
    const prims = highlightFor(row(marked, 'spine_loss'), ctx(marked));
    expect(prims.filter((p) => p.t === 'line')).toHaveLength(3);
    expect(prims.find((p) => p.t === 'label').text).toMatch(/° lost$/);
  });

  test('hands height boxes the address height and labels the signed difference', () => {
    const prims = highlightFor(row(marked, 'hands_height_impact'), ctx(marked));
    expect(prims.find((p) => p.t === 'rect')).toBeTruthy();
    expect(prims.find((p) => p.t === 'label').text).toMatch(/^\+\d+ cm$/);
  });

  test('checks that need a clubhead draw nothing while it is unplaced', () => {
    expect(highlightFor(row(unmarked, 'butt_extension'), ctx(unmarked))).toEqual([]);
    expect(highlightFor(row(unmarked, 'shaft_angle_impact'), ctx(unmarked))).toEqual([]);
  });
});
