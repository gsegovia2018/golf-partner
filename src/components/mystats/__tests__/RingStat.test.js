import React from 'react';
import { render } from '@testing-library/react-native';
import { Circle } from 'react-native-svg';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RingStat, { clampFill, RING_CIRCUMFERENCE } from '../RingStat';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Toggleable reduced motion: reduced ⇒ the progress circle renders statically
// with its final strokeDashoffset, so fill math is assertable from props.
let mockReducedMotion = true;
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => mockReducedMotion,
  };
});

beforeEach(() => { mockReducedMotion = true; });

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// The svg host element normalizes stroke props (arrays, nulls) — read the
// raw props off the composite Circle element instead.
const circleByTestID = (view, id) => view.UNSAFE_getAllByType(Circle)
  .find((c) => c.props.testID === id);

describe('clampFill', () => {
  test('passes through in-range ratios', () => {
    expect(clampFill(0.3)).toBe(0.3);
    expect(clampFill(1)).toBe(1);
  });

  test('clamps over-benchmark ratios to a full ring', () => {
    expect(clampFill(1.4)).toBe(1);
  });

  test('null / NaN / negative mean an empty ring', () => {
    expect(clampFill(null)).toBe(0);
    expect(clampFill(undefined)).toBe(0);
    expect(clampFill(NaN)).toBe(0);
    expect(clampFill(-0.5)).toBe(0);
  });
});

describe('RingStat (reduced motion: static final ring)', () => {
  test('draws the progress arc at the clamped fill', () => {
    const view = render(wrap(
      <RingStat testID="ring" label="GIR" value={50} fill={0.5} color="#006747" />
    ));
    const progress = circleByTestID(view, 'ring-progress');
    expect(progress.props.strokeDasharray).toBe(RING_CIRCUMFERENCE);
    expect(progress.props.strokeDashoffset).toBeCloseTo(RING_CIRCUMFERENCE * 0.5);
    expect(progress.props.stroke).toBe('#006747');
  });

  test('over-benchmark fill clamps to a complete ring', () => {
    const view = render(wrap(
      <RingStat testID="ring" label="Putts / 18" value={50.4} fill={50.4 / 36} color="#ef4444" />
    ));
    expect(circleByTestID(view, 'ring-progress').props.strokeDashoffset).toBeCloseTo(0);
  });

  test('null value renders an em-dash and no progress arc', () => {
    const { getByTestId, queryByTestId, getByText } = render(wrap(
      <RingStat testID="ring" label="GIR" value={null} fill={null} color="#006747" />
    ));
    expect(getByText('—')).toBeTruthy();
    expect(queryByTestId('ring-progress')).toBeNull();
    // The muted track stays so the tile keeps its shape.
    expect(getByTestId('ring-track')).toBeTruthy();
  });

  test('zero fill also drops the arc (round caps would leave a dot)', () => {
    const { queryByTestId } = render(wrap(
      <RingStat testID="ring" label="3-putts / 18" value={0} fill={0} color="#006747" />
    ));
    expect(queryByTestId('ring-progress')).toBeNull();
  });

  test('integer value shows immediately with its suffix (CountUpText disabled)', () => {
    const { getByText } = render(wrap(
      <RingStat testID="ring" label="GIR" value={44} suffix="%" fill={0.44} color="#006747" />
    ));
    expect(getByText('44')).toBeTruthy();
    expect(getByText(/%/)).toBeTruthy();
  });

  test('non-integer value renders statically (CountUpText convention)', () => {
    const { getByText } = render(wrap(
      <RingStat testID="ring" label="Putts / 18" value={32.4} fill={32.4 / 36} color="#006747" />
    ));
    expect(getByText('32.4')).toBeTruthy();
  });
});

describe('RingStat (motion enabled)', () => {
  test('renders the animated arc without crashing', () => {
    mockReducedMotion = false;
    const { getByTestId, getByText } = render(wrap(
      <RingStat testID="ring" label="GIR" value={44} suffix="%" fill={0.44} color="#006747" index={2} />
    ));
    expect(getByTestId('ring-progress')).toBeTruthy();
    expect(getByText('GIR')).toBeTruthy();
  });
});
