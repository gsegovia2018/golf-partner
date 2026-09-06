import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { dark } from '../../../theme/tokens';
import SwipeToDelete from '../SwipeToDelete';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
// Dark mode is where translucent cards would let the red underlay bleed
// through — run the whole suite against it.
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'dark'),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderSwipe(ui) {
  const utils = render(wrap(ui));
  await flush();
  return utils;
}

describe('SwipeToDelete', () => {
  test('enabled: renders the child and a delete action that fires onDelete', async () => {
    const onDelete = jest.fn();
    const { getByText, getByTestId } = await renderSwipe(
      <SwipeToDelete enabled onDelete={onDelete} accessibilityLabel="Delete Sunday fourball">
        <Text>Sunday fourball</Text>
      </SwipeToDelete>,
    );
    getByText('Sunday fourball');
    fireEvent.press(getByTestId('swipe-delete-action'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('enabled: delete action is reachable by its accessibility label', async () => {
    const { getByLabelText } = await renderSwipe(
      <SwipeToDelete enabled onDelete={() => {}} accessibilityLabel="Delete June Cup">
        <Text>June Cup</Text>
      </SwipeToDelete>,
    );
    getByLabelText('Delete June Cup');
  });

  test('enabled: sliding content has an opaque screen-colored backing so translucent dark cards do not show the red underlay at rest', async () => {
    const { getByTestId } = await renderSwipe(
      <SwipeToDelete enabled onDelete={() => {}}>
        <Text>Sunday fourball</Text>
      </SwipeToDelete>,
    );
    const style = StyleSheet.flatten(getByTestId('swipe-content').props.style);
    expect(style.backgroundColor).toBe(dark.bg.primary);
  });

  test('disabled: renders the child with no delete action in the tree', async () => {
    const { getByText, queryByTestId } = await renderSwipe(
      <SwipeToDelete enabled={false} onDelete={() => {}}>
        <Text>Not mine</Text>
      </SwipeToDelete>,
    );
    getByText('Not mine');
    expect(queryByTestId('swipe-delete-action')).toBeNull();
  });
});
