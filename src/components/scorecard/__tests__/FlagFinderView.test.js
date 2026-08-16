import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { FlagFinderView, flagOverlayState } from '../FlagFinderView';

// --- flagOverlayState (pure helper) -----------------------------------

describe('flagOverlayState', () => {
  it('centers the marker at x=0 when heading points straight at the flag', () => {
    expect(flagOverlayState({ heading: 90, bearing: 90 })).toEqual({
      mode: 'marker', x: 0, deltaDeg: 0,
    });
  });

  it('places the marker at the right edge (x=1) exactly at the FOV edge', () => {
    const r = flagOverlayState({ heading: 0, bearing: 30 });
    expect(r.mode).toBe('marker');
    expect(r.x).toBeCloseTo(1);
    expect(r.deltaDeg).toBeCloseTo(30);
  });

  it('places the marker at the left edge (x=-1) exactly at the FOV edge', () => {
    const r = flagOverlayState({ heading: 0, bearing: -30 });
    expect(r.mode).toBe('marker');
    expect(r.x).toBeCloseTo(-1);
    expect(r.deltaDeg).toBeCloseTo(-30);
  });

  it('flips to a right-pointing chevron just past the FOV edge', () => {
    const r = flagOverlayState({ heading: 0, bearing: 31 });
    expect(r.mode).toBe('chevron');
    expect(r.x).toBeNull();
    expect(r.deltaDeg).toBeCloseTo(31);
  });

  it('flips to a left-pointing chevron just past the FOV edge', () => {
    const r = flagOverlayState({ heading: 0, bearing: -31 });
    expect(r.mode).toBe('chevron');
    expect(r.x).toBeNull();
    expect(r.deltaDeg).toBeCloseTo(-31);
  });

  it('handles the north wrap-around (heading 350, bearing 10 -> marker x ~0.67)', () => {
    const r = flagOverlayState({ heading: 350, bearing: 10 });
    expect(r.mode).toBe('marker');
    expect(r.deltaDeg).toBeCloseTo(20);
    expect(r.x).toBeCloseTo(20 / 30, 5);
  });

  it('respects a custom halfFovDeg', () => {
    expect(flagOverlayState({ heading: 0, bearing: 50, halfFovDeg: 60 }).mode).toBe('marker');
    expect(flagOverlayState({ heading: 0, bearing: 50, halfFovDeg: 40 }).mode).toBe('chevron');
  });
});

// --- FlagFinderView (component) -----------------------------------------
// expo-camera and every live-sensor hook are mocked here so the component
// tree never touches a real camera/GPS/compass module — each test drives
// the hook return values directly to exercise one progressive state at a
// time (see the CLAUDE.md task note: skip component rendering if the
// jest-expo environment fights expo-camera; it doesn't, since both exports
// used by the component are mocked outright below).

// Jest's mock-hoisting only allows factory functions to close over
// identifiers prefixed with "mock" (case-insensitive) — hence the naming
// below, not stylistic preference.
let mockCameraPermission = { granted: true, canAskAgain: true, status: 'granted' };
const mockRequestCameraPermission = jest.fn();
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [mockCameraPermission, mockRequestCameraPermission],
}));

let mockGpsResult = { position: [38.55, -0.14], accuracy: 8, distances: { pin: 120, center: 125 } };
jest.mock('../../../hooks/useGpsDistances', () => ({
  useGpsDistances: () => mockGpsResult,
}));

let mockCompassResult = { heading: 90, lowAccuracy: false, status: 'ok', requestPermission: jest.fn() };
jest.mock('../../../hooks/useCompassHeading', () => ({
  useCompassHeading: () => mockCompassResult,
}));

jest.mock('../../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ units: 'meters' }),
}));

let mockTarget = [38.551, -0.14];
jest.mock('../../../lib/geo', () => ({
  ...jest.requireActual('../../../lib/geo'),
  holeTargetPoint: () => mockTarget,
}));

const baseProps = {
  visible: true, courseName: 'Villaitana Levante', holeNumber: 7, onClose: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCameraPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockGpsResult = { position: [38.55, -0.14], accuracy: 8, distances: { pin: 120, center: 125 } };
  mockCompassResult = { heading: 90, lowAccuracy: false, status: 'ok', requestPermission: jest.fn() };
  mockTarget = [38.551, -0.14]; // due north of the fix -> bearing 0
});

describe('FlagFinderView', () => {
  it('renders nothing when not visible', () => {
    const { toJSON } = render(<FlagFinderView {...baseProps} visible={false} />);
    expect(toJSON()).toBeNull();
  });

  it('shows the hole number and closes on the X button', () => {
    const { getByText, getByLabelText } = render(<FlagFinderView {...baseProps} />);
    getByText('Hole 7');
    fireEvent.press(getByLabelText('Close flag finder'));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it('prompts to enable the compass on iOS-web before anything else', () => {
    mockCompassResult = { ...mockCompassResult, status: 'needs-permission' };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    const btn = getByText('Enable compass');
    fireEvent.press(btn);
    expect(mockCompassResult.requestPermission).toHaveBeenCalled();
  });

  it('reports an unavailable compass', () => {
    mockCompassResult = { ...mockCompassResult, status: 'unavailable', heading: null };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText('Compass not available on this device');
  });

  it('shows a locating message before the first GPS fix', () => {
    mockGpsResult = { ...mockGpsResult, position: null };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText('Locating GPS…');
  });

  it('says the hole is not mapped when there is no target', () => {
    mockTarget = null;
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText("This hole isn't mapped yet");
  });

  it('shows a reading-compass message before the first heading', () => {
    mockCompassResult = { ...mockCompassResult, heading: null };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText('Reading compass…');
  });

  it('renders the marker + distance when the flag is within the camera cone', () => {
    // Fix is due south of the target -> bearing ~0 (north); heading 0 points
    // the camera straight at it, landing well inside the FOV.
    mockCompassResult = { ...mockCompassResult, heading: 0 };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText('120m');
  });

  it('renders a chevron banner when the flag is outside the camera cone', () => {
    // Fix is due north of the target -> bearing ~0. Facing west (heading 270)
    // means a 90° clockwise turn gets you there, i.e. "to your right".
    mockCompassResult = { ...mockCompassResult, heading: 270 };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText(/Flag · 90° to your right ▶/);
  });

  it('shows the camera-off caption when permission is not granted', () => {
    mockCameraPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText('Camera off — compass still works');
  });

  it('surfaces the low-accuracy GPS and compass captions together', () => {
    mockGpsResult = { ...mockGpsResult, accuracy: 22 };
    mockCompassResult = { ...mockCompassResult, heading: 0, lowAccuracy: true };
    const { getByText } = render(<FlagFinderView {...baseProps} />);
    getByText(/GPS accuracy ±22m — direction is approximate/);
    getByText('Compass needs calibration — wave your phone in a figure 8');
  });
});
