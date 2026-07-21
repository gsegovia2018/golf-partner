import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ScoreMixColumns from '../ScoreMixColumns';

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

const rounds = [
  { label: 'R1', birdie: 3, par: 9, bogey: 6 },
  { label: 'R2', birdie: 0, par: 12, bogey: 6 },
  { label: 'R3', birdie: 6, par: 6, bogey: 6 },
];

describe('ScoreMixColumns', () => {
  test('shows the empty state with fewer than two rounds', () => {
    const { getByText } = render(wrap(<ScoreMixColumns rounds={[rounds[0]]} />));
    expect(getByText('Select two or more rounds to see the score mix.')).toBeTruthy();
  });

  test('segment heights are proportional to each round share of holes', () => {
    const { getByTestId } = render(wrap(<ScoreMixColumns rounds={rounds} />));

    // R1: 3/18, 9/18, 6/18 of the fixed 90px column.
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-birdie').props.style).height).toBe(15);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-par').props.style).height).toBe(45);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-bogey').props.style).height).toBe(30);
    // R3: an even 6/6/6 split.
    expect(StyleSheet.flatten(getByTestId('scoremix-col-2-birdie').props.style).height).toBe(30);
  });

  test('zero-count segments are omitted and the rounded top moves to the next band', () => {
    const { queryByTestId, getByTestId } = render(wrap(<ScoreMixColumns rounds={rounds} />));

    expect(queryByTestId('scoremix-col-1-birdie')).toBeNull();
    const parStyle = StyleSheet.flatten(getByTestId('scoremix-col-1-par').props.style);
    expect(parStyle.borderTopLeftRadius).toBe(4);
    // A column that does start with birdie keeps the radius on the birdie band.
    const bogeyStyle = StyleSheet.flatten(getByTestId('scoremix-col-0-bogey').props.style);
    expect(bogeyStyle.borderTopLeftRadius).toBeUndefined();
  });

  test('the latest column is full opacity; earlier columns step back', () => {
    const { getByTestId } = render(wrap(<ScoreMixColumns rounds={rounds} />));

    expect(StyleSheet.flatten(getByTestId('scoremix-col-0').props.style).opacity).toBe(0.8);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-1').props.style).opacity).toBe(0.8);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-2').props.style).opacity).toBeUndefined();
  });

  test('renders round index labels, a legend, and per-column accessibility labels', () => {
    const { getByText, getByTestId } = render(wrap(<ScoreMixColumns rounds={rounds} />));

    ['R1', 'R2', 'R3'].forEach((label) => expect(getByText(label)).toBeTruthy());
    ['Birdie+', 'Par', 'Bogey+'].forEach((label) => expect(getByText(label)).toBeTruthy());
    expect(getByTestId('scoremix-col-0').props.accessibilityLabel)
      .toBe('Round 1: 3 birdie or better, 9 par, 6 bogey or worse');
  });

  test('reduced motion still renders every column statically', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(<ScoreMixColumns rounds={rounds} />));

    expect(getByTestId('scoremix-col-0')).toBeTruthy();
    expect(getByTestId('scoremix-col-2')).toBeTruthy();
  });
});
