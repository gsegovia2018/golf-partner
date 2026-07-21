import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import TargetMeterRow from '../TargetMeterRow';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// tests can assert the static (no-animation) render path.
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

const pct = (styleValue) => parseFloat(styleValue);

describe('TargetMeterRow', () => {
  test('renders label, meta, value and the target line', () => {
    const { getByText } = render(wrap(
      <TargetMeterRow
        label="Par 3s" meta="24 holes" value="4.6"
        numericValue={4.6} target={3.2} tone="bad" testID="meter" first
      />
    ));

    expect(getByText('Par 3s')).toBeTruthy();
    expect(getByText('24 holes')).toBeTruthy();
    expect(getByText('4.6')).toBeTruthy();
    expect(getByText('target 3.2')).toBeTruthy();
  });

  test('scales fill and tick off max(value, target) × 1.15 when you are over target', () => {
    const { getByTestId } = render(wrap(
      <TargetMeterRow
        label="Par 3s" value="4.6"
        numericValue={4.6} target={3.2} tone="bad" testID="meter" first
      />
    ));

    // scale = 4.6 × 1.15 = 5.29 → fill 86.96%, tick 60.49%
    const fill = StyleSheet.flatten(getByTestId('meter-fill').props.style);
    expect(pct(fill.width)).toBeCloseTo(86.96, 1);
    const tick = StyleSheet.flatten(getByTestId('meter-tick').props.style);
    expect(pct(tick.left)).toBeCloseTo(60.49, 1);
  });

  test('scales off the target when it is the larger number', () => {
    const { getByTestId } = render(wrap(
      <TargetMeterRow
        label="Pars / round" value="3"
        numericValue={3} target={4} tone="neutral" testID="meter" first
      />
    ));

    // scale = 4 × 1.15 = 4.6 → fill 65.22%, tick 86.96% — both inside track
    const fill = StyleSheet.flatten(getByTestId('meter-fill').props.style);
    expect(pct(fill.width)).toBeCloseTo(65.22, 1);
    const tick = StyleSheet.flatten(getByTestId('meter-tick').props.style);
    expect(pct(tick.left)).toBeCloseTo(86.96, 1);
    expect(pct(tick.left)).toBeLessThanOrEqual(100);
  });

  test('clamps a negative value to an empty track while keeping the tick', () => {
    const { getByTestId, queryByTestId } = render(wrap(
      <TargetMeterRow
        label="SG total" value="-0.5"
        numericValue={-0.5} target={3} tone="bad" testID="meter" first
      />
    ));

    // fill clamps to 0% → no fill node at all, but the track + tick remain
    expect(getByTestId('meter')).toBeTruthy();
    expect(queryByTestId('meter-fill')).toBeNull();
    const tick = StyleSheet.flatten(getByTestId('meter-tick').props.style);
    expect(pct(tick.left)).toBeCloseTo(86.96, 1);
  });

  test('falls back to a meter-less row when the target is missing', () => {
    const { getByText, queryByTestId, queryByText } = render(wrap(
      <TargetMeterRow
        label="Damage control" meta="No sample yet" value="1.2"
        numericValue={1.2} target={null} tone="neutral" testID="meter" first
      />
    ));

    expect(getByText('Damage control')).toBeTruthy();
    expect(getByText('1.2')).toBeTruthy();
    expect(queryByTestId('meter')).toBeNull();
    expect(queryByTestId('meter-fill')).toBeNull();
    expect(queryByTestId('meter-tick')).toBeNull();
    expect(queryByText(/^target /)).toBeNull();
  });

  test('falls back to a meter-less row when the value is not numeric', () => {
    const { getByText, queryByTestId } = render(wrap(
      <TargetMeterRow
        label="Birdies / round" value="-"
        numericValue={null} target={0.7} tone="neutral" testID="meter" first
      />
    ));

    expect(getByText('Birdies / round')).toBeTruthy();
    expect(queryByTestId('meter')).toBeNull();
    expect(queryByTestId('meter-tick')).toBeNull();
  });

  test('zero value against zero target renders meter-less (no zero-division scale)', () => {
    const { getByText, queryByTestId } = render(wrap(
      <TargetMeterRow
        label="Doubles+ / round" value="0"
        numericValue={0} target={0} tone="good" testID="meter" first
      />
    ));

    expect(getByText('0')).toBeTruthy();
    expect(queryByTestId('meter')).toBeNull();
  });

  test('renders fill and tick statically under reduced motion', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(
      <TargetMeterRow
        label="Par 4s" value="5.2"
        numericValue={5.2} target={4.9} tone="bad" testID="meter" first
      />
    ));

    const fill = StyleSheet.flatten(getByTestId('meter-fill').props.style);
    expect(pct(fill.width)).toBeCloseTo(86.96, 1);
    // Static path: the tick is fully visible immediately — no fade pending.
    const tick = StyleSheet.flatten(getByTestId('meter-tick').props.style);
    expect(tick.opacity).toBe(1);
  });

  test('describes the row for screen readers, target included', () => {
    const { getByLabelText } = render(wrap(
      <TargetMeterRow
        label="Par 3s" value="4.6"
        numericValue={4.6} target={3.2} tone="bad" testID="meter" first
      />
    ));

    expect(getByLabelText('Par 3s: 4.6, target 3.2')).toBeTruthy();
  });

  test('screen-reader label drops the target clause on meter-less rows', () => {
    const { getByLabelText } = render(wrap(
      <TargetMeterRow label="Birdies / round" value="-" numericValue={null} target={null} first />
    ));

    expect(getByLabelText('Birdies / round: -')).toBeTruthy();
  });

  test('uses the provided targetDisplay over the raw number', () => {
    const { getByText } = render(wrap(
      <TargetMeterRow
        label="Pars / round" value="9"
        numericValue={9} target={9.5} targetDisplay="9.5" tone="good" testID="meter" first
      />
    ));

    expect(getByText('target 9.5')).toBeTruthy();
  });
});
