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

  test('a thumbnail-generation throw does not fail the whole upload — the original uploads and stands in as the thumb placeholder', async () => {
    ImageManipulator.manipulateAsync
      .mockResolvedValueOnce({ uri: 'file://compressed.jpg' }) // compressPhoto (the original)
      .mockRejectedValueOnce(new Error('unsupported codec')); // makeThumbnail

    const result = await processUpload(baseEntry);

    // thumb_path is NOT NULL and consumers render thumbUrl with no fallback,
    // so on thumbnail failure the thumb path must be the ORIGINAL's storage
    // path — never null (which would 23502 on insert and lose the media).
    expect(result).toEqual({ storagePath: 't1/r1/m1.jpg', thumbPath: 't1/r1/m1.jpg' });
    // Only the original was uploaded to storage — no separate thumb upload.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(insertMediaRow).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: 't1/r1/m1.jpg', thumbPath: 't1/r1/m1.jpg' }),
    );
    // Guard against a regression that reintroduces thumbPath: null.
    const insertArg = insertMediaRow.mock.calls[0][0];
    expect(insertArg.thumbPath).not.toBeNull();
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
