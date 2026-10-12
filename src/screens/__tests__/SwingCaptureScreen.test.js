import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SwingCaptureScreen from '../SwingCaptureScreen';
import * as native from '../../swing/native';
import { createSwing } from '../../store/swingStore';
import { pickSwingVideo } from '../../swing/importVideo';
import { SWING_STRINGS } from '../../swing/strings';

const T = SWING_STRINGS.capture;

jest.setTimeout(20000);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockDeleted = [];
jest.mock('expo-file-system', () => {
  class File {
    constructor(...parts) { this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/'); }
    get exists() { return true; }
    delete() { mockDeleted.push(this.uri); }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } };
});

const mockPermission = { current: { granted: true, canAskAgain: true } };
const mockRequest = jest.fn();
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPermission.current, mockRequest, jest.fn()],
}));

jest.mock('../../store/swingStore', () => ({
  createSwing: jest.fn(),
  getSwingProfile: jest.fn(() => ({ handedness: 'right' })),
}));
jest.mock('../../swing/importVideo', () => ({ pickSwingVideo: jest.fn() }));

// The native preview: becomes ready on mount and records on demand.
const mockCamera = { start: jest.fn(), stop: jest.fn(), mounts: 0 };
jest.mock('../../swing/native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef(function MockCameraView({ onCameraReady, mode }, ref) {
    React.useImperativeHandle(ref, () => ({
      startRecording: (o) => mockCamera.start(o),
      stopRecording: () => mockCamera.stop(),
    }));
    React.useEffect(() => { mockCamera.mounts += 1; onCameraReady?.({ nativeEvent: mode }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return React.createElement(View, { testID: 'native-camera' });
  });
  return {
    captureSupport: jest.fn(() => ({ supported: true, reason: null, apiVersion: 2, message: null })),
    getCameraView: jest.fn(() => CameraView),
    listRecordingModes: jest.fn(),
  };
});

const HS240 = { cameraId: '0', width: 1280, height: 720, fps: 240, highSpeed: true };
const N30 = { cameraId: '0', width: 1920, height: 1080, fps: 30, highSpeed: false };
const TAKE = { path: 'file:///cache/swing-take-1.mp4', fps: 240, width: 1280, height: 720, highSpeed: true, durationMs: 4100 };

function setup({ modes = [HS240] } = {}) {
  native.listRecordingModes.mockResolvedValue(modes);
  const navigation = { goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
  const utils = render(<SwingCaptureScreen navigation={navigation} route={{ params: { club: 'driver' } }} />);
  return { ...utils, navigation };
}

// Generous waits: the full suite runs in parallel and a busy worker is slow to settle.
const WAIT = { timeout: 5000 };

async function recordAndStop(utils) {
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy(), WAIT);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
  await waitFor(() => expect(mockCamera.start).toHaveBeenCalled(), WAIT);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
  await waitFor(() => expect(utils.getByTestId('capture-review')).toBeTruthy(), WAIT);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleted.length = 0;
  mockCamera.mounts = 0;
  mockCamera.start.mockResolvedValue(null);
  mockCamera.stop.mockResolvedValue(TAKE);
  mockPermission.current = { granted: true, canAskAgain: true };
  native.captureSupport.mockReturnValue({ supported: true, reason: null, apiVersion: 2, message: null });
});

test('shows the 240 fps pill, the privacy line and the set-up guide', async () => {
  const utils = setup();
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy());
  expect(utils.getByText('240 fps')).toBeTruthy();
  expect(utils.getByText(SWING_STRINGS.privacy)).toBeTruthy();
  await waitFor(() => expect(utils.getByTestId('capture-guide-card')).toBeTruthy());
  fireEvent.press(utils.getByTestId('capture-guide-dismiss'));
  expect(utils.queryByTestId('capture-guide-card')).toBeNull();
});

