import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ScoreMixColumns, { DamageHeader, columnDateLabel } from '../ScoreMixColumns';

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

const renderCard = (over = {}) => render(wrap(
  <ScoreMixColumns rounds={rounds} damage={damage} {...over} />,
));

const renderHeader = (over = {}) => render(wrap(
  <DamageHeader damage={damage} {...over} />,
));

describe('DamageHeader', () => {
  test('shows the latest round damage value with reduced motion', () => {
    mockReducedMotion = true;
    const { getByText, getByTestId } = renderHeader();
    expect(getByTestId('scoremix-damage-value')).toBeTruthy();
    expect(getByText('4')).toBeTruthy(); // latest round's damage, not the average
  });

  test('delta chip is green with ▼ when the latest round leaked less than average', () => {
    const { getByTestId, getByText } = renderHeader({ damage: mkSeries([7, 7, 0]) });
    const chip = getByTestId('scoremix-damage-chip');
    expect(getByText('▼ 7 vs your average')).toBeTruthy();
    // Clubhouse green #006747 at the 12% chip wash.
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe('rgba(0,103,71,0.12)');
    expect(chip.props.accessibilityLabel)
      .toBe('7 strokes below your average of the other rounds');
  });

  test('delta chip is red with ▲ when the latest round leaked more than average', () => {
    const { getByTestId, getByText } = renderHeader({ damage: mkSeries([0, 0, 6]) });
    const chip = getByTestId('scoremix-damage-chip');
    expect(getByText('▲ 6 vs your average')).toBeTruthy();
    // Masters red #c8102e at the 12% chip wash.
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe('rgba(200,16,46,0.12)');
    expect(chip.props.accessibilityLabel)
      .toBe('6 strokes above your average of the other rounds');
  });

  test('delta chip goes muted "level" inside half a stroke of average', () => {
    const { getByText, getByTestId } = renderHeader({ damage: mkSeries([4, 4, 4]) });
    expect(getByText('level with your average')).toBeTruthy();
    expect(getByTestId('scoremix-damage-chip').props.accessibilityLabel)
      .toBe('Level with your average of the other rounds');
  });

  test('no delta chip without a second round of damage data', () => {
    const { queryByTestId } = renderHeader({ damage: mkSeries([null, null, 5]) });
    expect(queryByTestId('scoremix-damage-chip')).toBeNull();
  });

  test('the (i) button fires the damage explainer', () => {
    const onInfo = jest.fn();
    const { getByLabelText } = renderHeader({ onInfo });
    fireEvent.press(getByLabelText('What is Damage'));
    expect(onInfo).toHaveBeenCalledWith('damage');
  });
});

