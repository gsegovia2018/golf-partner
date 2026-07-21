import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import OnboardingScreen from '../OnboardingScreen';

const mockTheme = {
  isDark: false,
  bg: { primary: '#f6f3ee', secondary: '#ece8e1', card: '#ffffff' },
  border: { default: '#ddd' },
  text: { primary: '#111', secondary: '#555', muted: '#777', inverse: '#fff' },
  accent: { primary: '#006747', light: '#e6f0eb' },
  destructive: '#c8102e',
};

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../store/profileStore', () => ({
  upsertProfile: jest.fn().mockResolvedValue({}),
  isUsernameAvailable: jest.fn().mockResolvedValue(true),
}));
const { upsertProfile, isUsernameAvailable } = require('../../store/profileStore');

const profile = { email: 'marco@example.com', username: null, displayName: 'marco', gender: null };

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks only clears call history, not a prior test's
  // mockResolvedValue/mockRejectedValue override — re-pin the default so
  // tests stay isolated from each other's overrides.
  isUsernameAvailable.mockResolvedValue(true);
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

async function settleDebounce() {
  await act(async () => { jest.advanceTimersByTime(500); });
}

it('prefills username from email and display name from the profile', () => {
  const { getAllByDisplayValue } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  expect(getAllByDisplayValue('marco').length).toBe(2); // both fields prefill "marco"
});

it('shows "Available" after the debounced check passes', async () => {
  const { findByText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  await settleDebounce();
  expect(isUsernameAvailable).toHaveBeenCalledWith('marco');
  await findByText(/Available — friends find you as @marco/);
});

it('shows "taken" and disables Continue when the handle is taken', async () => {
  isUsernameAvailable.mockResolvedValue(false);
  const { findByText, getByLabelText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  await settleDebounce();
  await findByText(/already taken/);
  expect(getByLabelText('Continue')).toBeDisabled();
});

it('offline availability check does not block Continue', async () => {
  isUsernameAvailable.mockRejectedValue(new Error('offline'));
  const { getByLabelText, getByText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  fireEvent.press(getByText('Male'));
  await settleDebounce();
  expect(getByLabelText('Continue')).toBeEnabled();
});

it('requires a non-empty display name', async () => {
  const { getByLabelText, getByText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  fireEvent.press(getByText('Male'));
  await settleDebounce();
  fireEvent.changeText(getByLabelText('Display name'), '   ');
  expect(getByLabelText('Continue')).toBeDisabled();
});

it('saves all three fields and calls onDone', async () => {
  const onDone = jest.fn();
  const { getByLabelText, getByText } = render(<OnboardingScreen profile={profile} onDone={onDone} />);
  fireEvent.changeText(getByLabelText('Display name'), 'Marco S');
  fireEvent.press(getByText('Male'));
  await settleDebounce();
  await act(async () => { fireEvent.press(getByLabelText('Continue')); });
  await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({
    username: 'marco', displayName: 'Marco S', gender: 'male',
  }));
  expect(onDone).toHaveBeenCalled();
});
