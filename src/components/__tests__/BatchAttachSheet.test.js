import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import BatchAttachSheet from '../BatchAttachSheet';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const ROUNDS = [
  { id: 'r1', courseName: 'Poniente', holes: Array.from({ length: 18 }, () => ({ par: 4 })) },
  { id: 'r2', courseName: 'Levante', holes: Array.from({ length: 9 }, () => ({ par: 3 })) },
];
const ASSETS = [
  { kind: 'photo', localUri: 'file://a.jpg' },
  { kind: 'photo', localUri: 'file://b.jpg' },
];

describe('BatchAttachSheet', () => {
  test('renders wheels and English copy', () => {
    const { getByTestId, getByText } = render(wrap(
      <BatchAttachSheet
        visible
        assets={ASSETS}
        rounds={ROUNDS}
        defaultRoundIndex={0}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />
    ));
    expect(getByText('Attach 2 memories')).toBeTruthy();
    expect(getByTestId('batch-round-wheel')).toBeTruthy();
    expect(getByTestId('batch-hole-wheel')).toBeTruthy();
    expect(getByText('Save 2')).toBeTruthy();
  });

  test('applies the wheel-picked round and hole to every asset', async () => {
    const onConfirm = jest.fn();
    const { getByLabelText, getByText } = render(wrap(
      <BatchAttachSheet
        visible
        assets={ASSETS}
        rounds={ROUNDS}
        defaultRoundIndex={0}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    ));
    fireEvent.press(getByLabelText('R2, Levante'));
    fireEvent.press(getByLabelText('Hole 3, Par 3'));
    fireEvent.press(getByText('Save 2'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    const payload = onConfirm.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ roundId: 'r2', holeIndex: 2 });
    expect(payload[1]).toMatchObject({ roundId: 'r2', holeIndex: 2 });
  });
});
