import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import LeagueStrip from '../LeagueStrip';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('LeagueStrip', () => {
  test('no strip state renders nothing', () => {
    const { toJSON } = render(wrap(<LeagueStrip strip={null} />));
    expect(toJSON()).toBeNull();
  });

  test('my card counts: count and names, me first', () => {
    const strip = { kind: 'cards', count: 2, names: [{ me: true }, { name: 'Javier' }], mine: true };
    const { getByText } = render(wrap(<LeagueStrip strip={strip} />));
    expect(getByText('2 league cards')).toBeTruthy();
    expect(getByText(/in this game: you and Javier/)).toBeTruthy();
  });

  test('my post deadline is appended once it runs', () => {
    const strip = { kind: 'cards', count: 1, names: [{ me: true }], mine: true };
    const { getByText } = render(wrap(<LeagueStrip strip={strip} postBy="2026-10-13T16:30:00Z" />));
    // 18:30 Madrid; the clock format follows the device locale.
    expect(getByText(/post by (18:30|6:30\s?pm)/i)).toBeTruthy();
  });

  test('others only: "Count mine" shows when I can still opt in, and calls back', () => {
    const onCountMine = jest.fn();
    const strip = { kind: 'othersOnly', count: 1, names: [{ name: 'Javier' }], canOptIn: true };
    const { getByText } = render(wrap(<LeagueStrip strip={strip} onCountMine={onCountMine} />));
    expect(getByText(/Javier's card counts for the league\./)).toBeTruthy();
    fireEvent.press(getByText('Count mine'));
    expect(onCountMine).toHaveBeenCalledTimes(1);
  });

  test('others only without the opt-in: no link', () => {
    const strip = { kind: 'othersOnly', count: 2, names: [{ name: 'Javier' }, { name: 'Carlos' }], canOptIn: false };
    const { getByText, queryByText } = render(wrap(<LeagueStrip strip={strip} onCountMine={jest.fn()} />));
    expect(getByText("Javier and Carlos's cards count for the league.")).toBeTruthy();
    expect(queryByText('Count mine')).toBeNull();
  });

  test('too late after my first score', () => {
    const strip = { kind: 'tooLate', count: 0, names: [] };
    const { getByText } = render(wrap(<LeagueStrip strip={strip} />));
    expect(getByText(/You've already started this round, so it can't be your .+ card\./)).toBeTruthy();
  });
});
