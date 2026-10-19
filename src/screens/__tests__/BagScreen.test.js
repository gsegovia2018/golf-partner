import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import BagScreen from '../BagScreen';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('../../store/shotStore', () => ({
  subscribeShots: () => () => {},
  getShotsVersion: () => 0,
  getShots: () => [],
  clearAllShots: jest.fn(() => Promise.resolve()),
}));

const mockUpdate = jest.fn(() => Promise.resolve());
jest.mock('../../store/settingsStore', () => {
  const actual = jest.requireActual('../../store/settingsStore');
  return { ...actual, updateAppSettings: (...a) => mockUpdate(...a) };
});

const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

function renderScreen() {
  return render(
    <ThemeProvider>
      <BagScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />
    </ThemeProvider>,
  );
}

beforeEach(() => mockUpdate.mockClear());

describe('BagScreen clubs', () => {
  test('is clubs only: playing conditions moved to Settings', async () => {
    const { queryByText } = renderScreen();
    await flush();
    expect(queryByText(/playing conditions/i)).toBeNull();
    expect(queryByText(/Open-Meteo/)).toBeNull();
  });

  test('Edit clubs lists every catalog club exactly once', async () => {
    const { getByTestId, getAllByText } = renderScreen();
    await flush();
    fireEvent.press(getByTestId('bag-edit-clubs'));
    for (const name of ['Driver', '3 Wood', '4 Hybrid', '7 Iron', 'Pitching Wedge', 'Lob Wedge']) {
      expect(getAllByText(name)).toHaveLength(1);
    }
  });
});

describe('BagScreen distances', () => {
  test('a typed distance is saved when the sheet is dismissed without pressing Save', async () => {
    const { getByTestId, getByLabelText } = renderScreen();
    await flush();
    fireEvent.press(getByTestId('bag-row-7i'));
    await flush();
    fireEvent.changeText(getByTestId('bag-distance-input'), '142');
    // Scrim tap / back gesture.
    fireEvent.press(getByLabelText('Close'));
    await flush();
    expect(mockUpdate).toHaveBeenCalledWith({ clubDistances: { '7i': 142 } });
  });

  test('Save stores the number; unreadable input is refused', async () => {
    const { getByTestId, getByText } = renderScreen();
    await flush();
    fireEvent.press(getByTestId('bag-row-8i'));
    await flush();
    fireEvent.changeText(getByTestId('bag-distance-input'), '1x');
    fireEvent.press(getByTestId('bag-distance-save'));
    expect(getByText('Type a distance in m, or leave it empty.')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.changeText(getByTestId('bag-distance-input'), '131');
    fireEvent.press(getByTestId('bag-distance-save'));
    await flush();
    expect(mockUpdate).toHaveBeenCalledWith({ clubDistances: { '8i': 131 } });
  });
});
