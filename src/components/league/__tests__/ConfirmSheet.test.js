import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { useConfirmSheet } from '../ConfirmSheet';

const results = [];

function Harness({ spec }) {
  const { ask, sheet } = useConfirmSheet();
  return (
    <>
      <TouchableOpacity onPress={() => ask(spec).then((v) => results.push(v))}>
        <Text>open</Text>
      </TouchableOpacity>
      {sheet}
    </>
  );
}

const wrap = (spec) => render(<ThemeProvider><Harness spec={spec} /></ThemeProvider>);

describe('useConfirmSheet', () => {
  beforeEach(() => { results.length = 0; });

  test('a confirm resolves true on the action and false on Cancel', async () => {
    const { getByText } = wrap({ title: 'Remove?', message: 'Gone for good.', confirmLabel: 'Remove', destructive: true });
    fireEvent.press(getByText('open'));
    getByText('Remove?');
    getByText('Gone for good.');
    await act(async () => { fireEvent.press(getByText('Remove')); });
    expect(results).toEqual([true]);

    fireEvent.press(getByText('open'));
    await act(async () => { fireEvent.press(getByText('Cancel')); });
    expect(results).toEqual([true, false]);
  });

  test('a notice (no confirmLabel) has a single Done button', async () => {
    const { getByText, queryByText } = wrap({ title: 'Error', message: 'Something broke.' });
    fireEvent.press(getByText('open'));
    getByText('Something broke.');
    expect(queryByText('Cancel')).toBeNull();
    await act(async () => { fireEvent.press(getByText('Done')); });
    expect(results).toEqual([false]);
  });
});
