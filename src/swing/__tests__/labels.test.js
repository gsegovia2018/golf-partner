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
});
