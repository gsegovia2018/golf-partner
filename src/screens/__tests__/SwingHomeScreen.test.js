import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingHomeScreen, { groupByMonth, formatBytes } from '../SwingHomeScreen';
import * as store from '../../store/swingStore';
import { getSwingAvailability } from '../../swing/availability';
import { pickSwingVideo } from '../../swing/importVideo';
import { SWING_STRINGS } from '../../swing/strings';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../../store/swingStore', () => ({
  subscribeSwings: jest.fn(() => () => {}),
  getSwingsVersion: jest.fn(() => 0),
  getSwings: jest.fn(() => []),
  getSwingProfile: jest.fn(() => ({ heightCm: null, handedness: 'right', asked: true })),
  hydrateSwings: jest.fn(() => Promise.resolve()),
  createSwing: jest.fn(),
  deleteSwing: jest.fn(),
  storageBytes: jest.fn(() => 184 * 1024 * 1024),
  setSwingProfile: jest.fn(() => Promise.resolve()),
  defaultSwingName: jest.requireActual('../../store/swingStore').defaultSwingName,
}));
jest.mock('../../swing/availability', () => ({ getSwingAvailability: jest.fn() }));
jest.mock('../../swing/importVideo', () => ({ pickSwingVideo: jest.fn() }));

const sw = (id, iso, extra = {}) => ({
  id,
  createdAt: iso,
  name: store.defaultSwingName(iso),
  status: 'ready',
  club: null,
  source: 'import',
  mainFault: 'early_extension',
  counts: { green: 6, yellow: 3, red: 2 },
  fps: { capture: 240, effective: 240, factor: 8, approximate: false },
  thumb: null,
  bytes: 1000,
  marked: { state: 'done', count: 6 },
  ...extra,
});

const A = sw('a', '2026-10-11T16:42:00.000Z');
const B = sw('b', '2026-09-27T10:00:00.000Z', { mainFault: 'over_the_top', counts: { green: 9, yellow: 2, red: 0 }, fps: { capture: 120, effective: 120, factor: 4, approximate: true } });

