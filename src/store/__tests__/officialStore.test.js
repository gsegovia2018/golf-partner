import { buildScorePayload } from '../officialStore';

describe('buildScorePayload', () => {
  test('produces the exact RPC argument shape for submit_score', () => {
    const p = buildScorePayload({
      token: 'TKN', roundId: 'r1', hole: 7,
      subjectRosterId: 's1', source: 'self', strokes: 5,
    });
    expect(p).toEqual({
      fn: 'submit_score',
      args: { p_token: 'TKN', p_round_id: 'r1', p_hole: 7,
              p_subject: 's1', p_source: 'self', p_strokes: 5 },
    });
  });

  test('rejects a source outside self|marker', () => {
    expect(() => buildScorePayload({
      token: 'T', roundId: 'r', hole: 1,
      subjectRosterId: 's', source: 'admin', strokes: 3,
    })).toThrow('bad source');
  });
});
