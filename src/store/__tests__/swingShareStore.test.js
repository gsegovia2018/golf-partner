import { supabase } from '../../lib/supabase';
import * as swingStore from '../swingStore';
import { ensureStills } from '../../swing/frames';
import {
  shareSwing, unshareSwing, getPublicSwing, deleteSharedSwing, SWING_SHARE_BUCKET,
} from '../swingShareStore';
import { SHARE_SCHEMA } from '../swingShare';

const mockBucket = {
  upload: jest.fn(),
  list: jest.fn(),
  remove: jest.fn(),
  getPublicUrl: jest.fn((p) => ({ data: { publicUrl: `https://cdn.test/${p}` } })),
};
jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn(), storage: { from: jest.fn(() => mockBucket) } },
}));
jest.mock('../swingStore', () => ({
  getSwing: jest.fn(),
  readAnalysis: jest.fn(),
  readPose: jest.fn(),
  readSwingBytes: jest.fn(),
  setSwingShare: jest.fn(() => Promise.resolve()),
  hasCustomName: jest.fn((row) => row.name === 'Mi driver'),
  deleteSwing: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../swing/frames', () => ({ ensureStills: jest.fn(() => Promise.resolve({})) }));

const ANALYSIS = { checkpoints: { address: { i: 10 }, impact: { i: 52 } }, internal: { transition: 44 }, main: null };
const POSE = { video: { width: 1, height: 2 }, frames: [{ i: 10 }, { i: 11 }, { i: 44 }, { i: 52 }] };
const ROW = { id: 's1', name: 'Mi driver', club: 'driver', createdAt: '2026-10-29T10:00:00.000Z' };
const bytes = (n) => new Uint8Array(n);

beforeEach(() => {
  jest.clearAllMocks();
  swingStore.getSwing.mockReturnValue(ROW);
  swingStore.readAnalysis.mockResolvedValue(ANALYSIS);
  swingStore.readPose.mockResolvedValue(POSE);
  // frame 44 has no still on disk
  swingStore.readSwingBytes.mockImplementation(async (_id, p) => (p === 'frames/44.jpg' ? null : bytes(p === 'video.mp4' ? 8 : 2)));
  mockBucket.upload.mockResolvedValue({ data: {}, error: null });
  supabase.rpc.mockImplementation(async (name) => ({ data: name === 'start_swing_share' ? 'TOKEN_abcdefghijklmnopqrstu' : true, error: null }));
});

describe('shareSwing', () => {
  test('opens the link, uploads video, stills and share.json under the token, then finishes and remembers it', async () => {
    const progress = [];
    const token = await shareSwing('s1', { onProgress: (p) => progress.push(p) });
    const T = 'TOKEN_abcdefghijklmnopqrstu';
    expect(token).toBe(T);
    expect(supabase.storage.from).toHaveBeenCalledWith(SWING_SHARE_BUCKET);
    expect(ensureStills).toHaveBeenCalledWith('s1', [10, 44, 52]);
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'start_swing_share', {
      p_swing_id: 's1', p_title: 'Mi driver', p_club: 'driver', p_recorded_at: ROW.createdAt,
    });
    expect(mockBucket.upload.mock.calls.map((c) => [c[0], c[2].contentType])).toEqual([
      [`${T}/video.mp4`, 'video/mp4'],
      [`${T}/frames/10.jpg`, 'image/jpeg'],
      [`${T}/frames/52.jpg`, 'image/jpeg'],
      [`${T}/share.json`, 'application/json'],
    ]);
    const json = JSON.parse(mockBucket.upload.mock.calls[3][1]);
    expect(json).toEqual({ v: SHARE_SCHEMA, analysis: ANALYSIS, pose: { video: POSE.video, frames: [{ i: 10 }, { i: 52 }] }, frames: [10, 52] });
    expect(supabase.rpc).toHaveBeenLastCalledWith('finish_swing_share', { p_token: T });
    expect(swingStore.setSwingShare).toHaveBeenCalledWith('s1', expect.objectContaining({ token: T }));
    expect(progress[0]).toEqual({ done: 0, total: 4 });
    expect(progress[progress.length - 1]).toEqual({ done: 4, total: 4 });
  });

  test('a default name is not sent as a title', async () => {
    swingStore.getSwing.mockReturnValue({ ...ROW, name: 'Sat 11 Oct · 18:42' });
    await shareSwing('s1');
    expect(supabase.rpc.mock.calls[0][1].p_title).toBeNull();
  });

  test('a failed upload stops before the link is finished or remembered', async () => {
    mockBucket.upload.mockResolvedValueOnce({ data: null, error: { message: 'Payload too large' } });
    await expect(shareSwing('s1')).rejects.toThrow('Payload too large');
    expect(supabase.rpc).not.toHaveBeenCalledWith('finish_swing_share', expect.anything());
    expect(swingStore.setSwingShare).not.toHaveBeenCalled();
  });

  test('no video or no analysis: nothing is sent', async () => {
    swingStore.readSwingBytes.mockResolvedValue(null);
    await expect(shareSwing('s1')).rejects.toThrow();
    swingStore.readAnalysis.mockResolvedValue({ error: 'no_pose' });
    await expect(shareSwing('s1')).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockBucket.upload).not.toHaveBeenCalled();
  });
});

describe('unshareSwing / deleteSharedSwing', () => {
  const shared = { ...ROW, share: { token: 'TK' } };

  test('removes every file under the token, then the link, then forgets it', async () => {
    swingStore.getSwing.mockReturnValue(shared);
    mockBucket.list.mockResolvedValue({ data: [{ name: '10.jpg' }, { name: '52.jpg' }], error: null });
    mockBucket.remove.mockResolvedValue({ data: [], error: null });
    await unshareSwing('s1');
    expect(mockBucket.list).toHaveBeenCalledWith('TK/frames', { limit: 1000 });
    expect(mockBucket.remove).toHaveBeenCalledWith(['TK/video.mp4', 'TK/share.json', 'TK/frames/10.jpg', 'TK/frames/52.jpg']);
    expect(supabase.rpc).toHaveBeenCalledWith('end_swing_share', { p_token: 'TK' });
    expect(swingStore.setSwingShare).toHaveBeenCalledWith('s1', null);
  });

  test('a swing that is not shared is left alone', async () => {
    await unshareSwing('s1');
    expect(mockBucket.remove).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('a failed removal keeps the link and the swing', async () => {
    swingStore.getSwing.mockReturnValue(shared);
    mockBucket.list.mockResolvedValue({ data: [], error: null });
    mockBucket.remove.mockRejectedValue(new Error('offline'));
    await expect(deleteSharedSwing('s1')).rejects.toMatchObject({ offline: true });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(swingStore.deleteSwing).not.toHaveBeenCalled();
  });

  test('deleteSharedSwing closes the link, then deletes the swing', async () => {
    swingStore.getSwing.mockReturnValue(shared);
    mockBucket.list.mockResolvedValue({ data: [], error: null });
    mockBucket.remove.mockResolvedValue({ data: [], error: null });
    await deleteSharedSwing('s1');
    expect(supabase.rpc).toHaveBeenCalledWith('end_swing_share', { p_token: 'TK' });
    expect(swingStore.deleteSwing).toHaveBeenCalledWith('s1');
  });
});

describe('getPublicSwing', () => {
  const META = { sharer: 'Íñigo E.', title: null, club: 'iron', recorded_at: '2026-10-29T10:00:00Z' };
  const payload = { v: SHARE_SCHEMA, analysis: ANALYSIS, pose: POSE, frames: [10, 52] };
  afterEach(() => { delete global.fetch; });

  test('a ready link: the facts, the analysis and public URLs for the stills it has', async () => {
    supabase.rpc.mockResolvedValue({ data: META, error: null });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
    const d = await getPublicSwing('TK');
    expect(supabase.rpc).toHaveBeenCalledWith('get_public_swing', { p_token: 'TK' });
    expect(global.fetch.mock.calls[0][0]).toBe('https://cdn.test/TK/share.json');
    expect(d.meta).toEqual(META);
    expect(d.analysis).toEqual(ANALYSIS);
    expect(d.videoUrl).toBe('https://cdn.test/TK/video.mp4');
    expect(d.stillUrl(52)).toBe('https://cdn.test/TK/frames/52.jpg');
    expect(d.stillUrl(44)).toBeNull();
  });

  test('a closed or unknown link is null, without touching the files', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    global.fetch = jest.fn();
    expect(await getPublicSwing('TK')).toBeNull();
    expect(await getPublicSwing(null)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('files gone while reading: null; network down: an offline error', async () => {
    supabase.rpc.mockResolvedValue({ data: META, error: null });
    global.fetch = jest.fn(async () => ({ ok: false, status: 400 }));
    expect(await getPublicSwing('TK')).toBeNull();
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); });
    await expect(getPublicSwing('TK')).rejects.toMatchObject({ offline: true });
  });
});
