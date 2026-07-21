import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import SwipeToDelete from '../SwipeToDelete';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

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
