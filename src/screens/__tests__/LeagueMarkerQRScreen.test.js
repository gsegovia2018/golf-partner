import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import LeagueMarkerQRScreen, { formatCountdown } from '../LeagueMarkerQRScreen';

jest.mock('../../store/leagueStore', () => ({ createMarkerToken: jest.fn() }));
jest.mock('react-native-qrcode-svg', () => function MockQRCode({ value }) {
  const { Text } = require('react-native');
  return <Text testID="qr-value">{value}</Text>;
});

const store = require('../../store/leagueStore');

const NOW = new Date('2026-10-04T12:00:00Z').getTime();
const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { cardId: 'card-1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueMarkerQRScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    store.createMarkerToken.mockResolvedValue({
      token: 'abc_DEF-123', expiresAt: new Date(NOW + 2 * 3600 * 1000).toISOString(),
    });
  });
  afterEach(() => { jest.useRealTimers(); });

  test('creates a code for the card and renders the marker link as a QR', async () => {
    const { getByTestId, getByText } = render(wrap(<LeagueMarkerQRScreen navigation={navigation} route={route} />));
    await waitFor(() => getByTestId('qr-value'));
    expect(store.createMarkerToken).toHaveBeenCalledWith('card-1');
    expect(getByTestId('qr-value').props.children).toBe('https://golf-partner.vercel.app/m/abc_DEF-123');
    expect(getByText('Ask your marker to scan this with their camera. No app needed.')).toBeTruthy();
    expect(getByText('Expires in 2:00:00 · works once')).toBeTruthy();
  });

  test('counts down every second and says when the code expired', async () => {
    store.createMarkerToken.mockResolvedValue({
      token: 't1', expiresAt: new Date(NOW + 65 * 1000).toISOString(),
    });
    const { getByText } = render(wrap(<LeagueMarkerQRScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Expires in 1:05 · works once'));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(getByText('Expires in 1:00 · works once')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(61000); });
    expect(getByText('This code expired · get a new one')).toBeTruthy();
  });

  test('New code asks for another token and shows it', async () => {
    const { getByTestId, getByText } = render(wrap(<LeagueMarkerQRScreen navigation={navigation} route={route} />));
    await waitFor(() => getByTestId('qr-value'));
    store.createMarkerToken.mockResolvedValue({
      token: 'second', expiresAt: new Date(NOW + 3600 * 1000).toISOString(),
    });
    fireEvent.press(getByText('New code'));
    await waitFor(() => expect(getByTestId('qr-value').props.children).toBe('https://golf-partner.vercel.app/m/second'));
    expect(store.createMarkerToken).toHaveBeenCalledTimes(2);
  });

  test('shows the server message when no code can be created', async () => {
    store.createMarkerToken.mockRejectedValue(new Error('Submit the card first.'));
    const { getByText, queryByTestId } = render(wrap(<LeagueMarkerQRScreen navigation={navigation} route={route} />));
    await waitFor(() => getByText('Submit the card first.'));
    expect(queryByTestId('qr-value')).toBeNull();
    expect(getByText('New code')).toBeTruthy();
  });

  test('Back goes back', async () => {
    const { getByLabelText, getByTestId } = render(wrap(<LeagueMarkerQRScreen navigation={navigation} route={route} />));
    await waitFor(() => getByTestId('qr-value'));
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('formatCountdown', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(59_500)).toBe('1:00');
    expect(formatCountdown(7_199_000)).toBe('1:59:59');
  });
});
