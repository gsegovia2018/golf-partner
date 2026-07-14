jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  })),
}));

jest.mock('../videoThumbWeb', () => ({
  generateVideoThumbWeb: jest.fn(),
}));

jest.mock('../../store/mediaStore', () => ({
  insertMediaRow: jest.fn(() => Promise.resolve()),
}));

// `mock`-prefixed names are exempted from jest's out-of-scope-variable check
// for module factories, so the upload spy must be named accordingly.
const mockUpload = jest.fn(() => Promise.resolve({ error: null }));
jest.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: () => ({ upload: (...args) => mockUpload(...args) }),
    },
  },
}));

const ImageManipulator = require('expo-image-manipulator');
const { insertMediaRow } = require('../../store/mediaStore');
const { processUpload } = require('../mediaUpload');

describe('processUpload thumbnail-failure handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({ error: null });
  });

  const baseEntry = {
    id: 'm1',
    tournamentId: 't1',
    roundId: 'r1',
    holeIndex: 0,
    kind: 'photo',
    localUri: 'file://original.jpg',
  };

  test('a thumbnail-generation throw does not fail the whole upload — the original still uploads with a null thumb', async () => {
    ImageManipulator.manipulateAsync
      .mockResolvedValueOnce({ uri: 'file://compressed.jpg' }) // compressPhoto (the original)
      .mockRejectedValueOnce(new Error('unsupported codec')); // makeThumbnail

    const result = await processUpload(baseEntry);

    expect(result).toEqual({ storagePath: 't1/r1/m1.jpg', thumbPath: null });
    // Only the original was uploaded to storage — no thumb upload attempted.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(insertMediaRow).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: 't1/r1/m1.jpg', thumbPath: null }),
    );
  });

  test('when thumbnail generation succeeds, both the original and the thumb are uploaded as before', async () => {
    ImageManipulator.manipulateAsync
      .mockResolvedValueOnce({ uri: 'file://compressed.jpg' }) // compressPhoto
      .mockResolvedValueOnce({ uri: 'file://thumb.jpg' }); // makeThumbnail

    const result = await processUpload(baseEntry);

    expect(result).toEqual({ storagePath: 't1/r1/m1.jpg', thumbPath: 't1/r1/thumbs/m1.jpg' });
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(insertMediaRow).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: 't1/r1/m1.jpg', thumbPath: 't1/r1/thumbs/m1.jpg' }),
    );
  });
});
