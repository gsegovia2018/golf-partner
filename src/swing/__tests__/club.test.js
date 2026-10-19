import { resolveClub, plausibleHead, CANDIDATE_MIN_CONF, MODEL_MIN_CONF } from '../club';

const hands = { x: 200, y: 400 };
const ball = { x: 273, y: 505 };

describe('resolveClub (plan 5.3, D16)', () => {
  test('a user mark always wins, even over a confident candidate', () => {
    const c = resolveClub('impact', hands, { head: [1, 1], conf: 0.99, source: 'edge' }, { hands: { x: 210, y: 410 }, head: { x: 270, y: 500 }, hidden: false }, ball);
    expect(c).toEqual({ hands: { x: 210, y: 410 }, head: { x: 270, y: 500 }, hidden: false, source: 'user', conf: 1 });
  });

  test('a user mark may only move the clubhead and keep the proposed hands', () => {
    const c = resolveClub('top', hands, null, { head: { x: 5, y: 6 } });
    expect(c.hands).toEqual(hands);
    expect(c.head).toEqual({ x: 5, y: 6 });
  });

  test('a user can mark the clubhead hidden', () => {
    expect(resolveClub('top', hands, null, { head: { x: 5, y: 6 }, hidden: true })).toMatchObject({ head: null, hidden: true, source: 'user' });
    expect(resolveClub('top', hands, null, { head: null })).toMatchObject({ head: null, hidden: true });
  });

  test('a candidate at or above the confidence floor is used', () => {
    const c = resolveClub('address', hands, { head: [270, 505], hidden: false, conf: CANDIDATE_MIN_CONF, source: 'edge' }, null, ball);
    expect(c).toEqual({ hands, head: { x: 270, y: 505 }, hidden: false, source: 'edge', conf: CANDIDATE_MIN_CONF });
  });

  test('a hidden candidate propagates as hidden, not as a failure', () => {
    expect(resolveClub('address', hands, { head: null, hidden: true, conf: 0.6, source: 'edge' }, null, ball))
      .toMatchObject({ head: null, hidden: true, source: 'edge' });
  });

  test('a low-confidence or prior candidate falls back to the prior with no head', () => {
    expect(resolveClub('top', hands, { head: [1, 2], conf: 0.2, source: 'edge' }, null)).toMatchObject({ head: null, source: 'prior', conf: 0.1 });
    expect(resolveClub('top', hands, { head: [1, 2], conf: 0.9, source: 'prior' }, null)).toMatchObject({ head: null, source: 'prior' });
  });

  test('address and impact priors carry the ball as the ring to drag; other checkpoints do not', () => {
    expect(resolveClub('address', hands, null, null, ball).priorHead).toEqual(ball);
    expect(resolveClub('impact', hands, null, null, ball).priorHead).toEqual(ball);
    expect(resolveClub('top', hands, null, null, ball).priorHead).toBeUndefined();
    expect(resolveClub('impact', hands, null, null, null).priorHead).toBeUndefined();
  });

  test('a model candidate is accepted at a low score and its source is carried through', () => {
    expect(MODEL_MIN_CONF).toBe(0.03);
    expect(resolveClub('top', hands, { head: [300, 120], hidden: false, conf: 0.05, source: 'model' }, null))
      .toEqual({ hands, head: { x: 300, y: 120 }, hidden: false, source: 'model', conf: 0.05 });
    expect(resolveClub('top', hands, { head: [300, 120], hidden: false, conf: 0.05, source: 'model-shaft' }, null))
      .toMatchObject({ head: { x: 300, y: 120 }, source: 'model-shaft' });
  });

  test('a model candidate under its floor falls back to the prior; edge still needs 0.35', () => {
    expect(resolveClub('top', hands, { head: [1, 2], conf: 0.02, source: 'model' }, null)).toMatchObject({ head: null, source: 'prior' });
    expect(resolveClub('top', hands, { head: [1, 2], conf: 0.05, source: 'edge' }, null)).toMatchObject({ head: null, source: 'prior' });
  });

  test('a user mark still wins over a model candidate', () => {
    expect(resolveClub('top', hands, { head: [1, 1], conf: 0.9, source: 'model' }, { head: { x: 5, y: 6 } })).toMatchObject({ head: { x: 5, y: 6 }, source: 'user' });
  });

  test('a detected address / impact head a club cannot reach falls back to the prior', () => {
    // above the hands (the chest), flat out sideways, and too long for any club at 2 px/cm
    [[230, 330], [400, 410], [520, 800]].forEach((head) => {
      expect(resolveClub('impact', hands, { head, conf: 0.9, source: 'edge' }, null, ball, 2)).toMatchObject({ head: null, source: 'prior' });
    });
    expect(resolveClub('impact', hands, { head: [270, 505], conf: 0.9, source: 'edge' }, null, ball, 2).source).toBe('edge');
    // the shaft swings everywhere else, and the golfer's own mark is never second-guessed
    expect(resolveClub('top', hands, { head: [230, 330], conf: 0.9, source: 'model' }, null, ball, 2).source).toBe('model');
    expect(resolveClub('impact', hands, null, { head: { x: 230, y: 330 } }, ball, 2).source).toBe('user');
  });

  test('plausibleHead: shaft angle always, length only with a scale', () => {
    expect(plausibleHead(hands, { x: 270, y: 505 })).toBe(true);
    expect(plausibleHead(hands, { x: 210, y: 380 })).toBe(false);
    expect(plausibleHead(hands, { x: 210, y: 410 }, 2)).toBe(false); // 7 cm
    expect(plausibleHead(hands, { x: 210, y: 410 })).toBe(true); // 45 deg: without a scale only the angle counts
  });
});
