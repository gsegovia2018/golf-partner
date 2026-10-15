import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import PointsTableChart from '../PointsTableChart';

const TWELVE = [500, 300, 190, 120, 80, 60, 45, 35, 25, 18, 12, 8];

const setup = (table = [500, 300, 190], onChange = jest.fn()) => ({
  onChange,
  ...render(
    <ThemeProvider>
      <PointsTableChart table={table} onChange={onChange} />
    </ThemeProvider>,
  ),
});

describe('PointsTableChart', () => {
  test('shows six places and a show-all toggle for a long table', () => {
    const { getByText, queryByText, getAllByLabelText } = setup(TWELVE);
    expect(getAllByLabelText(/ place, \d+ points?$/)).toHaveLength(6);
    expect(queryByText('7th')).toBeNull();
    fireEvent.press(getByText('Show all 12 places'));
    expect(getAllByLabelText(/ place, \d+ points?$/)).toHaveLength(12);
    fireEvent.press(getByText('Show fewer'));
    expect(queryByText('7th')).toBeNull();
  });

  test('a short table has no toggle', () => {
    const { queryByText } = setup();
    expect(queryByText(/Show all/)).toBeNull();
  });

  test('tapping a row opens a number field; typing reports the new table', () => {
    const { getByLabelText, queryByLabelText, onChange } = setup();
    expect(queryByLabelText('Points for 2nd place')).toBeNull();
    fireEvent.press(getByLabelText('2nd place, 300 points'));
    const input = getByLabelText('Points for 2nd place');
    fireEvent.changeText(input, '3x5');
    expect(onChange).toHaveBeenLastCalledWith([500, 35, 190]);
  });

  test('only one row edits at a time; blur ends editing', () => {
    const { getByLabelText, queryByLabelText } = setup();
    fireEvent.press(getByLabelText('1st place, 500 points'));
    fireEvent.press(getByLabelText('3rd place, 190 points'));
    expect(queryByLabelText('Points for 1st place')).toBeNull();
    fireEvent(getByLabelText('Points for 3rd place'), 'blur');
    expect(queryByLabelText('Points for 3rd place')).toBeNull();
  });

  test('clearing a field reports null, shows the error and keeps editing', () => {
    const { getByLabelText, getByText, queryByText, onChange } = setup();
    fireEvent.press(getByLabelText('2nd place, 300 points'));
    fireEvent.changeText(getByLabelText('Points for 2nd place'), '');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(getByText('Give 2nd place a number, or remove it.')).toBeTruthy();
    fireEvent(getByLabelText('Points for 2nd place'), 'blur');
    expect(getByLabelText('Points for 2nd place')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Points for 2nd place'), '250');
    expect(onChange).toHaveBeenLastCalledWith([500, 250, 190]);
    expect(queryByText(/Give 2nd/)).toBeNull();
  });

  test('add place appends an empty editing row and reports null', () => {
    const { getByText, getByLabelText, onChange } = setup();
    fireEvent.press(getByText('Add 4th place'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(getByLabelText('Points for 4th place').props.value).toBe('');
    expect(getByText('Give 4th place a number, or remove it.')).toBeTruthy();
    fireEvent.changeText(getByLabelText('Points for 4th place'), '90');
    expect(onChange).toHaveBeenLastCalledWith([500, 300, 190, 90]);
  });

  test('add on a collapsed long table expands it and edits the new row', () => {
    const { getByText, getByLabelText } = setup(TWELVE);
    fireEvent.press(getByText('Add 13th place'));
    expect(getByLabelText('Points for 13th place')).toBeTruthy();
  });

  test('remove only on the last place of a multi-place table', () => {
    const { getByLabelText, queryByLabelText, onChange } = setup();
    fireEvent.press(getByLabelText('2nd place, 300 points'));
    expect(queryByLabelText('Remove 2nd place')).toBeNull();
    fireEvent.press(getByLabelText('3rd place, 190 points'));
    fireEvent.press(getByLabelText('Remove 3rd place'));
    expect(onChange).toHaveBeenLastCalledWith([500, 300]);
    expect(queryByLabelText('3rd place, 190 points')).toBeNull();
  });

  test('a single place cannot be removed', () => {
    const { getByLabelText, queryByLabelText } = setup([100]);
    fireEvent.press(getByLabelText('1st place, 100 points'));
    expect(queryByLabelText('Remove 1st place')).toBeNull();
  });
});
