import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import DeadlineLine, { countdownText, dayWord, clockWithDay } from '../DeadlineLine';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const NOW = new Date(2025, 9, 3, 13, 8); // Fri 3 Oct 13:08 local
const at = (day, h, m) => new Date(2025, 9, day, h, m);
const card = (postBy, status = 'announced') => ({ status, postBy: postBy.toISOString() });

describe('DeadlineLine formatting', () => {
  test('countdown is hours and minutes, minutes only under an hour', () => {
    expect(countdownText((5 * 60 + 22) * 60000)).toBe('5 h 22 m');
    expect(countdownText(40 * 60000)).toBe('40 m');
    expect(countdownText(-5000)).toBe('0 m');
  });

  test('day words: today, tomorrow, a weekday, then a date', () => {
    expect(dayWord(at(3, 20, 0), NOW)).toBe('today');
    expect(dayWord(at(4, 2, 15), NOW)).toBe('tomorrow');
    expect(dayWord(at(7, 9, 0), NOW)).toBe('Tuesday');
    expect(dayWord(at(20, 9, 0), NOW)).toBe('Mon 20 Oct');
    expect(clockWithDay(at(3, 18, 30), NOW)).toBe('18:30');
    expect(clockWithDay(at(3, 18, 30), NOW, true)).toBe('18:30 today');
    expect(clockWithDay(at(4, 2, 15), NOW)).toBe('02:15 tomorrow');
  });
});

describe('DeadlineLine', () => {
  afterEach(() => jest.useRealTimers());

  test('calm line: post by, countdown, no "left", spelled-out label', () => {
    jest.useFakeTimers({ now: NOW });
    const { getByText, getByLabelText } = render(wrap(<DeadlineLine card={card(at(3, 18, 30))} />));
    expect(getByText(/Post by 18:30/)).toBeTruthy();
    expect(getByText('5 h 22 m')).toBeTruthy();
    expect(getByLabelText('Post your score by 18:30 today, 5 hours 22 minutes left')).toBeTruthy();
  });

  test('under 2 hours the wording says "left" (not colour alone)', () => {
    jest.useFakeTimers({ now: NOW });
    const { getByText, getByLabelText } = render(wrap(<DeadlineLine card={card(at(3, 14, 48))} />));
    expect(getByText('1 h 40 m left')).toBeTruthy();
    expect(getByLabelText('Post your score by 14:48 today, 1 hour 40 minutes left')).toBeTruthy();
  });

  test('another day shows the day name; ticks every minute and cleans up', () => {
    jest.useFakeTimers({ now: NOW });
    const { getByText, unmount } = render(wrap(<DeadlineLine card={card(at(4, 2, 15))} />));
    expect(getByText(/Post by 02:15 tomorrow/)).toBeTruthy();
    expect(getByText('13 h 7 m')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(60000); });
    expect(getByText('13 h 6 m')).toBeTruthy();
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('renders nothing without a deadline, once past it, or off a live card', () => {
    jest.useFakeTimers({ now: NOW });
    const none = render(wrap(<DeadlineLine card={{ status: 'announced', postBy: null }} />));
    expect(none.toJSON()).toBeNull();
    const past = render(wrap(<DeadlineLine card={card(at(3, 12, 0))} />));
    expect(past.toJSON()).toBeNull();
    const done = render(wrap(<DeadlineLine card={card(at(3, 18, 0), 'submitted')} />));
    expect(done.toJSON()).toBeNull();
  });
});
