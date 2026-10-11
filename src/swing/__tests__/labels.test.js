import {
  emptyMarks, frameLabel, withFrame, withBall, marksForAnalyze, parseMarks, LABELS_SCHEMA,
} from '../labels';

const untouched = () => frameLabel({
  i: 556, checkpoint: 'impact',
  hands: { proposed: [0.4, 0.5], final: [0.4, 0.5] },
  head: { proposed: [0.3, 0.6], proposedConf: 0.8, proposedSource: 'seed', final: [0.3, 0.6] },
});

describe('labels', () => {
  it('flags an untouched frame as not corrected and keeps no editedAt', () => {
    const f = untouched();
    expect(f.corrected).toBe(false);
    expect(f.editedAt).toBeNull();
  });

  it('flags moved hands, a moved head and a hidden toggle as corrected', () => {
    const base = { i: 1, checkpoint: 'top', head: { proposed: [0.1, 0.1], final: [0.1, 0.1] } };
    expect(frameLabel({ ...base, hands: { proposed: [0.2, 0.2], final: [0.25, 0.2] }, editedAt: 't' }).corrected).toBe(true);
    expect(frameLabel({ ...base, hands: { proposed: [0.2, 0.2], final: [0.2, 0.2] }, head: { proposed: [0.1, 0.1], final: [0.2, 0.1] } }).corrected).toBe(true);
    expect(frameLabel({ ...base, hands: { proposed: [0.2, 0.2], final: [0.2, 0.2] }, head: { proposed: null, final: null, finalHidden: true } }).corrected).toBe(true);
  });

  it('withFrame replaces by checkpoint and keeps frames sorted', () => {
    let m = emptyMarks({ swingId: 's1' });
    m = withFrame(m, untouched());
    m = withFrame(m, frameLabel({ i: 300, checkpoint: 'address', hands: { proposed: null, final: null }, head: { proposed: null, final: null } }));
    m = withFrame(m, frameLabel({ i: 556, checkpoint: 'impact', hands: { proposed: [0.4, 0.5], final: [0.5, 0.5] }, head: { proposed: null, final: null }, editedAt: 'now' }));
    expect(m.frames.map((f) => f.checkpoint)).toEqual(['address', 'impact']);
    expect(m.frames[1].corrected).toBe(true);
  });

  it('withBall derives corrected', () => {
    const m = withBall(emptyMarks({ swingId: 's' }), { proposed: [0.5, 0.6, 0.01], final: [0.5, 0.6, 0.01] });
    expect(m.ball.corrected).toBe(false);
    expect(withBall(m, { final: [0.52, 0.6, 0.01] }).ball.corrected).toBe(true);
  });

  it('marksForAnalyze exposes only corrected frames, normalised', () => {
    let m = withFrame(emptyMarks({ swingId: 's' }), untouched());
    m = withFrame(m, frameLabel({
      i: 495, checkpoint: 'top',
      hands: { proposed: [0.2, 0.2], final: [0.21, 0.2] },
      head: { proposed: null, final: [0.1, 0.05] }, editedAt: 'x',
    }));
    expect(marksForAnalyze(m)).toEqual({ top: { hands: [0.21, 0.2], head: [0.1, 0.05], hidden: false } });
  });

  it('round-trips through JSON and rejects other files', () => {
    const m = withFrame(emptyMarks({ swingId: 's', video: { width: 478, height: 850, fps: 29.97 } }), untouched());
    expect(parseMarks(JSON.stringify(m))).toEqual(m);
    expect(m.schema).toBe(LABELS_SCHEMA);
    expect(parseMarks('nope')).toBeNull();
    expect(parseMarks({ schema: 'other/1', frames: [] })).toBeNull();
  });

  it('a moved checkpoint is a correction on its own and marksForAnalyze carries the new frame', () => {
    const f = frameLabel({
      i: 560, iProposed: 556, checkpoint: 'impact',
      hands: { proposed: [0.4, 0.5], final: [0.4, 0.5] }, head: { proposed: [0.3, 0.6], final: [0.3, 0.6] }, editedAt: 'x',
    });
    expect(f).toMatchObject({ corrected: true, i: 560, iProposed: 556 });
    expect(marksForAnalyze(withFrame(emptyMarks({ swingId: 's' }), f)).impact.frame).toBe(560);
    expect(untouched().iProposed).toBe(556); // defaults to the frame itself
  });

  it('hands that follow the tracked grip are not sent to analyze() as the golfer\'s own', () => {
    const auto = frameLabel({
      i: 560, iProposed: 556, checkpoint: 'impact',
      hands: { proposed: [0.4, 0.5], final: [0.41, 0.52], placed: false }, head: { proposed: null, final: null }, editedAt: 'x',
    });
    expect(auto.hands.placed).toBe(false);
    expect(marksForAnalyze(withFrame(emptyMarks({ swingId: 's' }), auto)).impact.hands).toBeNull();
    // older files have no flag: differing hands count as placed
    const legacy = { ...auto, hands: { proposed: [0.4, 0.5], final: [0.45, 0.5] } };
    expect(marksForAnalyze({ frames: [legacy] }).impact.hands).toEqual([0.45, 0.5]);
  });
});
