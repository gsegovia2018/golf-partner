import { resolveClub, CANDIDATE_MIN_CONF } from '../club';

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
});