test('records into the cache and stops into the review step without analysing', async () => {
  const utils = setup();
  await recordAndStop(utils);
  expect(mockCamera.start).toHaveBeenCalledWith({ outPath: expect.stringMatching(/^file:\/\/\/cache\/swing-take-\d+\.mp4$/) });
  expect(utils.getByText(T.review('4.1', 240, 0.125))).toBeTruthy();
  // Review comes before any decode: nothing is stored or analysed yet, and the camera is closed.
  expect(createSwing).not.toHaveBeenCalled();
  expect(utils.queryByTestId('native-camera')).toBeNull();
  expect(utils.getByText(T.retake)).toBeTruthy();
  expect(utils.getByText(T.analyse)).toBeTruthy();
});

test('Analyse feeds the import pipeline and replaces the screen with Results', async () => {
  createSwing.mockResolvedValue({ id: 'sw1' });
  const utils = setup();
  await recordAndStop(utils);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-analyse')); });
  expect(createSwing).toHaveBeenCalledWith(expect.objectContaining({ videoUri: TAKE.path, source: 'camera', club: 'driver' }));
  expect(utils.navigation.replace).toHaveBeenCalledWith('SwingResults', { swingId: 'sw1' });
  expect(mockDeleted).toContain(TAKE.path);
});

test('Retake deletes the take and reopens the camera', async () => {
  const utils = setup();
  await recordAndStop(utils);
  fireEvent.press(utils.getByTestId('capture-retake'));
  expect(mockDeleted).toContain(TAKE.path);
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy());
  expect(mockCamera.mounts).toBe(2);
});

test('leaving with an unreviewed take deletes it', async () => {
  const utils = setup();
  await recordAndStop(utils);
  utils.unmount();
  expect(mockDeleted).toContain(TAKE.path);
});

test('auto-stops at 8 s', async () => {
  jest.useFakeTimers();
  try {
    const utils = setup();
    await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy());
    await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
    expect(mockCamera.stop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(7900); });
    expect(mockCamera.stop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(mockCamera.stop).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('a phone without high speed gets the fallback card first', async () => {
  pickSwingVideo.mockResolvedValue({ uri: 'content://slowmo.mp4' });
  createSwing.mockResolvedValue({ id: 'imp' });
  const utils = setup({ modes: [N30] });
  await waitFor(() => expect(utils.getByTestId('capture-fallback')).toBeTruthy());
  expect(utils.getByText(T.fallbackTitle(30))).toBeTruthy();
  expect(utils.queryByTestId('capture-record')).toBeNull();

  fireEvent.press(utils.getByTestId('capture-record-anyway'));
  expect(utils.getByText('30 fps · approximate analysis')).toBeTruthy();
  expect(utils.getByTestId('capture-record')).toBeTruthy();
});

test('the fallback import goes straight to Results', async () => {
  pickSwingVideo.mockResolvedValue({ uri: 'content://slowmo.mp4' });
  createSwing.mockResolvedValue({ id: 'imp' });
  const utils = setup({ modes: [N30] });
  await waitFor(() => expect(utils.getByTestId('capture-fallback')).toBeTruthy());
  await act(async () => { fireEvent.press(utils.getByText(T.importSlowMo)); });
  expect(createSwing).toHaveBeenCalledWith(expect.objectContaining({ videoUri: 'content://slowmo.mp4', source: 'import' }));
  expect(utils.navigation.replace).toHaveBeenCalledWith('SwingResults', { swingId: 'imp' });
});

test('an older binary never touches the camera and offers the import instead', async () => {
  native.captureSupport.mockReturnValue({ supported: false, reason: 'update_app', apiVersion: 1, message: 'Update the app to record here.' });
  const utils = setup();
  await waitFor(() => expect(utils.getByTestId('capture-update')).toBeTruthy());
  expect(native.getCameraView).not.toHaveBeenCalled();
  expect(native.listRecordingModes).not.toHaveBeenCalled();
  expect(utils.getByText(T.importSlowMo)).toBeTruthy();
});

test('a denied permission shows the settings card', async () => {
  mockPermission.current = { granted: false, canAskAgain: false };
  const utils = setup();
  await waitFor(() => expect(utils.getByTestId('capture-permission')).toBeTruthy());
  expect(utils.getByText(T.openSettings)).toBeTruthy();
  expect(native.listRecordingModes).not.toHaveBeenCalled();
});
