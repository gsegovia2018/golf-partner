import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import LeagueCardsList from '../LeagueCardsList';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const rows = [
  { playerId: 'p1', kind: 'me', name: 'Marcos' },
  { playerId: 'p2', kind: 'counts', name: 'Javier' },
  { playerId: 'p3', kind: 'asked', name: 'Carlos' },
  { playerId: 'p4', kind: 'hasCard', name: 'Luis' },
  { playerId: 'p5', kind: 'unrated', name: 'Pablo', tee: 'Red' },
  { playerId: 'p6', kind: 'notMember', name: 'Ana' },
];

describe('LeagueCardsList', () => {
  test('one row per player; only my row has a switch, the others say what they decide', () => {
    const onChange = jest.fn();
    const { getByText, getByLabelText, getAllByRole } = render(wrap(
      <LeagueCardsList
        title="League cards · Mulligan"
        rows={rows}
        monthKey="2026-10"
        me={{ value: false, onChange, label: 'Counts for Mulligan', sub: 'October card' }}
      />,
    ));
    expect(getByText('League cards · Mulligan')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(getByText('October card')).toBeTruthy();
    expect(getByLabelText('Javier, His card counts for this round')).toBeTruthy();
    expect(getByLabelText('Carlos, Decides on his own phone before his first shot')).toBeTruthy();
    expect(getByLabelText('Luis, Already has an October card')).toBeTruthy();
    expect(getByLabelText("Pablo, His tee isn't rated (Red), so it can't count")).toBeTruthy();
    expect(getByLabelText('Ana, Not in the league')).toBeTruthy();
    expect(getAllByRole('switch')).toHaveLength(1);
    fireEvent(getByLabelText('Counts for Mulligan'), 'valueChange', true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('short wording for Start Round N; "a" before a consonant month', () => {
    const { getByText } = render(wrap(
      <LeagueCardsList title="Round 2 for Mulligan" rows={rows} monthKey="2026-11" short />,
    ));
    expect(getByText('Decides on his own phone')).toBeTruthy();
    expect(getByText('Asked')).toBeTruthy();
    expect(getByText('Already has a November card')).toBeTruthy();
  });

  test('loading shows the check, not the rows', () => {
    const { getByText, queryByText } = render(wrap(
      <LeagueCardsList title="T" state="loading" rows={rows} monthKey="2026-10" />,
    ));
    expect(getByText('Checking your league…')).toBeTruthy();
    expect(queryByText('Javier')).toBeNull();
  });

  test('offline: my switch is off and disabled, Try again retries', () => {
    const onRetry = jest.fn();
    const { getByText, getByLabelText } = render(wrap(
      <LeagueCardsList
        title="T" state="error" rows={rows} monthKey="2026-10" onRetry={onRetry}
        me={{ value: true, onChange: jest.fn(), label: 'Counts for Mulligan' }}
      />,
    ));
    expect(getByText('Not counted: no connection.')).toBeTruthy();
    const sw = getByLabelText('Counts for Mulligan');
    expect(sw.props.value).toBe(false);
    expect(sw.props.disabled).toBe(true);
    fireEvent.press(getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('footer renders below the rows', () => {
    const { getByText } = render(wrap(
      <LeagueCardsList title="T" rows={[]} footer="Only round 2 counts." />,
    ));
    expect(getByText('Only round 2 counts.')).toBeTruthy();
  });
});
