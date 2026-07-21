import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import BreakdownRow from '../BreakdownRow';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// one test can assert the static (no-animation) render path.
let mockReducedMotion = false;
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => mockReducedMotion,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => {
  mockReducedMotion = false;
});

describe('BreakdownRow', () => {
  test('renders label, secondary and value', () => {
    const { getByText } = render(wrap(
      <BreakdownRow label="Par 3s" secondary="34 holes" value="1.5 pts" first />
    ));

    expect(getByText('Par 3s')).toBeTruthy();
    expect(getByText('34 holes')).toBeTruthy();
    expect(getByText('1.5 pts')).toBeTruthy();
  });

  test('renders the magnitude fill at the normalized width', () => {
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Par 4s" value="1.6 pts" barRatio={0.75} testID="bar" first />
    ));

    expect(getByTestId('bar')).toBeTruthy();
    const fill = getByTestId('bar-fill');
    expect(StyleSheet.flatten(fill.props.style).width).toBe('75%');
  });

  test('renders no track at all without a barRatio (no numeric value)', () => {
    const { queryByTestId, getByText } = render(wrap(
      <BreakdownRow label="Sand-save rate" value="-" testID="bar" first />
    ));

    expect(getByText('Sand-save rate')).toBeTruthy();
    expect(queryByTestId('bar')).toBeNull();
    expect(queryByTestId('bar-fill')).toBeNull();
  });

  test('zero magnitude keeps the empty track but drops the fill', () => {
    const { getByTestId, queryByTestId } = render(wrap(
      <BreakdownRow label="Easy holes" value="0 pts" barRatio={0} testID="bar" first />
    ));

    expect(getByTestId('bar')).toBeTruthy();
    expect(queryByTestId('bar-fill')).toBeNull();
  });

  test('dim rows show a dash and an empty track even with a barRatio', () => {
    const { getByTestId, queryByTestId, getByText, queryByText } = render(wrap(
      <BreakdownRow label="Miss left" value="1.2 pts" barRatio={0.6} dim testID="bar" first />
    ));

    expect(getByText('-')).toBeTruthy();
    expect(queryByText('1.2 pts')).toBeNull();
    expect(getByTestId('bar')).toBeTruthy();
    expect(queryByTestId('bar-fill')).toBeNull();
  });

  test('bad-tone fills are drawn at reduced opacity', () => {
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Doubles+" value="2.1" tone="bad" barRatio={1} testID="bar" first />
    ));

    const style = StyleSheet.flatten(getByTestId('bar-fill').props.style);
    expect(style.opacity).toBe(0.75);
    expect(style.width).toBe('100%');
  });

  test('clamps out-of-range ratios into 0..1', () => {
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Pars" value="9" barRatio={1.4} testID="bar" first />
    ));

    expect(StyleSheet.flatten(getByTestId('bar-fill').props.style).width).toBe('100%');
  });

  test('still renders the fill statically under reduced motion', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Par 5s" value="2 pts" barRatio={1} testID="bar" first />
    ));

    expect(StyleSheet.flatten(getByTestId('bar-fill').props.style).width).toBe('100%');
  });
});
