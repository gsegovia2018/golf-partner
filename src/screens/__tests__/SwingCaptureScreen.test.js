import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
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

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
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
const mockCamera = { start: jest.fn(), stop: jest.fn(), mounts: 0, props: null };
jest.mock('../../swing/native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef(function MockCameraView(props, ref) {
    const { onCameraReady, mode } = props;
    mockCamera.props = props;
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
  const utils = render(<SwingCaptureScreen navigation={navigation} />);
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

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleted.length = 0;
  mockCamera.mounts = 0;
  mockCamera.start.mockResolvedValue(null);
  mockCamera.stop.mockResolvedValue(TAKE);
  mockPermission.current = { granted: true, canAskAgain: true };
  native.captureSupport.mockReturnValue({ supported: true, reason: null, apiVersion: 2, message: null });
});

test('shows the 240 fps pill, the privacy line and the set-up guide, locked to portrait', async () => {
  const utils = setup();
  expect(require('expo-screen-orientation').lockAsync).toHaveBeenCalledWith('PORTRAIT_UP');
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy());
  expect(utils.getByText('240 fps')).toBeTruthy();
  expect(utils.getByText(SWING_STRINGS.privacy)).toBeTruthy();
  await waitFor(() => expect(utils.getByTestId('capture-guide-card')).toBeTruthy());
  fireEvent.press(utils.getByTestId('capture-guide-dismiss'));
  expect(utils.queryByTestId('capture-guide-card')).toBeNull();
});

test('the guide shows the face-on set-up on request and says the view is read from the video', async () => {
  const utils = setup();
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy());
  // the guide opens by itself only until it has been dismissed once (the test above did): open it
  if (!utils.queryByTestId('capture-guide-card')) fireEvent.press(utils.getByTestId('capture-guide-toggle'));
  await waitFor(() => expect(utils.getByTestId('capture-guide-card')).toBeTruthy());
  expect(utils.getByText(T.guideTitle)).toBeTruthy();
  expect(utils.getByText(T.guideAuto)).toBeTruthy();
  fireEvent.press(utils.getByTestId('capture-guide-faceOn'));
  expect(utils.getByText(T.guideTitleFaceOn)).toBeTruthy();
  T.guideTipsFaceOn.forEach((tip) => expect(utils.getByText(tip)).toBeTruthy());
  expect(utils.queryByText(T.guideTitle)).toBeNull();
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

test('Analyse feeds the import pipeline and replaces the screen with Results (the club comes later, D27)', async () => {
  createSwing.mockResolvedValue({ id: 'sw1' });
  const utils = setup();
  await recordAndStop(utils);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-analyse')); });
  expect(createSwing).toHaveBeenCalledWith(expect.objectContaining({ videoUri: TAKE.path, source: 'camera' }));
  expect(createSwing.mock.calls[0][0].club).toBeUndefined();
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

test('leaving while the take is still being finalised deletes it', async () => {
  let finish;
  mockCamera.stop.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const utils = setup();
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy(), WAIT);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
  await waitFor(() => expect(mockCamera.start).toHaveBeenCalled(), WAIT);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
  utils.unmount();
  await act(async () => { finish(TAKE); });
  expect(mockDeleted).toContain(TAKE.path);
});

test('a camera error during a pending start keeps the Retry action', async () => {
  let fail;
  mockCamera.start.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const utils = setup();
  await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy(), WAIT);
  await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
  await act(async () => { mockCamera.props.onCameraError({ nativeEvent: { code: 'ERR_CAMERA' } }); });
  await act(async () => { fail(Object.assign(new Error('gone'), { code: 'ERR_NOT_READY' })); });
  expect(utils.getByText(T.errors.camera)).toBeTruthy();
  expect(utils.getByText(T.retry)).toBeTruthy();
  fireEvent.press(utils.getByText(T.retry));
  await waitFor(() => expect(mockCamera.mounts).toBe(2), WAIT);
});

test('going to the background disables Record until the camera is ready again', async () => {
  const { AppState } = require('react-native');
  const listeners = [];
  const original = AppState.addEventListener;
  AppState.addEventListener = jest.fn((type, cb) => {
    listeners.push(cb);
    return { remove: jest.fn() };
  });
  try {
    const utils = setup();
    await waitFor(() => expect(utils.getByTestId('native-camera')).toBeTruthy(), WAIT);
    expect(utils.getByTestId('capture-record').props.accessibilityState.disabled).toBe(false);
    await act(async () => { listeners.forEach((cb) => cb('background')); });
    expect(utils.getByTestId('capture-record').props.accessibilityState.disabled).toBe(true);
    await act(async () => { mockCamera.props.onCameraReady({ nativeEvent: HS240 }); });
    expect(utils.getByTestId('capture-record').props.accessibilityState.disabled).toBe(false);
  } finally {
    AppState.addEventListener = original;
  }
});

// Fake timers only here, and only for the clock: promises, nextTick and setImmediate stay real
// so React's act() and the testing library can still flush. The screen is unmounted and every
// pending timer drained before the real clock comes back, so nothing leaks into other tests.
describe('auto-stop', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(async () => {
    await act(async () => { cleanup(); });
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('stops the take at 8 s', async () => {
    const utils = setup();
    await act(async () => {});
    expect(utils.getByTestId('native-camera')).toBeTruthy();
    await act(async () => { fireEvent.press(utils.getByTestId('capture-record')); });
    expect(mockCamera.start).toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(7900); });
    expect(mockCamera.stop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(mockCamera.stop).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(utils.getByTestId('capture-review')).toBeTruthy();
  });
});

