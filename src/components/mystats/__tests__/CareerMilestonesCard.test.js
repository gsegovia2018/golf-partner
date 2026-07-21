import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { semantic } from '../../../theme/tokens';
import CareerMilestonesCard from '../CareerMilestonesCard';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

// Overrideable reduced-motion flag on top of the shared reanimated mock, so
// tests can assert both the count-up path and the static render path.
let mockReducedMotion = false;
jest.mock('react-native-reanimated', () => {
  const Reanimated = jest.requireActual('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => mockReducedMotion,
  };
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const milestones = {
  birdies: 12, eagles: 0, longestParStreak: 7, bestNine: 21, bestRound: 38,
};

beforeEach(() => {
  mockReducedMotion = false;
});

describe('CareerMilestonesCard', () => {
  test('reduced motion renders final values immediately (no count-up)', () => {
    mockReducedMotion = true;
    const { getByText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    expect(getByText('12')).toBeTruthy();
    expect(getByText('0')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
    expect(getByText('21')).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
    expect(getByText('Birdies')).toBeTruthy();
    expect(getByText('Eagles')).toBeTruthy();
    expect(getByText('Best par streak')).toBeTruthy();
    expect(getByText('Best nine')).toBeTruthy();
    expect(getByText('Best round')).toBeTruthy();
    // Net/gross basis disclosure lives on the board as a footnote.
    expect(getByText(/net \(handicap-adjusted\)/i)).toBeTruthy();
  });

  test('count-up reaches final values; accessibility labels carry them from the start', async () => {
    const { getByText, getByLabelText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    // Labels never animate, so screen readers get the real number even
    // while the visible text is still counting.
    expect(getByLabelText('Birdies: 12')).toBeTruthy();
    expect(getByLabelText('Best round: 38 pts')).toBeTruthy();

    await waitFor(() => expect(getByText('12')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(getByText('38')).toBeTruthy(), { timeout: 3000 });
  });

  test('best round renders gold; other numbers render cream', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    const gold = StyleSheet.flatten(getByTestId('milestone-best-round-value').props.style);
    expect(gold.color).toBe(semantic.winner.dark);
    expect(gold.color).toBe('#ffd700');
    const cream = StyleSheet.flatten(getByTestId('milestone-birdies-value').props.style);
    expect(cream.color).toBe('#f3efe6');
  });

  test('zero values render dimmed at 55% opacity, non-zero cells do not', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    expect(StyleSheet.flatten(getByTestId('milestone-eagles').props.style).opacity).toBe(0.55);
    expect(StyleSheet.flatten(getByTestId('milestone-birdies').props.style).opacity).toBeUndefined();
  });

  test('missing best nine/round render a dash and an honest accessibility label', () => {
    mockReducedMotion = true;
    const { getAllByText, getByLabelText } = render(wrap(
      <CareerMilestonesCard
        milestones={{ birdies: 3, eagles: 0, longestParStreak: 2, bestNine: null, bestRound: null }}
        onInfo={() => {}}
      />
    ));

    expect(getAllByText('-')).toHaveLength(2);
    expect(getByLabelText('Best nine: no complete round yet')).toBeTruthy();
    expect(getByLabelText('Best round: no complete round yet')).toBeTruthy();
  });

  test('pts suffix renders on best nine and best round only', () => {
    mockReducedMotion = true;
    const { getAllByText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    expect(getAllByText(' pts')).toHaveLength(2);
  });

  test('info button keeps the careerMilestones infoKey wiring', () => {
    const onInfo = jest.fn();
    const { getByLabelText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={onInfo} />
    ));

    fireEvent.press(getByLabelText('What is Career Milestones'));
    expect(onInfo).toHaveBeenCalledWith('careerMilestones');
  });
});
