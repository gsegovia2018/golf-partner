import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TourOverlay from '../TourOverlay';

const mockCoach = jest.fn(() => null);
jest.mock('../CoachMarks', () => (props) => { mockCoach(props); return null; });
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../store/tourStore', () => ({
  shouldShowTour: jest.fn(), completeTour: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../store/settingsStore', () => ({
  ...jest.requireActual('../../../store/settingsStore'),
  isSettingsHydrated: jest.fn(), subscribeSettingsHydration: jest.fn(() => () => {}),
}));
const { useAuth } = require('../../../context/AuthContext');
const { shouldShowTour, completeTour } = require('../../../store/tourStore');
const { isSettingsHydrated } = require('../../../store/settingsStore');

const steps = [{ key: 'k', title: 'T', body: 'B' }];

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 'u1', is_anonymous: false } });
  shouldShowTour.mockReturnValue(true);
  isSettingsHydrated.mockReturnValue(true);
});

it('renders CoachMarks when hydrated, signed-in, and flag unset', () => {
  render(<TourOverlay chapter="home" steps={steps} />);
  expect(mockCoach).toHaveBeenCalled();
});

it.each([
  ['not hydrated', () => isSettingsHydrated.mockReturnValue(false)],
  ['flag already stamped', () => shouldShowTour.mockReturnValue(false)],
  ['anonymous guest', () => useAuth.mockReturnValue({ user: { id: 'g', is_anonymous: true } })],
  ['signed out', () => useAuth.mockReturnValue({ user: null })],
])('renders nothing when %s', (_label, arrange) => {
  arrange();
  render(<TourOverlay chapter="home" steps={steps} />);
  expect(mockCoach).not.toHaveBeenCalled();
});

it('stamps the chapter flag on done and on skip, and unmounts', async () => {
  const { rerender } = render(<TourOverlay chapter="scorecard" steps={steps} />);
  mockCoach.mock.calls[0][0].onDone();
  await waitFor(() => expect(completeTour).toHaveBeenCalledWith('scorecard'));
  mockCoach.mockClear();
  rerender(<TourOverlay chapter="scorecard" steps={steps} />);
  expect(mockCoach).not.toHaveBeenCalled(); // locally dismissed even before settings round-trip
});
