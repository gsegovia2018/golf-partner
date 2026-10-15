import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import PointsTableSheet from '../PointsTableSheet';

const wrap = (props) => render(
  <ThemeProvider>
    <PointsTableSheet visible table={[500, 300, 190]} onSave={jest.fn()} onClose={jest.fn()} {...props} />
  </ThemeProvider>,
);

describe('PointsTableSheet', () => {
  test('lists each place with its points', () => {
    const { getByText, getByLabelText } = wrap();
    expect(getByText('3rd')).toBeTruthy();
    expect(getByLabelText('Points for 2nd place').props.value).toBe('300');
    expect(getByText('Add 4th place')).toBeTruthy();
  });

  test('add shows the error until the new place has a number, then saves', () => {
    const onSave = jest.fn();
    const { getByText, getByLabelText, queryByText, getByRole } = wrap({ onSave });
    fireEvent.press(getByText('Add 4th place'));
    expect(getByText('Give 4th place a number, or remove it.')).toBeTruthy();
    expect(getByRole('button', { name: 'Save' }).props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(getByLabelText('Points for 4th place'), '120');
    expect(queryByText(/Give 4th/)).toBeNull();
    fireEvent.press(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith([500, 300, 190, 120]);
  });

  test('only the last place can be removed, and one place always stays', () => {
    const onSave = jest.fn();
    const { getByLabelText, queryByLabelText, getByText } = wrap({ table: [500, 300], onSave });
    expect(queryByLabelText('Remove 1st place')).toBeNull();
    fireEvent.press(getByLabelText('Remove 2nd place'));
    expect(queryByLabelText('Remove 1st place')).toBeNull();
    expect(queryByLabelText('Remove 2nd place')).toBeNull();
    fireEvent.press(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith([500]);
  });

  test('clearing a field blocks Save', () => {
    const onSave = jest.fn();
    const { getByLabelText, getByText } = wrap({ onSave });
    fireEvent.changeText(getByLabelText('Points for 2nd place'), '');
    expect(getByText('Give 2nd place a number, or remove it.')).toBeTruthy();
    fireEvent.press(getByText('Save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});
