import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import WheelPicker, { snapIndex, WHEEL_ROW_HEIGHT } from '../WheelPicker';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const ITEMS = [
  { key: 'none', label: 'No hole' },
  { key: '0', label: 'Hole 1', sublabel: 'Par 4' },
  { key: '1', label: 'Hole 2', sublabel: 'Par 3' },
];

describe('snapIndex', () => {
  test('rounds an offset to the nearest row', () => {
    expect(snapIndex(0, 3)).toBe(0);
    expect(snapIndex(WHEEL_ROW_HEIGHT * 1.4, 3)).toBe(1);
    expect(snapIndex(WHEEL_ROW_HEIGHT * 1.6, 3)).toBe(2);
  });

  test('clamps to the item range', () => {
    expect(snapIndex(-50, 3)).toBe(0);
    expect(snapIndex(WHEEL_ROW_HEIGHT * 99, 3)).toBe(2);
    expect(snapIndex(120, 0)).toBe(0);
  });
});

describe('WheelPicker', () => {
  test('renders labels and sublabels', () => {
    const { getByText } = render(wrap(
      <WheelPicker items={ITEMS} selectedIndex={0} onChange={jest.fn()} />
    ));
    expect(getByText('No hole')).toBeTruthy();
    expect(getByText('Hole 2')).toBeTruthy();
    expect(getByText('Par 3')).toBeTruthy();
  });

  test('tapping a row selects it', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(wrap(
      <WheelPicker items={ITEMS} selectedIndex={0} onChange={onChange} />
    ));
    fireEvent.press(getByLabelText('Hole 2, Par 3'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('momentum scroll end snaps to the nearest index', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(wrap(
      <WheelPicker items={ITEMS} selectedIndex={0} onChange={onChange} testID="wheel" />
    ));
    fireEvent(getByTestId('wheel-scroll'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { y: WHEEL_ROW_HEIGHT * 2 } },
    });
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
