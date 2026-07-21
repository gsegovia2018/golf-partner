import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Text as SvgText } from 'react-native-svg';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ScoreMixColumns from '../ScoreMixColumns';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// tests can assert the static (no-animation) render path and read the
// CountUpText headline without waiting out the count-up.
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
  { label: 'R1', birdiePlus: 3, par: 9, bogey: 3, double: 2, worse: 1 },
  { label: 'R2', birdiePlus: 0, par: 12, bogey: 6, double: 0, worse: 0 },
  { label: 'R3', birdiePlus: 6, par: 6, bogey: 3, double: 2, worse: 1 },
];

const mkSeries = (values) => values.map((value, i) => ({ label: `R${i + 1}`, value }));
const damage = mkSeries([9, 3, 4]);
const steadyPct = mkSeries([67, 100, 83]);

const renderCard = (over = {}) => render(wrap(
  <ScoreMixColumns rounds={rounds} damage={damage} steadyPct={steadyPct} {...over} />,
));

describe('ScoreMixColumns', () => {
  test('shows the empty state with fewer than two rounds', () => {
    const { getByText, queryByTestId } = renderCard({ rounds: [rounds[0]] });
    expect(getByText('Select two or more rounds to see the score mix.')).toBeTruthy();
    expect(queryByTestId('scoremix-damage-value')).toBeNull();
  });

  test('damage headline shows the latest round value with reduced motion', () => {
    mockReducedMotion = true;
    const { getByText, getByTestId } = renderCard();
    expect(getByText('Damage · strokes lost past bogey')).toBeTruthy();
    expect(getByTestId('scoremix-damage-value')).toBeTruthy();
    expect(getByText('4')).toBeTruthy(); // latest round's damage, not the average
  });

  test('delta chip is green with ▼ when the latest round leaked less than average', () => {
    const { getByTestId, getByText } = renderCard({ damage: mkSeries([7, 7, 0]) });
    const chip = getByTestId('scoremix-damage-chip');
    expect(getByText('▼ 7 vs your average')).toBeTruthy();
    // Clubhouse green #006747 at the 12% chip wash.
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe('rgba(0,103,71,0.12)');
    expect(chip.props.accessibilityLabel)
      .toBe('7 strokes below your average of the other rounds');
  });

  test('delta chip is red with ▲ when the latest round leaked more than average', () => {
    const { getByTestId, getByText } = renderCard({ damage: mkSeries([0, 0, 6]) });
    const chip = getByTestId('scoremix-damage-chip');
    expect(getByText('▲ 6 vs your average')).toBeTruthy();
    // Masters red #c8102e at the 12% chip wash.
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe('rgba(200,16,46,0.12)');
    expect(chip.props.accessibilityLabel)
      .toBe('6 strokes above your average of the other rounds');
  });

  test('delta chip goes muted "level" inside half a stroke of average', () => {
    const { getByText, getByTestId } = renderCard({ damage: mkSeries([4, 4, 4]) });
    expect(getByText('level with your average')).toBeTruthy();
    expect(getByTestId('scoremix-damage-chip').props.accessibilityLabel)
      .toBe('Level with your average of the other rounds');
  });

  test('no delta chip without a second round of damage data', () => {
    const { queryByTestId } = renderCard({ damage: mkSeries([null, null, 5]) });
    expect(queryByTestId('scoremix-damage-chip')).toBeNull();
  });

  test('renders five segments with heights proportional to each round share of holes', () => {
    const { getByTestId } = renderCard();
    // R1: 3/9/3/2/1 of 18 holes over the fixed 90px column.
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-birdiePlus').props.style).height).toBe(15);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-par').props.style).height).toBe(45);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-bogey').props.style).height).toBe(15);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-double').props.style).height).toBe(10);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0-worse').props.style).height).toBe(5);
  });

  test('zero-count segments are omitted and the rounded top moves to the next band', () => {
    const { queryByTestId, getByTestId } = renderCard();
    expect(queryByTestId('scoremix-col-1-birdiePlus')).toBeNull();
    expect(queryByTestId('scoremix-col-1-double')).toBeNull();
    expect(queryByTestId('scoremix-col-1-worse')).toBeNull();
    const parStyle = StyleSheet.flatten(getByTestId('scoremix-col-1-par').props.style);
    expect(parStyle.borderTopLeftRadius).toBe(4);
    // A column that does start with birdie+ keeps the radius there.
    const bogeyStyle = StyleSheet.flatten(getByTestId('scoremix-col-0-bogey').props.style);
    expect(bogeyStyle.borderTopLeftRadius).toBeUndefined();
  });

  test('the latest column is full opacity; earlier columns step back', () => {
    const { getByTestId } = renderCard();
    expect(StyleSheet.flatten(getByTestId('scoremix-col-0').props.style).opacity).toBe(0.8);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-1').props.style).opacity).toBe(0.8);
    expect(StyleSheet.flatten(getByTestId('scoremix-col-2').props.style).opacity).toBeUndefined();
  });

  test('renders round labels, a five-entry legend, and five-count a11y labels', () => {
    const { getByText, getByTestId } = renderCard();
    ['R1', 'R2', 'R3'].forEach((label) => expect(getByText(label)).toBeTruthy());
    ['Birdie+', 'Par', 'Bogey', 'Double', 'Worse'].forEach((label) => expect(getByText(label)).toBeTruthy());
    expect(getByTestId('scoremix-col-0').props.accessibilityLabel)
      .toBe('Round 1: 3 birdie or better, 9 par, 3 bogey, 2 double bogey, 1 worse');
  });

  test('steady-holes block renders its overline and a % trend chart', () => {
    const view = renderCard();
    expect(view.getByText('Steady holes · bogey or better')).toBeTruthy();
    fireEvent(view.getByTestId('trend-chart-canvas'), 'layout', {
      nativeEvent: { layout: { width: 300 } },
    });
    const labels = view.UNSAFE_getAllByType(SvgText).map((t) => t.props.children);
    expect(labels).toEqual(['67%', '100%', '83%']);
  });

  test('damage and steady (i) buttons fire their own explainers', () => {
    const onInfo = jest.fn();
    const { getByLabelText } = renderCard({ onInfo });
    fireEvent.press(getByLabelText('What is Damage'));
    expect(onInfo).toHaveBeenCalledWith('damage');
    fireEvent.press(getByLabelText('What is Steady holes'));
    expect(onInfo).toHaveBeenCalledWith('steadyHoles');
  });

  test('reduced motion still renders every column statically', () => {
    mockReducedMotion = true;
    const { getByTestId } = renderCard();
    expect(getByTestId('scoremix-col-0')).toBeTruthy();
    expect(getByTestId('scoremix-col-2')).toBeTruthy();
  });
});
