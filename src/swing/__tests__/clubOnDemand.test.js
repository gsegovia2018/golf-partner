// The seam between the marking canvas and native.detectClub (plan 2026-10-16-swing-club-on-demand).
import {
  proposeClub, warmClub, releaseClubDetector, canProposeClub, resetClubOnDemand,
} from '../clubOnDemand';
import { getStill } from '../frames';
import { detectClub, releaseClub, clubOnDemandSupport } from '../native';

jest.mock('../frames', () => ({ getStill: jest.fn() }));
jest.mock('../native', () => ({
  detectClub: jest.fn(),
  releaseClub: jest.fn(() => Promise.resolve()),
  clubOnDemandSupport: jest.fn(),
}));

const video = { width: 1000, height: 2000 };
const q = {
  swingId: 's1', frame: 42, grip: [0.4, 0.5], video, pxPerCm: 3, scenery: [{ cls: 'head', box: [1, 2, 3, 4] }],
};

beforeEach(() => {
  jest.clearAllMocks();
  resetClubOnDemand();
  clubOnDemandSupport.mockReturnValue(true);
  getStill.mockReturnValue('file:///d/s1/frames/42.jpg');
});

describe('proposeClub', () => {
  it('asks native with the frame\'s still and normalises the head', async () => {
    detectClub.mockResolvedValue({ frames: { 42: { head: [250, 1000], hidden: false, conf: 0.7, source: 'model' } } });
    await expect(proposeClub(q)).resolves.toEqual({
      head: [0.25, 0.5], hidden: false, conf: 0.7, source: 'model',
    });
    expect(detectClub).toHaveBeenCalledWith({
      frames: [{ frame: 42, still: 'file:///d/s1/frames/42.jpg', grip: [0.4, 0.5] }],
      video, pxPerCm: 3, scenery: q.scenery,
    });
  });

  it('sends no scenery as an empty list (a swing analysed before apiVersion 5)', async () => {
    detectClub.mockResolvedValue({ frames: {} });
    await proposeClub({ ...q, scenery: undefined, pxPerCm: undefined });
    expect(detectClub.mock.calls[0][0]).toMatchObject({ scenery: [], pxPerCm: null });
  });

  it('no still on disk: null, and native is not called', async () => {
    getStill.mockReturnValue(null);
    await expect(proposeClub(q)).resolves.toBeNull();
    expect(detectClub).not.toHaveBeenCalled();
  });

  it('below the gate: null, and native is not called', async () => {
    clubOnDemandSupport.mockReturnValue(false);
    await expect(proposeClub(q)).resolves.toBeNull();
    expect(detectClub).not.toHaveBeenCalled();
  });

  it('source null or a per-frame error: null', async () => {
    detectClub.mockResolvedValueOnce({ frames: { 42: { head: null, hidden: false, conf: 0, source: null } } });
    await expect(proposeClub(q)).resolves.toBeNull();
    detectClub.mockResolvedValueOnce({ frames: { 42: { head: null, source: null, error: 'bad jpeg' } } });
    await expect(proposeClub(q)).resolves.toBeNull();
  });

  it('a rejection resolves null; ERR_CLUB latches and the next call never touches native', async () => {
    detectClub.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ERR_OTHER' }));
    await expect(proposeClub(q)).resolves.toBeNull();
    expect(canProposeClub()).toBe(true);
    detectClub.mockRejectedValueOnce(Object.assign(new Error('no model'), { code: 'ERR_CLUB' }));
    await expect(proposeClub(q)).resolves.toBeNull();
    expect(canProposeClub()).toBe(false);
    detectClub.mockClear();
    await expect(proposeClub(q)).resolves.toBeNull();
    warmClub();
    expect(detectClub).not.toHaveBeenCalled();
  });
});

describe('warmClub / releaseClubDetector', () => {
  it('warm is a detectClub with no frames, and a failure is swallowed', async () => {
    detectClub.mockRejectedValue(new Error('boom'));
    warmClub();
    expect(detectClub.mock.calls[0][0].frames).toEqual([]);
    await Promise.resolve();
  });

  it('release closes the detector, never throws, and is a no-op below the gate', async () => {
    releaseClub.mockRejectedValueOnce(new Error('x'));
    releaseClubDetector();
    expect(releaseClub).toHaveBeenCalledTimes(1);
    clubOnDemandSupport.mockReturnValue(false);
    releaseClubDetector();
    expect(releaseClub).toHaveBeenCalledTimes(1);
    warmClub();
    expect(detectClub).not.toHaveBeenCalled();
  });
});
