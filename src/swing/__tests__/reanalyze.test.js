// Changing the club on Results re-scores the stored pose and marks (D19): same numbers, other limits.
import { analyze, SCHEMA } from '../analyze';
import { reanalyzeForClub, upgradeAnalysis } from '../reanalyze';
import { emptyMarks, frameLabel, withFrame } from '../labels';
import { fixtureNative, TRUTH, W, H } from './helpers';

const lab = require('./fixtures/lab-d15-pass1.json');

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = { ...fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame }), pass2: { addressFrame: lab.expected.addressFrame, shaft: {} } };
const base = { pass2: pose.pass2, heightCm: 176, handedness: 'right', swingId: 's1', createdAt: 'x', source: 'import' };

// marks.json as Edit marks writes it: the owner's labelled hands and clubheads.
const labelled = [...Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, c.frame, c.hands, c.hidden ? null : c.head, c.hidden]),
  ['preImpact', 550, { x: 222, y: 400 }, { x: 240, y: 470 }, false]];
const marks = labelled.reduce((m, [k, i, hands, head, hidden]) => withFrame(m, frameLabel({
  i,
  checkpoint: k,
  hands: { proposed: null, final: norm(hands), placed: true },
  head: { proposed: null, final: norm(head), finalHidden: hidden },
})), emptyMarks({ swingId: 's1' }));
const ownerMarks = Object.fromEntries(labelled.map(([k, , hands, head, hidden]) => [k, { hands: norm(hands), head: norm(head), hidden }]));

describe('reanalyzeForClub', () => {
  const iron = analyze(pose, { ...base, marks: ownerMarks, club: 'iron' });

  test('driver from the stored pose and marks equals analysing with the driver from scratch', () => {
    const stored = { pose, probe: null, marks, analysis: iron };
    const driver = reanalyzeForClub(stored, 'driver');
    const direct = analyze(pose, { ...base, marks: ownerMarks, club: 'driver' });
    expect(driver.club).toBe('driver');
    expect(driver.checks).toEqual(direct.checks);
    expect(driver.counts).toEqual(direct.counts);
    expect(driver.swingId).toBe('s1');
  });

  test('and back to iron restores the iron result', () => {
    const driver = reanalyzeForClub({ pose, probe: null, marks, analysis: iron }, 'driver');
    const back = reanalyzeForClub({ pose, probe: null, marks, analysis: driver }, 'iron');
    expect(back.checks).toEqual(iron.checks);
  });

  test('passes an analyze() error through instead of throwing', () => {
    const bad = reanalyzeForClub({ pose: { ...pose, frames: [] }, probe: null, marks, analysis: iron }, 'driver');
    expect(bad.error).toBe('no_pose');
  });
});

describe('upgradeAnalysis (checks v2, spec §7)', () => {
  const v2 = analyze(pose, { ...base, marks: ownerMarks, club: 'driver' });
  // An analysis.json written by the schema-1 checks: old rows, old main fault.
  const v1 = {
    ...v2,
    schema: 'swing-analysis/1',
    checks: [{ id: 'waist_bend', status: 'green' }, { id: 'top_direction', status: 'yellow', dir: 'across' }],
    main: { fault: 'top_position', phase: 'backswing', consequences: ['over_the_top'] },
  };

  test('an older analysis is re-run from the stored pose and marks, with its own club', () => {
    const r = upgradeAnalysis({
      pose, probe: null, marks, analysis: v1,
    });
    expect(r.upgraded).toBe(true);
    expect(r.analysis.schema).toBe(SCHEMA);
    expect(r.analysis.club).toBe('driver');
    expect(r.analysis.checks).toEqual(v2.checks);
    expect(r.analysis.checks.map((c) => c.id)).toContain('clubhead_plane_takeaway');
    expect(r.analysis.main.fault).toBe(v2.main.fault);
  });

  test('a current analysis is returned as it is', () => {
    const r = upgradeAnalysis({
      pose, probe: null, marks, analysis: v2,
    });
    expect(r).toEqual({ analysis: v2, upgraded: false });
  });

  test('a re-run that cannot run or fails keeps the old analysis and says why', () => {
    expect(upgradeAnalysis({
      pose: null, probe: null, marks, analysis: v1,
    })).toEqual({ analysis: v1, upgraded: false, error: 'no_pose' });
    expect(upgradeAnalysis({
      pose: { ...pose, frames: [] }, probe: null, marks, analysis: v1,
    })).toEqual({ analysis: v1, upgraded: false, error: 'no_pose' });
    const thrown = upgradeAnalysis({
      pose: { ...pose, video: null }, probe: null, marks, analysis: v1,
    });
    expect(thrown).toMatchObject({ analysis: v1, upgraded: false });
    expect(thrown.error).toBeTruthy();
  });
});
