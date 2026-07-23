import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
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

describe('SwipeToDelete', () => {
  test('enabled: renders the child and a delete action that fires onDelete', () => {
    const onDelete = jest.fn();
    const { getByText, getByTestId } = render(wrap(
      <SwipeToDelete enabled onDelete={onDelete} accessibilityLabel="Delete Sunday fourball">
        <Text>Sunday fourball</Text>
      </SwipeToDelete>,
    ));
    getByText('Sunday fourball');
    fireEvent.press(getByTestId('swipe-delete-action'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  test('enabled: delete action is reachable by its accessibility label', () => {
    const { getByLabelText } = render(wrap(
      <SwipeToDelete enabled onDelete={() => {}} accessibilityLabel="Delete June Cup">
        <Text>June Cup</Text>
      </SwipeToDelete>,
    ));
    getByLabelText('Delete June Cup');
  });

  test('enabled: sliding content has an opaque screen-colored backing so translucent dark cards do not show the red underlay at rest', () => {
    const { getByTestId } = render(wrap(
      <SwipeToDelete enabled onDelete={() => {}}>
        <Text>Sunday fourball</Text>
      </SwipeToDelete>,
    ));
    const style = StyleSheet.flatten(getByTestId('swipe-content').props.style);
    expect(style.backgroundColor).toBe(dark.bg.primary);
  });

  test('disabled: renders the child with no delete action in the tree', () => {
    const { getByText, queryByTestId } = render(wrap(
      <SwipeToDelete enabled={false} onDelete={() => {}}>
        <Text>Not mine</Text>
      </SwipeToDelete>,
    ));
    getByText('Not mine');
    expect(queryByTestId('swipe-delete-action')).toBeNull();
  });
});