function setup({ swings = [], availability = { supported: true }, profile } = {}) {
  store.getSwings.mockReturnValue(swings);
  getSwingAvailability.mockReturnValue(availability);
  if (profile) store.getSwingProfile.mockReturnValue(profile);
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  const utils = render(<ThemeProvider><SwingHomeScreen navigation={navigation} /></ThemeProvider>);
  return { ...utils, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  store.getSwingProfile.mockReturnValue({ heightCm: null, handedness: 'right', asked: true });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('groupByMonth / formatBytes', () => {
  test('groups newest-first swings by month, keeping order', () => {
    const g = groupByMonth([A, sw('c', '2026-10-02T09:00:00.000Z'), B]);
    expect(g.map((x) => x.swings.map((s) => s.id))).toEqual([['a', 'c'], ['b']]);
    expect(g[0].label).toMatch(/^October/);
  });
  test('formats sizes', () => {
    expect(formatBytes(184 * 1024 * 1024)).toBe('184 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('SwingHomeScreen', () => {
  test('empty state teaches the set-up and shows the privacy line', () => {
    const { getByText, queryByText } = setup();
    expect(getByText(SWING_STRINGS.home.emptyTitle)).toBeTruthy();
    expect(getByText(/phone on your toe line, at hand height, aimed at your hands/)).toBeTruthy();
    expect(getByText('Your video and analysis stay on this phone. Nothing is uploaded.')).toBeTruthy();
    expect(queryByText(/long-press it for more/)).toBeNull();
  });

  test('lists swings led by the main fault, with counts, fps tag and footer', () => {
    const { getByText, getAllByText } = setup({ swings: [A, B] });
    expect(getByText('Early extension')).toBeTruthy();
    expect(getByText('Over the top')).toBeTruthy();
    expect(getByText('240 FPS')).toBeTruthy();
    expect(getByText('120 FPS · APPROX')).toBeTruthy();
    expect(getAllByText('6').length).toBeGreaterThan(0);
    expect(getByText('2 swings · 184 MB on this phone · swipe a row or long-press it for more')).toBeTruthy();
    expect(getByText(/MediaPipe/)).toBeTruthy();
    expect(getByText(/YOLOX .*CC BY 4\.0/)).toBeTruthy();
  });

  test('a swing still being analysed or failed says so instead of a fault', () => {
    const { getByText } = setup({
      swings: [sw('p', '2026-10-11T10:00:00.000Z', { status: 'pending', mainFault: null, counts: null, fps: null }),
        sw('e', '2026-10-10T10:00:00.000Z', { status: 'error', error: 'no_pose', mainFault: null, counts: null, fps: null })],
    });
    expect(getByText('Analysing')).toBeTruthy();
    expect(getByText('Could not analyse')).toBeTruthy();
  });

  test('tapping a row opens its results', () => {
    const { getByLabelText, navigation } = setup({ swings: [A] });
    fireEvent.press(getByLabelText(/^Early extension, /));
    expect(navigation.navigate).toHaveBeenCalledWith('SwingResults', { swingId: 'a' });
  });

  test('Record opens the capture route', () => {
    const { getByLabelText, navigation } = setup();
    fireEvent.press(getByLabelText('Record'));
    expect(navigation.navigate).toHaveBeenCalledWith('SwingCapture');
  });

  test('Import picks a video, stores a swing and opens results', async () => {
    pickSwingVideo.mockResolvedValue({ uri: 'file:///clip.mp4' });
    store.createSwing.mockResolvedValue({ id: 'new1' });
    const { getByLabelText, navigation } = setup();
    fireEvent.press(getByLabelText('Import'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('SwingResults', { swingId: 'new1' }));
    expect(store.createSwing).toHaveBeenCalledWith(expect.objectContaining({ videoUri: 'file:///clip.mp4', source: 'import' }));
  });

  describe('club per video (D27) and the marking pass (D26)', () => {
    test('no club picker on Home: Record and Import leave the club to the club sheet', async () => {
      pickSwingVideo.mockResolvedValue({ uri: 'file:///clip.mp4' });
      store.createSwing.mockResolvedValue({ id: 'new1' });
      const { queryByLabelText, getByLabelText, navigation } = setup();
      expect(queryByLabelText('Iron')).toBeNull();
      expect(queryByLabelText('Driver')).toBeNull();
      fireEvent.press(getByLabelText('Import'));
      await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('SwingResults', { swingId: 'new1' }));
      expect(store.createSwing.mock.calls[0][0].club).toBeUndefined();
    });

    test('each row shows its stored club as a chip (a swing from before the picker reads Iron)', () => {
      const { getByTestId } = setup({ swings: [A, sw('d', '2026-10-01T10:00:00.000Z', { club: 'driver' })] });
      expect(getByTestId('club-chip-a').props.children).toBe('Iron');
      expect(getByTestId('club-chip-d').props.children).toBe('Driver');
    });

    test('an unfinished marking pass says "n of 6 confirmed · Continue" and resumes the canvas, not Results', () => {
      const partial = sw('m', '2026-10-12T10:00:00.000Z', { marked: { state: 'partial', count: 2 } });
      const fresh = sw('n', '2026-10-12T09:00:00.000Z', { marked: { state: 'none', count: 0 } });
      const { getByText, getByLabelText, navigation } = setup({ swings: [partial, fresh] });
      expect(getByText(SWING_STRINGS.home.continueMarking(2, 6))).toBeTruthy();
      expect(getByText(SWING_STRINGS.home.continueMarking(0, 6))).toBeTruthy();
      fireEvent.press(getByLabelText(/^2 of 6 confirmed/));
      expect(navigation.navigate).toHaveBeenCalledWith('SwingEditMarks', { swingId: 'm', mode: 'pass' });
    });

    test('review: a swing whose pass 2 is still running says Analysing and offers no Continue', () => {
      const running = sw('r', '2026-10-12T11:00:00.000Z', { status: 'pending', marked: { state: 'none', count: 0 } });
      const { getByText, queryByText, getByLabelText, navigation } = setup({ swings: [running] });
      expect(getByText(SWING_STRINGS.home.analysing)).toBeTruthy();
      expect(queryByText(/Continue/)).toBeNull();
      fireEvent.press(getByLabelText(/^Analysing, /));
      expect(navigation.navigate).toHaveBeenCalledWith('SwingResults', { swingId: 'r' });
    });

    test('a row from before the mark-first flow (no state yet) opens Results, which decides', () => {
      const { getByLabelText, navigation } = setup({ swings: [sw('o', '2026-10-01T10:00:00.000Z', { marked: undefined })] });
      fireEvent.press(getByLabelText(/^Early extension, /));
      expect(navigation.navigate).toHaveBeenCalledWith('SwingResults', { swingId: 'o' });
    });
  });

  test('cancelling the picker creates nothing', async () => {
    pickSwingVideo.mockResolvedValue(null);
    const { getByLabelText, navigation } = setup();
    fireEvent.press(getByLabelText('Import'));
    await waitFor(() => expect(pickSwingVideo).toHaveBeenCalled());
    expect(store.createSwing).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('a failed import alerts and stays put', async () => {
    pickSwingVideo.mockResolvedValue({ uri: 'file:///clip.mp4' });
    store.createSwing.mockRejectedValue(new Error('disk'));
    const { getByLabelText, navigation } = setup();
    fireEvent.press(getByLabelText('Import'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(SWING_STRINGS.home.importFailed));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test('first run asks height and handedness before the action, then carries on', async () => {
    store.getSwingProfile.mockReturnValue({ heightCm: null, handedness: 'right', asked: false });
    const { getByLabelText, getByText, navigation } = setup();
    fireEvent.press(getByLabelText('Record'));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(getByText('Before your first analysis')).toBeTruthy();
    const save = getByLabelText('Save and analyse');
    expect(save.props.accessibilityState?.disabled ?? save.props['aria-disabled']).toBeTruthy();
    fireEvent.changeText(getByLabelText('Height'), '181');
    fireEvent.press(getByLabelText('Left-handed'));
    await act(async () => { fireEvent.press(getByLabelText('Save and analyse')); });
    expect(store.setSwingProfile).toHaveBeenCalledWith({ heightCm: 181, handedness: 'left' });
    expect(navigation.navigate).toHaveBeenCalledWith('SwingCapture');
  });

  test('skipping stores no height (approximate) and still carries on', async () => {
    store.getSwingProfile.mockReturnValue({ heightCm: null, handedness: 'right', asked: false });
    const { getByLabelText, getByText, navigation } = setup();
    fireEvent.press(getByLabelText('Record'));
    expect(getByText(/Skip for now · use \d+ cm \(approx\.\)/)).toBeTruthy();
    await act(async () => { fireEvent.press(getByLabelText(/^Skip for now/)); });
    expect(store.setSwingProfile).toHaveBeenCalledWith({ heightCm: null, handedness: 'right' });
    expect(navigation.navigate).toHaveBeenCalledWith('SwingCapture');
  });

  test('an implausible height keeps Save disabled and explains', () => {
    store.getSwingProfile.mockReturnValue({ heightCm: null, handedness: 'right', asked: false });
    const { getByLabelText, getByText } = setup();
    fireEvent.press(getByLabelText('Record'));
    fireEvent.changeText(getByLabelText('Height'), '12');
    expect(getByText(SWING_STRINGS.profileSheet.invalid)).toBeTruthy();
  });

  test('older binary: banner shown, Record/Import disabled, saved swings still listed', () => {
    const { getByText, getByLabelText, navigation } = setup({ swings: [A], availability: { supported: false, reason: 'update' } });
    expect(getByText(SWING_STRINGS.home.updateTitle)).toBeTruthy();
    expect(getByText('Early extension')).toBeTruthy();
    fireEvent.press(getByLabelText('Record'));
    fireEvent.press(getByLabelText('Import'));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(pickSwingVideo).not.toHaveBeenCalled();
  });

  test('long-press opens the row actions; Compare starts the pair, a second row completes it, Compare navigates', () => {
    const { getByLabelText, getByText, queryByText, navigation } = setup({ swings: [A, B] });
    fireEvent(getByLabelText(/^Early extension, /), 'longPress');
    fireEvent.press(getByLabelText(SWING_STRINGS.home.compareWith));
    expect(getByText(SWING_STRINGS.home.pickTwo)).toBeTruthy();
    expect(getByText('1 of 2 picked.')).toBeTruthy();
    expect(queryByText('Record')).toBeNull();
    fireEvent.press(getByLabelText(/^Over the top, /));
    const label = SWING_STRINGS.home.compare('Sun 11 Oct', 'Sun 27 Sep');
    fireEvent.press(getByLabelText(label));
    expect(navigation.navigate).toHaveBeenCalledWith('SwingCompare', { ids: ['a', 'b'] });
  });

  test('long-press with a single swing offers Delete only (nothing to compare with)', () => {
    const { getByLabelText, queryByLabelText } = setup({ swings: [A] });
    fireEvent(getByLabelText(/^Early extension, /), 'longPress');
    expect(getByLabelText(SWING_STRINGS.home.deleteSwing)).toBeTruthy();
    expect(queryByLabelText(SWING_STRINGS.home.compareWith)).toBeNull();
  });

  test('long-press > Delete swing asks first, then deletes only on confirm (no swiping needed)', () => {
    const { getByLabelText } = setup({ swings: [A, B] });
    fireEvent(getByLabelText(/^Over the top, /), 'longPress');
    fireEvent.press(getByLabelText(SWING_STRINGS.home.deleteSwing));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe(SWING_STRINGS.home.deleteTitle);
    expect(body).toBe(SWING_STRINGS.home.deleteBody);
    expect(store.deleteSwing).not.toHaveBeenCalled();
    buttons.find((b) => b.style === 'destructive').onPress();
    expect(store.deleteSwing).toHaveBeenCalledWith('b');
  });
});
