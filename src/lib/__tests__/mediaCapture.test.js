jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: {
    All: 'All',
    Images: 'Images',
    Videos: 'Videos',
  },
  UIImagePickerControllerQualityType: {
    IFrame1280x720: 'IFrame1280x720',
  },
  VideoExportPreset: {
    H264_1280x720: 'H264_1280x720',
  },
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })),
}));

jest.mock('../../store/mediaQueue', () => ({
  enqueueMedia: jest.fn(() => Promise.resolve()),
}));

jest.mock('../uploadWorker', () => ({
  kickUploadWorker: jest.fn(),
}));

const ImagePicker = require('expo-image-picker');
const { pickMedia } = require('../mediaCapture');

describe('pickMedia', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('captures camera videos with smaller 720p output settings', async () => {
    await pickMedia({ source: 'camera', mediaTypes: 'video' });

    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.7,
      videoMaxDuration: 20,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
      videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    }));
  });

  test('rejects gallery videos over the upload limit before enqueueing', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        uri: 'file:///large-video.mov',
        type: 'video',
        duration: 12_000,
        fileSize: 150 * 1024 * 1024,
        mimeType: 'video/quicktime',
        fileName: 'large-video.mov',
      }],
    });

    await expect(pickMedia({ source: 'library', mediaTypes: 'all' }))
      .rejects.toThrow('Gallery videos must be 100 MB or smaller.');
  });

  test('rejects camera-recorded videos over the upload limit — the size cap is not gallery-only', async () => {
    ImagePicker.launchCameraAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        uri: 'file:///camera-video.mov',
        type: 'video',
        duration: 15_000,
        fileSize: 150 * 1024 * 1024,
        mimeType: 'video/quicktime',
        fileName: 'camera-video.mov',
      }],
    });

    await expect(pickMedia({ source: 'camera', mediaTypes: 'video' }))
      .rejects.toThrow('100 MB');
  });

  test('accepts an in-size gallery video and returns the mapped asset', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        uri: 'file:///small-video.mov',
        type: 'video',
        duration: 12_000,
        fileSize: 10 * 1024 * 1024,
        mimeType: 'video/quicktime',
        fileName: 'small-video.mov',
      }],
    });

    const result = await pickMedia({ source: 'library', mediaTypes: 'all' });

    expect(result).toEqual(expect.objectContaining({
      localUri: 'file:///small-video.mov',
      kind: 'video',
      fileSize: 10 * 1024 * 1024,
    }));
  });
});

describe('pickMedia on web — size cap when fileSize is missing', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('rejects an oversized web video by deriving its size from the Blob when fileSize is absent', async () => {
    jest.resetModules();
    jest.doMock('react-native', () => {
      const RN = jest.requireActual('react-native');
      RN.Platform.OS = 'web';
      return RN;
    });
    const ImagePickerWeb = require('expo-image-picker');
    ImagePickerWeb.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        uri: 'blob:web-large-video',
        type: 'video',
        duration: 12_000,
        // Web pickers can omit fileSize entirely.
        mimeType: 'video/webm',
        fileName: 'large.webm',
      }],
    });
    global.fetch = jest.fn(() => Promise.resolve({
      blob: () => Promise.resolve({ size: 150 * 1024 * 1024 }),
    }));

    const { pickMedia: pickMediaWeb } = require('../mediaCapture');

    await expect(pickMediaWeb({ source: 'library', mediaTypes: 'all' }))
      .rejects.toThrow('100 MB');

    jest.dontMock('react-native');
  });

  test('accepts an in-size web video when fileSize is absent but the derived Blob size is under the cap', async () => {
    jest.resetModules();
    jest.doMock('react-native', () => {
      const RN = jest.requireActual('react-native');
      RN.Platform.OS = 'web';
      return RN;
    });
    const ImagePickerWeb = require('expo-image-picker');
    ImagePickerWeb.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        uri: 'blob:web-small-video',
        type: 'video',
        duration: 12_000,
        mimeType: 'video/webm',
        fileName: 'small.webm',
      }],
    });
    global.fetch = jest.fn(() => Promise.resolve({
      blob: () => Promise.resolve({ size: 5 * 1024 * 1024 }),
    }));

    const { pickMedia: pickMediaWeb } = require('../mediaCapture');

    const result = await pickMediaWeb({ source: 'library', mediaTypes: 'all' });

    expect(result).toEqual(expect.objectContaining({ localUri: 'blob:web-small-video', kind: 'video' }));

    jest.dontMock('react-native');
  });
});
