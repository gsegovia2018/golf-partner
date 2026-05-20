import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { TargetHandicapPicker } from '../TargetHandicapPicker';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('TargetHandicapPicker', () => {
  test('renders current value when one is set', () => {
    const { getByDisplayValue } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={12.5}
        currentHandicap={18}
        onSave={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(getByDisplayValue('12.5')).toBeTruthy();
  });

  test('renders empty input when currentValue is null', () => {
    const { queryByDisplayValue } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={null}
        currentHandicap={18}
        onSave={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(queryByDisplayValue('12.5')).toBeNull();
  });

  test('preset button fills input from currentHandicap', () => {
    const { getByText, getByDisplayValue } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={null}
        currentHandicap={15.4}
        onSave={() => {}}
        onCancel={() => {}}
      />
    ));
    fireEvent.press(getByText(/Use my current handicap/));
    expect(getByDisplayValue('15.4')).toBeTruthy();
  });

  test('Save calls onSave with parsed numeric value', () => {
    const onSave = jest.fn();
    const { getByText } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={10}
        currentHandicap={18}
        onSave={onSave}
        onCancel={() => {}}
      />
    ));
    fireEvent.press(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(10);
  });

  test('Cancel calls onCancel and does not call onSave', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    const { getByText } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={10}
        currentHandicap={18}
        onSave={onSave}
        onCancel={onCancel}
      />
    ));
    fireEvent.press(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
