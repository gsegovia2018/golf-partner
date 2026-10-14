import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SwingHomeScreen, { groupByMonth, formatBytes } from '../SwingHomeScreen';
import * as store from '../../store/swingStore';
import { getSwingAvailability } from '../../swing/availability';
import { setLanguagePref } from '../../i18n';

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

const render_ = (swings) => {
  store.getSwings.mockReturnValue(swings);
  getSwingAvailability.mockReturnValue({ supported: true });
  return render(<ThemeProvider><SwingHomeScreen navigation={{ navigate: jest.fn(), goBack: jest.fn() }} /></ThemeProvider>);
};

describe('SwingHomeScreen in Spanish', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    store.getSwingProfile.mockReturnValue({ heightCm: null, handedness: 'right', asked: true });
    await act(async () => { await setLanguagePref('es'); });
  });
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('the empty state is in Spanish', () => {
    const { getByText } = render_([]);
    expect(getByText('Mi swing')).toBeTruthy();
    expect(getByText('Graba tu primer swing')).toBeTruthy();
    expect(getByText('¿Ya tienes un vídeo en cámara lenta? Impórtalo abajo.')).toBeTruthy();
  });

  test('rows, month heads, fps tag and footer are in Spanish', () => {
    const A = sw('a', '2026-10-11T16:42:00.000Z');
    const B = sw('b', '2026-09-27T10:00:00.000Z', { mainFault: 'over_the_top', fps: { capture: 120, effective: 120, factor: 4, approximate: true } });
    const { getByText, getByLabelText, queryByText } = render_([A, B]);
    expect(getByText('Extensión prematura')).toBeTruthy();
    expect(getByText('240 FPS')).toBeTruthy();
    expect(getByText('120 FPS · APROX.')).toBeTruthy();
    expect(getByText('2 swings · 184 MB en este móvil · desliza una fila o mantenla pulsada para ver más')).toBeTruthy();
    expect(getByLabelText(`Eliminar ${A.name}`)).toBeTruthy();
    expect(queryByText('My swing')).toBeNull();
  });

  test('month heads and sizes follow the language', () => {
    const g = groupByMonth([sw('a', '2026-10-11T16:42:00.000Z'), sw('b', '2025-03-02T10:00:00.000Z')]);
    expect(g[0].label).toBe('Octubre');
    expect(g[1].label).toBe('Marzo de 2025');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1,5 GB');
  });
});
