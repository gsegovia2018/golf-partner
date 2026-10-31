import {
  shareFrames, trimPose, sharePayload, sharePaths, swingShareUrl, swingShareTokenFromPath,
  swingShareTokenFromUrl, parseSharePayload, SHARE_SCHEMA,
} from '../swingShare';

const analysis = {
  checkpoints: { address: { i: 10 }, top: { i: 40.4 }, impact: { i: 52 }, finish: {} },
  internal: { transition: 44, preImpact: 50, bad: null },
};

describe('swingShare (pure)', () => {
  test('shareFrames: checkpoint and internal frames, rounded, unique, sorted; nothing else', () => {
    expect(shareFrames(analysis)).toEqual([10, 40, 44, 50, 52]);
    expect(shareFrames({ checkpoints: { a: { i: 5 } }, internal: { b: 5 } })).toEqual([5]);
    expect(shareFrames(null)).toEqual([]);
  });

  test('trimPose keeps only the shared frames and every other field', () => {
    const pose = { video: { width: 1080, height: 1920 }, ball: { x: 0.5 }, frames: [{ i: 9 }, { i: 10 }, { i: 52 }, null] };
    expect(trimPose(pose, [10, 52])).toEqual({ video: pose.video, ball: pose.ball, frames: [{ i: 10 }, { i: 52 }] });
    expect(trimPose(null, [1])).toBeNull();
  });

  test('sharePayload round-trips through parseSharePayload', () => {
    const p = sharePayload({ analysis, pose: { frames: [{ i: 10 }, { i: 11 }] }, frames: [10] });
    expect(p.v).toBe(SHARE_SCHEMA);
    expect(parseSharePayload(JSON.parse(JSON.stringify(p)))).toEqual({ analysis, pose: { frames: [{ i: 10 }] }, frames: [10] });
  });

  test('parseSharePayload refuses other versions and broken bodies', () => {
    expect(parseSharePayload({ v: 2, analysis, frames: [] })).toBeNull();
    expect(parseSharePayload({ v: SHARE_SCHEMA, frames: [] })).toBeNull();
    expect(parseSharePayload({ v: SHARE_SCHEMA, analysis })).toBeNull();
    expect(parseSharePayload('nope')).toBeNull();
  });

  test('paths live under the token', () => {
    expect(sharePaths.video('T')).toBe('T/video.mp4');
    expect(sharePaths.json('T')).toBe('T/share.json');
    expect(sharePaths.still('T', 12.6)).toBe('T/frames/13.jpg');
  });

  test('the link and its token', () => {
    expect(swingShareUrl('https://golf-partner.vercel.app/', 'a b')).toBe('https://golf-partner.vercel.app/s/a%20b');
    expect(swingShareUrl('x', null)).toBeNull();
    expect(swingShareTokenFromPath('/s/abc123')).toBe('abc123');
    expect(swingShareTokenFromPath('/s/a%20b/x')).toBe('a b');
    expect(swingShareTokenFromPath('/swing/abc')).toBeNull();
    expect(swingShareTokenFromPath('/settings')).toBeNull();
    expect(swingShareTokenFromUrl('https://golf-partner.vercel.app/s/tok?x=1')).toBe('tok');
    expect(swingShareTokenFromUrl('golf://s/tok')).toBe('tok');
    expect(swingShareTokenFromUrl('https://golf-partner.vercel.app/board/tok')).toBeNull();
    expect(swingShareTokenFromUrl(null)).toBeNull();
  });
});
