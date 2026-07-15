import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import HandicapTab from '../tabs/HandicapTab';
import { upsertProfile } from '../../../store/profileStore';

jest.mock('../../../store/profileStore', () => ({
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1, par: 4, strokeIndex: i + 1,
}));

// Complete par-72 round with differential = gross total − 72 (slope 113).
function myRound(key, diff) {
  const total = 72 + diff;
  const base = Math.floor(total / 18);
  const extra = total - base * 18;
  return {
    key,
    courseName: `Course ${key}`,
    tournamentDate: '2026-07-01T00:00:00Z',
    playerId: 'p1',
    player: { id: 'p1', handicap: 54 },
    isComplete: true,
    round: {
      holes,
      scores: { p1: Object.fromEntries(holes.map((h, j) => [h.number, base + (j < extra ? 1 : 0)])) },
      playerTees: { p1: { slope: 113, rating: 72 } },
      playerHandicaps: { p1: 54 },
    },
  };
}

// A round with only `played` of 18 holes scored — ineligible ('partial').
function partialRound(key, played) {
  const r = myRound(key, 10);
  r.isComplete = false;
  r.holesPlayed = played;
  r.round = {
    ...r.round,
    scores: { p1: Object.fromEntries(holes.slice(0, played).map((h) => [h.number, 5])) },
  };
  return r;
}

const renderTab = (props = {}) => render(
  <ThemeProvider>
    <HandicapTab
      myRounds={[myRound('a', 10), myRound('b', 14), myRound('c', 12)]}
      profileHandicap={20}
      gender={null}
      onInfo={jest.fn()}
      onApplied={jest.fn()}
      {...props}
    />
  </ThemeProvider>,
);

describe('HandicapTab', () => {
  it('shows the calculated index and the counting basis', async () => {
    const { findByText } = renderTab();
    // 3 differentials → lowest (10.0) − 2 = 8.0
    expect(await findByText('8.0')).toBeTruthy();
    expect(await findByText(/Best 1 of last 3/i)).toBeTruthy();
  });

  it('lists differentials with course names', async () => {
    const { findByText } = renderTab();
    expect(await findByText(/Course a/)).toBeTruthy();
    expect(await findByText('10.0')).toBeTruthy();
  });

  it('applies the index to the profile on tap', async () => {
    const onApplied = jest.fn();
    const { findByText } = renderTab({ onApplied });
    fireEvent.press(await findByText(/Set as my handicap/i));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({ handicap: 8 }));
    expect(onApplied).toHaveBeenCalledWith(8);
  });

  it('shows the empty state below 3 eligible rounds', async () => {
    const { findByText } = renderTab({ myRounds: [myRound('a', 10)] });
    expect(await findByText(/2 more/i)).toBeTruthy();
  });
});

describe('index evolution chart', () => {
  it('renders the evolution card once there are 2+ points (4+ rounds)', async () => {
    const { findByText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
    });
    expect(await findByText('Index evolution')).toBeTruthy();
    expect(await findByText(/After each qualifying round/)).toBeTruthy();
  });

  it('is absent with only one point (3 rounds)', async () => {
    const { findByText, queryByText } = renderTab();
    await findByText('8.0'); // wait for the hero so the tab is fully rendered
    expect(queryByText('Index evolution')).toBeNull();
  });
});

describe('round exclusion toggles', () => {
  it('fires onToggleExcluded with the round key', async () => {
    const onToggleExcluded = jest.fn();
    const { findAllByLabelText } = renderTab({ onToggleExcluded });
    const buttons = await findAllByLabelText('Exclude round from handicap');
    fireEvent.press(buttons[0]);
    expect(onToggleExcluded).toHaveBeenCalledWith(expect.stringMatching(/^(a|b|c)$/));
  });

  it('renders excluded rounds greyed with an include button and updates the hero', async () => {
    const { findByText, findAllByLabelText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
      excludedKeys: new Set(['b']),
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText('Excluded')).toBeTruthy();
    expect(await findAllByLabelText('Include round in handicap')).toHaveLength(1);
    expect(await findByText(/1 excluded/)).toBeTruthy();
  });

  it('shows ineligible rounds with the reason and no toggle', async () => {
    const { findByText, queryAllByLabelText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), partialRound('p', 14)],
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText(/partial · 14 holes/)).toBeTruthy();
    // 3 included rows have exclude buttons; the partial row has none.
    expect(queryAllByLabelText('Exclude round from handicap')).toHaveLength(3);
  });

  it('keeps excluded rows reachable when exclusions drop the index below 3 rounds', async () => {
    const { findByText, findAllByLabelText } = renderTab({
      excludedKeys: new Set(['a']),
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText(/Not enough qualifying rounds yet/)).toBeTruthy();
    expect(await findByText('Excluded')).toBeTruthy();
    expect(await findAllByLabelText('Include round in handicap')).toHaveLength(1);
  });
});
