import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingSharedScreen, { sharedSwingTitle } from '../SwingSharedScreen';
import { getPublicSwing } from '../../store/swingShareStore';
import { analyze } from '../../swing/analyze';
import { SWING_STRINGS } from '../../swing/strings';
import { fixtureNative, TRUTH, W, H } from '../../swing/__tests__/helpers';

const lab = require('../../swing/__tests__/fixtures/lab-d15-pass1.json');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('../../store/swingShareStore', () => ({ getPublicSwing: jest.fn() }));
jest.mock('../../swing/frames', () => ({
  nativeApi: jest.fn(() => null), getStill: jest.fn(() => null), ensureStills: jest.fn(() => Promise.resolve({})),
}));

const norm = (p) => (p ? [p.x / W, p.y / H] : null);
const ball = { x: TRUTH.ball.x / W, y: TRUTH.ball.y / H, r: 2.1 / W };
const pose = fixtureNative({ ball, ballGoneFrame: lab.expected.ballGoneFrame });
const base = { pass2: { addressFrame: lab.expected.addressFrame, shaft: {} }, heightCm: 176, handedness: 'right' };
const marks = Object.fromEntries(Object.entries(TRUTH.checkpoints).map(([k, c]) => [k, {
  hands: norm(c.hands), head: c.hidden ? null : norm(c.head), hidden: c.hidden,
}]));
const ANALYSIS = analyze(pose, { ...base, marks });
const P = SWING_STRINGS.share.public;
const R = SWING_STRINGS.results;

const DATA = {
  meta: { sharer: 'Íñigo E.', title: null, club: 'iron', recorded_at: '2026-10-29T10:00:00.000Z', shared_at: '2026-10-30T10:00:00.000Z' },
  analysis: ANALYSIS,
  pose: { ...pose, pass2: base.pass2 },
  frames: [],
  videoUrl: 'https://cdn.test/T/video.mp4',
  stillUrl: jest.fn(() => 'https://cdn.test/T/frames/1.jpg'),
};

const show = (props) => render(<ThemeProvider><SwingSharedScreen token="T" {...props} /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

describe('SwingSharedScreen: a shared swing, signed out', () => {
  test('shows the analysis read-only, who shared it, and the sign-up card', async () => {
    getPublicSwing.mockResolvedValue(DATA);
    const onAuth = jest.fn();
    const u = show({ onAuth });
    await u.findByTestId('results-summary');
    expect(getPublicSwing).toHaveBeenCalledWith('T');
    expect(u.getByText(P.sharedBy('Íñigo E.'))).toBeTruthy();
    expect(u.getByTestId('results-title').props.children).toBe(sharedSwingTitle(DATA.meta));
    // none of the owner's tools
    expect(u.queryByLabelText(R.menu)).toBeNull();
    expect(u.queryByTestId('results-edit-marks')).toBeNull();
    expect(u.queryByTestId('results-nudge')).toBeNull();
    expect(u.queryByTestId('results-view')).toBeNull();
    expect(u.queryByLabelText(R.back)).toBeNull();
    // the still comes from the link's files
    expect(DATA.stillUrl).toHaveBeenCalled();
    fireEvent.press(u.getByTestId('swing-shared-signup'));
    expect(onAuth).toHaveBeenCalledWith('signup');
    fireEvent.press(u.getByTestId('swing-shared-signin'));
    expect(onAuth).toHaveBeenLastCalledWith('signin');
  });

  test('a closed link says so and still offers an account', async () => {
    getPublicSwing.mockResolvedValue(null);
    const u = show({ onAuth: jest.fn() });
    expect(await u.findByText(P.offTitle)).toBeTruthy();
    expect(u.getByTestId('swing-shared-cta')).toBeTruthy();
    expect(u.queryByTestId('swing-shared-retry')).toBeNull();
  });

  test('a failed load offers a retry that loads again', async () => {
    getPublicSwing.mockRejectedValueOnce(Object.assign(new Error('x'), { offline: true }));
    getPublicSwing.mockResolvedValueOnce(DATA);
    const u = show({ onAuth: jest.fn() });
    expect(await u.findByText(P.errorTitle)).toBeTruthy();
    fireEvent.press(u.getByTestId('swing-shared-retry'));
    await u.findByTestId('results-summary');
    expect(getPublicSwing).toHaveBeenCalledTimes(2);
  });
});

describe('SwingSharedScreen: signed in (routed)', () => {
  test('a back button and no sign-up card', async () => {
    getPublicSwing.mockResolvedValue(DATA);
    const navigation = { canGoBack: jest.fn(() => false), goBack: jest.fn(), navigate: jest.fn() };
    const u = render(<ThemeProvider><SwingSharedScreen route={{ params: { token: 'T' } }} navigation={navigation} /></ThemeProvider>);
    await u.findByTestId('results-summary');
    expect(u.queryByTestId('swing-shared-cta')).toBeNull();
    fireEvent.press(u.getByLabelText(R.back));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Main'));
  });
});

describe('sharedSwingTitle', () => {
  test("the owner's own name, else club · date", () => {
    expect(sharedSwingTitle({ title: 'Mi driver' })).toBe('Mi driver');
    expect(sharedSwingTitle({ club: 'driver', recorded_at: '2026-10-29T10:00:00Z' })).toMatch(new RegExp(`^${SWING_STRINGS.club.driver} · `));
  });
});
