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

describe('processUpload on web — video thumbnail object-URL cleanup + size cap', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.dontMock('react-native');
  });

  function loadWebModule() {
    jest.resetModules();
    jest.doMock('react-native', () => {
      const RN = jest.requireActual('react-native');
      RN.Platform.OS = 'web';
      return RN;
    });
    jest.doMock('expo-image-manipulator', () => ({
      manipulateAsync: jest.fn(),
      SaveFormat: { JPEG: 'jpeg' },
    }));
    jest.doMock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
    jest.doMock('expo-file-system', () => ({
      File: jest.fn().mockImplementation(() => ({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })),
    }));
    jest.doMock('../../store/mediaStore', () => ({ insertMediaRow: jest.fn(() => Promise.resolve()) }));
    const mockUploadWeb = jest.fn(() => Promise.resolve({ error: null }));
    jest.doMock('../supabase', () => ({
      supabase: { storage: { from: () => ({ upload: (...args) => mockUploadWeb(...args) }) } },
    }));

    const videoThumb = { generateVideoThumbWeb: jest.fn(() => Promise.resolve('blob:thumb-url')) };
    jest.doMock('../videoThumbWeb', () => videoThumb);

    const { processUpload: processUploadWeb } = require('../mediaUpload');
    return { processUploadWeb, mockUploadWeb, videoThumb };
  }

  const videoEntry = {
    id: 'm2',
    tournamentId: 't1',
    roundId: 'r1',
    holeIndex: 0,
    kind: 'video',
    localUri: 'blob:original-video',
    mimeType: 'video/webm',
    fileName: 'clip.webm',
  };

  test('revokes the generated thumbnail object URL after it is uploaded', async () => {
    const { processUploadWeb, mockUploadWeb } = loadWebModule();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve({ size: 5 * 1024 * 1024 }),
    }));
    const revokeSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await processUploadWeb(videoEntry);

    expect(result.thumbPath).toBe('t1/r1/thumbs/m2.jpg');
    expect(mockUploadWeb).toHaveBeenCalledTimes(2); // original + thumb
    expect(revokeSpy).toHaveBeenCalledWith('blob:thumb-url');

    revokeSpy.mockRestore();
  });

  test('rejects an oversized web video at upload time even if it slipped past the picker-time guard, and still revokes the thumb blob', async () => {
    const { processUploadWeb } = loadWebModule();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve({ size: 150 * 1024 * 1024 }),
    }));
    const revokeSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await expect(processUploadWeb(videoEntry)).rejects.toThrow('100 MB');

    // The thumbnail was already generated (mocked) before the oversized
    // original was rejected — its blob URL must not be left dangling.
    expect(revokeSpy).toHaveBeenCalledWith('blob:thumb-url');

    revokeSpy.mockRestore();
  });

  test('an in-size web video still uploads and inserts the media row as before', async () => {
    const { processUploadWeb, mockUploadWeb } = loadWebModule();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve({ size: 5 * 1024 * 1024 }),
    }));
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await processUploadWeb(videoEntry);

    expect(result).toEqual({ storagePath: 't1/r1/m2.webm', thumbPath: 't1/r1/thumbs/m2.jpg' });
    expect(mockUploadWeb).toHaveBeenCalledTimes(2);
  });
});