describe('ScoreMixColumns', () => {
  test('shows the empty state with fewer than two rounds', () => {
    const { getByText, queryByTestId } = renderCard({ rounds: [rounds[0]] });
    expect(getByText('Select two or more rounds to see the score mix.')).toBeTruthy();
    expect(queryByTestId('scoremix-col-0')).toBeNull();
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

  test('column labels shorten "Course · date" to the date; undated fall back to R{n}', () => {
    const dated = [
      { label: 'Old Pines · 14 Jun', birdiePlus: 1, par: 15, bogey: 2, double: 0, worse: 0 },
      { label: 'CCVM', birdiePlus: 0, par: 16, bogey: 2, double: 0, worse: 0 },
      { label: 'Oak Hill · 4 Sept', birdiePlus: 2, par: 14, bogey: 2, double: 0, worse: 0 },
    ];
    const { getByText, queryByText } = renderCard({ rounds: dated });
    expect(getByText('14 Jun')).toBeTruthy();
    expect(getByText('4 Sept')).toBeTruthy();
    expect(getByText('R2')).toBeTruthy(); // no date on the CCVM round
    expect(queryByText('Old Pines · 14 Jun')).toBeNull(); // full label only in the detail line
  });

  test('columnDateLabel keeps course names with separators intact via the date-shape check', () => {
    expect(columnDateLabel('Old Pines · 14 Jun', 0)).toBe('14 Jun');
    expect(columnDateLabel('Club · North Course', 4)).toBe('R5'); // no trailing date part
    expect(columnDateLabel(undefined, 2)).toBe('R3');
  });

  test('a11y labels carry the round label plus the five band counts', () => {
    const { getByTestId } = renderCard();
    expect(getByTestId('scoremix-col-0').props.accessibilityLabel)
      .toBe('R1: 3 birdie or better, 9 par, 3 bogey, 2 double bogey, 1 worse');
    expect(getByTestId('scoremix-col-press-0').props.accessibilityState)
      .toEqual({ selected: false });
  });

  test('tapping a column reveals its detail line; tapping again deselects', () => {
    const { getByTestId, queryByTestId, getByText } = renderCard();
    expect(queryByTestId('scoremix-detail')).toBeNull();

    fireEvent.press(getByTestId('scoremix-col-press-0'));
    expect(getByText('R1 — 2 doubles · 1 worse · damage 9')).toBeTruthy();
    expect(getByTestId('scoremix-col-press-0').props.accessibilityState)
      .toEqual({ selected: true });
    // Selected column: full opacity + the 2px text.primary frame.
    const style = StyleSheet.flatten(getByTestId('scoremix-col-0').props.style);
    expect(style.opacity).toBeUndefined();
    expect(style.borderColor).toBe('#1a1a1a');
    expect(style.borderWidth).toBe(2);
    // Unselected columns keep a transparent frame — no layout shift.
    const other = StyleSheet.flatten(getByTestId('scoremix-col-1').props.style);
    expect(other.borderColor).toBe('transparent');
    expect(other.borderWidth).toBe(2);

    fireEvent.press(getByTestId('scoremix-col-press-0'));
    expect(queryByTestId('scoremix-detail')).toBeNull();
  });

  test('selecting a different column swaps the detail line and singular/plural counts', () => {
    const { getByTestId, getByText } = renderCard({ damage: mkSeries([9, 3, null]) });
    fireEvent.press(getByTestId('scoremix-col-press-1'));
    expect(getByText('R2 — 0 doubles · 0 worse · damage 3')).toBeTruthy();
    fireEvent.press(getByTestId('scoremix-col-press-2'));
    // 2 doubles pluralized, null damage prints a dash.
    expect(getByText('R3 — 2 doubles · 1 worse · damage —')).toBeTruthy();
    expect(getByTestId('scoremix-col-press-1').props.accessibilityState)
      .toEqual({ selected: false });
  });

  test('detail line uses the full round label for dated rounds', () => {
    const dated = [
      { label: 'Old Pines · 14 Jun', birdiePlus: 1, par: 14, bogey: 0, double: 2, worse: 1 },
      { label: 'Oak Hill · 4 Sept', birdiePlus: 2, par: 14, bogey: 2, double: 0, worse: 0 },
    ];
    const { getByTestId, getByText } = renderCard({
      rounds: dated,
      damage: [{ label: 'Old Pines · 14 Jun', value: 5 }, { label: 'Oak Hill · 4 Sept', value: 0 }],
    });
    fireEvent.press(getByTestId('scoremix-col-press-0'));
    expect(getByText('Old Pines · 14 Jun — 2 doubles · 1 worse · damage 5')).toBeTruthy();
  });

  test('renders date labels and a five-entry legend', () => {
    const { getByText } = renderCard();
    ['R1', 'R2', 'R3'].forEach((label) => expect(getByText(label)).toBeTruthy());
    ['Birdie+', 'Par', 'Bogey', 'Double', 'Worse'].forEach((label) => expect(getByText(label)).toBeTruthy());
  });

  test('reduced motion still renders every column statically and keeps selection working', () => {
    mockReducedMotion = true;
    const { getByTestId, getByText } = renderCard();
    expect(getByTestId('scoremix-col-0')).toBeTruthy();
    expect(getByTestId('scoremix-col-2')).toBeTruthy();
    fireEvent.press(getByTestId('scoremix-col-press-2'));
    expect(getByText('R3 — 2 doubles · 1 worse · damage 4')).toBeTruthy();
  });
});
