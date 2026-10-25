import { failureOf, failureReport } from '../failureReport';

describe('failureOf', () => {
  it('keeps the native code and message instead of a bare "failed"', () => {
    const err = Object.assign(new Error('MediaCodec: no decoder for video/hevc'), { code: 'ERR_ANALYZE' });
    const f = failureOf(err, 'pose');
    expect(f.error).toBe('failed');
    expect(f.detail).toMatchObject({ code: 'ERR_ANALYZE', message: 'MediaCodec: no decoder for video/hevc', stage: 'pose' });
  });

  it('names an unsupported video so the screen can say so', () => {
    expect(failureOf({ code: 'ERR_UNSUPPORTED_VIDEO', message: 'no readable image' }, 'pose').error).toBe('video');
  });

  it('survives a thrown string and caps a long message', () => {
    expect(failureOf('boom', 'reading').detail).toMatchObject({ code: null, message: 'boom' });
    expect(failureOf(new Error('x'.repeat(1000))).detail.message).toHaveLength(400);
  });
});

describe('failureReport', () => {
  it('says what failed, where and on what', () => {
    const text = failureReport({
      swingId: 's1',
      detail: { code: 'ERR_ANALYZE', message: 'GPU delegate crashed', stage: 'pose', at: '2026-10-25T10:00:00Z' },
      apiVersion: 6,
      appVersion: '1.4.0',
      source: 'import',
    });
    expect(text).toContain('Error: ERR_ANALYZE (while pose)');
    expect(text).toContain('Message: GPU delegate crashed');
    expect(text).toContain('swing module v6');
    expect(text).toContain('Swing: s1');
    expect(text).toMatch(/Device: /);
  });
});
