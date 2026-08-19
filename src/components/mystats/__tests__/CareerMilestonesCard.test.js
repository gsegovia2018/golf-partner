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

// birdies/eagles/streak are GROSS counts now, so the realistic figures are
// small. bestRoundHandicap is the frozen playing handicap that round was
// scored off — it labels the era the 38 belongs to.
const milestones = {
  birdies: 6, eagles: 0, longestParStreak: 3, bestNine: 21, bestRound: 38,
  bestRoundHandicap: 20, bestDifferential: 14.2,
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

    expect(getByText('6')).toBeTruthy();
    expect(getByText('0')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('21')).toBeTruthy();
    expect(getByText('14.2')).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
    expect(getByText('Birdies')).toBeTruthy();
    expect(getByText('Eagles')).toBeTruthy();
    expect(getByText('Best par streak')).toBeTruthy();
    expect(getByText('Best nine')).toBeTruthy();
    expect(getByText('Best differential')).toBeTruthy();
    expect(getByText('Best round')).toBeTruthy();
    // Gross/net basis disclosure lives on the board as a footnote.
    expect(getByText(/birdies, eagles and streaks are gross/i)).toBeTruthy();
  });

  test('best round carries the handicap it was scored off, so its era is legible', () => {
    mockReducedMotion = true;
    const { getByTestId, getByLabelText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    expect(getByTestId('milestone-best-round-note').props.children).toBe('off 20');
    expect(getByLabelText('Best round: 38 pts off 20')).toBeTruthy();
  });

  test('no note when the best round has no recorded handicap', () => {
    mockReducedMotion = true;
    const { queryByTestId, getByLabelText } = render(wrap(
      <CareerMilestonesCard
        milestones={{ ...milestones, bestRoundHandicap: null }}
        onInfo={() => {}}
      />
    ));

    expect(queryByTestId('milestone-best-round-note')).toBeNull();
    expect(getByLabelText('Best round: 38 pts')).toBeTruthy();
  });

  test('count-up reaches final values; accessibility labels carry them from the start', async () => {
    const { getByText, getByLabelText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    // Labels never animate, so screen readers get the real number even
    // while the visible text is still counting.
    expect(getByLabelText('Birdies: 6')).toBeTruthy();
    expect(getByLabelText('Best round: 38 pts off 20')).toBeTruthy();

    await waitFor(() => expect(getByText('6')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(getByText('38')).toBeTruthy(), { timeout: 3000 });
  });

  test('best round renders gold; other numbers render primary ink', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />
    ));

    const gold = StyleSheet.flatten(getByTestId('milestone-best-round-value').props.style);
    expect(gold.color).toBe(semantic.winner.light);
    expect(gold.color).toBe('#8a6d00');
    const ink = StyleSheet.flatten(getByTestId('milestone-birdies-value').props.style);
    expect(ink.color).toBe('#1a1a1a');
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
        milestones={{
          birdies: 3, eagles: 0, longestParStreak: 2,
          bestNine: null, bestRound: null, bestDifferential: null,
        }}
        onInfo={() => {}}
      />
    ));

    // Best nine, best differential and best round all dash out together.
    expect(getAllByText('-')).toHaveLength(3);
    expect(getByLabelText('Best nine: no complete round yet')).toBeTruthy();
    expect(getByLabelText('Best differential: no complete round yet')).toBeTruthy();
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
