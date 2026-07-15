import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import AttachMediaSheet from '../AttachMediaSheet';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('expo-video', () => ({
  VideoView: 'VideoView',
  useVideoPlayer: jest.fn(() => ({})),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const holes18 = Array.from({ length: 18 }, (_, i) => ({ par: i === 2 ? 5 : 4 }));
const holes9 = Array.from({ length: 9 }, () => ({ par: 3 }));
const ROUNDS = [
  { id: 'r1', courseName: 'Poniente', holes: holes18 },
  { id: 'r2', courseName: 'Levante', holes: holes9 },
];
const ASSET = { kind: 'photo', localUri: 'file://a.jpg' };

const setup = (props = {}) => {
  const onConfirm = jest.fn();
  const utils = render(wrap(
    <AttachMediaSheet
      visible
      asset={ASSET}
      rounds={ROUNDS}
      defaultRoundIndex={0}
      defaultHoleIndex={null}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
      {...props}
    />
  ));
  return { onConfirm, ...utils };
};

describe('AttachMediaSheet', () => {
  test('shows round and hole wheels for a multi-round tournament', () => {
    const { getByTestId } = setup();
    expect(getByTestId('attach-round-wheel')).toBeTruthy();
    expect(getByTestId('attach-hole-wheel')).toBeTruthy();
  });

  test('hides the round wheel when there is a single round', () => {
    const { queryByTestId, getByTestId } = setup({ rounds: [ROUNDS[0]] });
    expect(queryByTestId('attach-round-wheel')).toBeNull();
    expect(getByTestId('attach-hole-wheel')).toBeTruthy();
  });

  test('confirm payload carries the picked round and hole', async () => {
    const { onConfirm, getByLabelText, getByText } = setup();
    fireEvent.press(getByLabelText('Hole 3, Par 5'));
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      roundIndex: 0,
      roundId: 'r1',
      holeIndex: 2,
      caption: null,
      uploaderLabel: null,
    }));
  });

  test('switching to a shorter round resets an out-of-range hole to No hole', async () => {
    const { onConfirm, getByLabelText, getByText } = setup();
    fireEvent.press(getByLabelText('Hole 12, Par 4'));
    fireEvent.press(getByLabelText('R2, Levante'));
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      roundIndex: 1,
      roundId: 'r2',
      holeIndex: null,
      caption: null,
      uploaderLabel: null,
    }));
  });

  test('clamps an out-of-range defaultRoundIndex from a stale feed item', async () => {
    const { onConfirm, getByText } = setup({ defaultRoundIndex: 5 });
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      roundIndex: 1,
      roundId: 'r2',
      holeIndex: null,
      caption: null,
      uploaderLabel: null,
    }));
  });
});
