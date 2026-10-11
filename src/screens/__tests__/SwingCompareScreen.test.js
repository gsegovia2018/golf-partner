import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingCompareScreen from '../SwingCompareScreen';
import * as store from '../../store/swingStore';
import { getStill, ensureStills } from '../../swing/frames';
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
  getSwing: jest.fn(),
  hydrateSwings: jest.fn(() => Promise.resolve()),
  readAnalysis: jest.fn(),
  readProbe: jest.fn(),
}));
jest.mock('../../swing/frames', () => ({ getStill: jest.fn(), ensureStills: jest.fn() }));

const T = SWING_STRINGS.compare;
const chk = (id, label, status, value, unit, extra = {}) => ({
  id, label, status, value: status === 'unknown' ? null : value, unit, ...extra,
});
const analysis = (impact, checks, fault) => ({
  checkpoints: { impact: { i: impact } },
  checks,
  main: { fault, evidence: checks.map((c) => ({ id: c.id })) },
});
const NEW = analysis(557, [
  chk('spine_loss', 'Spine angle kept', 'red', 7, '°'),
  chk('hip_drift', 'Hips hold their line', 'red', 14, 'cm'),
  chk('hands_height_impact', 'Hands height at impact', 'yellow', 4, 'cm'),
  chk('clubhead_vs_plane', 'Clubhead on the plane', 'unknown', null, null, { cp: 'impact' }),
], 'early_extension');
const OLD = analysis(560, [
  chk('spine_loss', 'Spine angle kept', 'red', 9, '°'),
  chk('hip_drift', 'Hips hold their line', 'red', 12, 'cm'),
  chk('hands_height_impact', 'Hands height at impact', 'yellow', 7, 'cm'),
  chk('clubhead_vs_plane', 'Clubhead on the plane', 'yellow', 3, 'cm', { cp: 'impact' }),
], 'early_extension');
const ROWS = {
  a: { id: 'a', name: 'Sat 11 Oct · 18:42', createdAt: '2026-10-11T16:42:00.000Z', status: 'ready' },
  b: { id: 'b', name: 'Sat 27 Sep · 18:50', createdAt: '2026-09-27T16:50:00.000Z', status: 'ready' },
};
const ANALYSES = { a: NEW, b: OLD };

function setup(ids = ['b', 'a']) {
  store.getSwing.mockImplementation((id) => ROWS[id] ?? null);
  store.readAnalysis.mockImplementation(async (id) => ANALYSES[id] ?? null);
  store.readProbe.mockResolvedValue({ width: 400, height: 800 });
  const navigation = { goBack: jest.fn() };
  const utils = render(<ThemeProvider><SwingCompareScreen navigation={navigation} route={{ params: { ids } }} /></ThemeProvider>);
  return { ...utils, navigation };
}

beforeEach(() => {
  jest.clearAllMocks();
  getStill.mockImplementation((id, f) => `file:///doc/swings/${id}/frames/${f}.jpg`);
  ensureStills.mockResolvedValue({});
});

describe('SwingCompareScreen', () => {
  test('puts the newer swing on the left whatever order they were picked in, and reads what changed', async () => {
    const { findByText, getByText, getAllByText } = setup(['b', 'a']);
    expect(await findByText('Better, not fixed.')).toBeTruthy();
    expect(getByText(/^Still early extension\./)).toBeTruthy();
    expect(getByText(T.better(2))).toBeTruthy(); // spine 7 against 9, hands 4 against 7
    expect(getByText(T.worse(1))).toBeTruthy(); // hips drifted more
    expect(getByText(T.unclear(1))).toBeTruthy(); // clubhead hidden in the newer swing
    expect(getAllByText('11 Oct').length).toBeGreaterThan(0);
    expect(getAllByText('27 Sep').length).toBeGreaterThan(0);
  });

  test('judges a row by meaning: a smaller spine loss is Better, more hip drift is Worse', async () => {
    const { findByLabelText } = setup();
    expect(await findByLabelText('Spine angle kept: 7° against 9°, Better')).toBeTruthy();
    expect(await findByLabelText('Hips hold their line: 14 cm against 12 cm, Worse')).toBeTruthy();
    expect(await findByLabelText('Clubhead on the plane: — against 3 cm, Unclear')).toBeTruthy();
  });

  test('draws the impact still of each swing from the saved frame', async () => {
    const { findByLabelText } = setup();
    const left = await findByLabelText(/^Sat 11 Oct · 18:42, at impact/);
    expect(getStill).toHaveBeenCalledWith('a', 557);
    expect(getStill).toHaveBeenCalledWith('b', 560);
    expect(left).toBeTruthy();
  });

  test('asks for a missing still and shows "No still" when there is none', async () => {
    getStill.mockReturnValue(null);
    const { findAllByText } = setup();
    expect((await findAllByText(T.noStill)).length).toBe(2);
    expect(ensureStills).toHaveBeenCalledWith('a', [557]);
  });

  test('swap flips the question: Better becomes Worse', async () => {
    const { findByLabelText } = setup();
    await findByLabelText('Spine angle kept: 7° against 9°, Better');
    fireEvent.press(await findByLabelText(T.swap));
    await waitFor(() => expect(findByLabelText('Spine angle kept: 9° against 7°, Worse')).resolves.toBeTruthy());
  });

  test('says so when a swing cannot be opened, and goes back', async () => {
    const { findByText, getByLabelText, navigation } = setup(['a', 'missing']);
    expect(await findByText(T.loadFailed)).toBeTruthy();
    fireEvent.press(getByLabelText(T.back));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
