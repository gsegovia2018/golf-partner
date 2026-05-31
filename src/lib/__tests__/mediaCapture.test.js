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
      .rejects.toThrow('Los vídeos de galería deben ser de 100 MB o menos.');
  });
});
