import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CoachMarks from '../CoachMarks';
import { HOME_TOUR_STEPS, SCORECARD_TOUR_STEPS } from '../tourSteps';
import { measureTourTarget } from '../tourTargets';

jest.mock('../tourTargets', () => ({
  ...jest.requireActual('../tourTargets'),
  measureTourTarget: jest.fn(),
}));

const RECT = { x: 10, y: 500, width: 60, height: 60 };
const steps = [
  { key: 'a', title: 'Alpha title', body: 'Alpha body.' },
  { key: 'b', title: 'Beta title', body: 'Beta body.' },
];

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

it('step copy matches the spec', () => {
  expect(HOME_TOUR_STEPS).toHaveLength(4);
  expect(HOME_TOUR_STEPS[0]).toEqual({
    key: 'tab-play',
    title: 'Everything starts here',
    body: 'Tap the flag to start a round or a weekend tournament — pairs and scoring are set up for you.',
  });
  expect(SCORECARD_TOUR_STEPS.map((s) => s.key)).toEqual(['score-entry', 'hole-distances', 'hole-nav']);
});

it('renders the first measurable step with counter, then advances on Next', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const onDone = jest.fn();
  const { findByText, getByText } = render(wrap(<CoachMarks steps={steps} onDone={onDone} onSkip={jest.fn()} />));
  await findByText('Alpha title');
  expect(getByText('TOUR · 1 OF 2')).toBeTruthy();
  fireEvent.press(getByText('Next'));
  await findByText('Beta title');
  expect(getByText('Done')).toBeTruthy();
  fireEvent.press(getByText('Done'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('tapping the spotlighted area advances', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const { findByText, getByTestId } = render(wrap(
    <CoachMarks steps={steps} onDone={jest.fn()} onSkip={jest.fn()} />,
  ));
  await findByText('Alpha title');
  fireEvent.press(getByTestId('coachmarks-target-press'));
  await findByText('Beta title');
});

it('retries a step whose target measures null before succeeding', async () => {
  jest.useFakeTimers();
  let callsForA = 0;
  measureTourTarget.mockImplementation((key) => {
    if (key !== 'a') return Promise.resolve(RECT);
    callsForA += 1;
    return Promise.resolve(callsForA <= 2 ? null : RECT);
  });
  const { findByText } = render(wrap(
    <CoachMarks steps={steps} onDone={jest.fn()} onSkip={jest.fn()} />,
  ));
  await findByText('Alpha title');
  // Two null measurements (with retry delays in between), then the rect on
  // the third attempt — the stop still renders instead of being skipped.
  expect(callsForA).toBe(3);
});

it('skips unmeasurable steps silently', async () => {
  jest.useFakeTimers();
  measureTourTarget.mockImplementation((key) => Promise.resolve(key === 'a' ? null : RECT));
  const { findByText, queryByText } = render(wrap(
    <CoachMarks steps={steps} onDone={jest.fn()} onSkip={jest.fn()} />,
  ));
  await findByText('Beta title');
  expect(queryByText('Alpha title')).toBeNull();
  // Exhausted every retry attempt for the unmeasurable step before skipping.
  expect(measureTourTarget.mock.calls.filter(([key]) => key === 'a')).toHaveLength(5);
});

it('auto-completes without rendering when nothing is measurable', async () => {
  jest.useFakeTimers();
  measureTourTarget.mockResolvedValue(null);
  const onDone = jest.fn();
  const { queryByText } = render(wrap(<CoachMarks steps={steps} onDone={onDone} onSkip={jest.fn()} />));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(queryByText('Alpha title')).toBeNull();
  // Every step exhausted its retries (5 attempts each) rather than being
  // skipped on the first null measurement.
  expect(measureTourTarget.mock.calls.filter(([key]) => key === 'a')).toHaveLength(5);
  expect(measureTourTarget.mock.calls.filter(([key]) => key === 'b')).toHaveLength(5);
});

it('Skip tour calls onSkip', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const onSkip = jest.fn();
  const { findByText, getByText } = render(wrap(<CoachMarks steps={steps} onDone={jest.fn()} onSkip={onSkip} />));
  await findByText('Alpha title');
  fireEvent.press(getByText('Skip tour'));
  expect(onSkip).toHaveBeenCalledTimes(1);
});

it('does not restart the tour when the parent re-renders with new inline callback/prop identities', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const onDoneFirst = jest.fn();
  const { findByText, getByText, rerender, queryByText } = render(wrap(
    <CoachMarks steps={steps} onDone={onDoneFirst} onSkip={jest.fn()} />,
  ));
  await findByText('Alpha title');
  fireEvent.press(getByText('Next'));
  await findByText('Beta title');

  // Parent re-renders with brand-new inline onDone/steps/onSkip identities —
  // this must not restart the tour back at step 1.
  const onDoneLatest = jest.fn();
  rerender(wrap(
    <CoachMarks steps={[...steps]} onDone={onDoneLatest} onSkip={() => {}} />,
  ));
  expect(getByText('Beta title')).toBeTruthy();
  expect(queryByText('Alpha title')).toBeNull();

  fireEvent.press(getByText('Done'));
  await waitFor(() => expect(onDoneLatest).toHaveBeenCalledTimes(1));
  expect(onDoneFirst).not.toHaveBeenCalled();
});

it('scrim panels consume presses as a no-op instead of passing through', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const { findByText, getByTestId, getByText } = render(wrap(
    <CoachMarks steps={steps} onDone={jest.fn()} onSkip={jest.fn()} />,
  ));
  await findByText('Alpha title');
  expect(() => fireEvent.press(getByTestId('coachmarks-scrim-top'))).not.toThrow();
  expect(() => fireEvent.press(getByTestId('coachmarks-scrim-bottom'))).not.toThrow();
  expect(() => fireEvent.press(getByTestId('coachmarks-scrim-left'))).not.toThrow();
  expect(() => fireEvent.press(getByTestId('coachmarks-scrim-right'))).not.toThrow();
  // Still on step 1 — pressing the dimmed area did not advance the tour.
  expect(getByText('Alpha title')).toBeTruthy();
});
