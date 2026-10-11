// Jest stand-in for src/swing/native.js (mapped in jest.config.js). Screens and stores
// get a supported module by default; tests override with mockResolvedValue / mockReturnValue.
export const REQUIRED_API_VERSION = 1;
export const UPDATE_APP_MESSAGE = 'Update the app to analyse your swing.';

export const swingSupport = jest.fn(() => ({
  supported: true,
  reason: null,
  apiVersion: REQUIRED_API_VERSION,
  message: null,
}));

export const probeVideo = jest.fn(async () => ({
  width: 478,
  height: 850,
  durationMs: 43277,
  frameCount: 1297,
  containerFps: 29.97,
  captureFps: null,
  rotationDeg: 0,
  duplicateFrameRatio: 0,
}));

export const analyzePose = jest.fn(async () => ({
  video: { width: 478, height: 850, containerFps: 29.97, frameCount: 1297 },
  frames: [],
  ball: null,
  ballGoneFrame: null,
  timings: { decodeMs: 0, inferMs: 0, totalMs: 0, inferences: 0, delegate: 'cpu' },
}));

export const addProgressListener = jest.fn(() => ({ remove: jest.fn() }));
