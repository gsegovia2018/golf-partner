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
    const { findAllByText, findByText } = renderTab();
    // 3 differentials → lowest (10.0) − 2 = 8.0 (also echoed in the ledger's
    // "→ index" column, hence findAll)
    expect((await findAllByText('8.0')).length).toBeGreaterThan(0);
    expect(await findByText(/best 1 of last 3/i)).toBeTruthy();
    expect(await findByText('Season Ledger')).toBeTruthy();
  });

  it('lists differentials with course names in the ledger', async () => {
    const { findAllByText, findByText } = renderTab();
    // the course name also appears in the next-round gross target line
    expect((await findAllByText(/Course a/)).length).toBeGreaterThan(0);
    expect(await findByText('10.0')).toBeTruthy();
  });

  it('shows the personal low fact', async () => {
    const { findByText } = renderTab();
    expect(await findByText('Personal low')).toBeTruthy();
    // With 3 rounds the walk has one point, so the low is the current index.
    expect(await findByText(/8\.0 · now/)).toBeTruthy();
  });

  it('applies the index to the profile on tap', async () => {
    const onApplied = jest.fn();
    const { findByText } = renderTab({ onApplied });
    fireEvent.press(await findByText(/Set 8\.0 as my handicap/));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({ handicap: 8 }));
    expect(onApplied).toHaveBeenCalledWith(8);
  });

  it('shows the empty state below 3 eligible rounds', async () => {
    const { findByText } = renderTab({ myRounds: [myRound('a', 10)] });
    expect(await findByText(/2 more/i)).toBeTruthy();
  });
});

describe('your next round card', () => {
  it('states the drop target with a gross translation', async () => {
    const { findByText } = renderTab();
    expect(await findByText('Your next round')).toBeTruthy();
    expect(await findByText(/and your index drops/)).toBeTruthy();
    expect(await findByText(/gross/)).toBeTruthy();
  });
});

describe('index history chart', () => {
  it('appears with 2+ points (4+ rounds) and defaults to the by-round view', async () => {
    const { findByText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
    });
    expect(await findByText('Index history')).toBeTruthy();
    expect(await findByText(/Recomputed after every qualifying round/)).toBeTruthy();
  });

  it('switches to the monthly view on toggle', async () => {
    const { findByText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
    });
    fireEvent.press(await findByText('By month'));
    expect(await findByText(/End-of-month index/)).toBeTruthy();
  });

  it('shows a tooltip naming the round when a point is pressed', async () => {
    const { findByTestId, findAllByLabelText, findByText, queryByText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
    });
    const chart = await findByTestId('index-history-chart');
    fireEvent(chart, 'layout', { nativeEvent: { layout: { width: 340, height: 150 } } });
    expect(queryByText('Course c · 1 Jul')).toBeNull();
    // hit strips carry "value — detail" labels; press the first point (round c)
    const strips = await findAllByLabelText(/8\.0 — Course c · 1 Jul/);
    fireEvent.press(strips[0]);
    expect(await findByText('Course c · 1 Jul')).toBeTruthy();
    // pressing the same point again dismisses the tooltip
    fireEvent.press(strips[0]);
    expect(queryByText('Course c · 1 Jul')).toBeNull();
  });

  it('is absent with only one point (3 rounds)', async () => {
    const { findByText, queryByText } = renderTab();
    await findByText('Season Ledger'); // wait for the plate to render
    expect(queryByText('Index history')).toBeNull();
  });
});

describe('round exclusion toggles', () => {
  it('fires onToggleExcluded with the round key', async () => {
    const onToggleExcluded = jest.fn();
    const { findAllByLabelText } = renderTab({ onToggleExcluded });
    const buttons = await findAllByLabelText(/^Exclude Course .+ from handicap$/);
    fireEvent.press(buttons[0]);
    expect(onToggleExcluded).toHaveBeenCalledWith(expect.stringMatching(/^(a|b|c)$/));
  });

  it('renders excluded rounds struck-through with a Re-add control', async () => {
    const { findByText, findAllByLabelText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
      excludedKeys: new Set(['b']),
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText('Re-add')).toBeTruthy();
    expect(await findAllByLabelText(/^Include Course .+ in handicap$/)).toHaveLength(1);
  });

  it('hides unfinished partial rounds but keeps other ineligible reasons visible', async () => {
    const nineHole = myRound('n', 10);
    nineHole.round = { ...nineHole.round, holes: holes.slice(0, 9) };
    const { findByText, queryByText, queryAllByLabelText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), partialRound('p', 14), nineHole],
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText(/9-hole round/)).toBeTruthy();
    expect(queryByText(/partial · 14 holes/)).toBeNull();
    expect(queryByText('Course p')).toBeNull();
    // 3 included rows have exclude buttons; ineligible rows have none.
    expect(queryAllByLabelText(/^Exclude Course .+ from handicap$/)).toHaveLength(3);
  });

  it('keeps excluded rows reachable when exclusions drop the index below 3 rounds', async () => {
    const { findByText, findAllByLabelText } = renderTab({
      excludedKeys: new Set(['a']),
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText(/Not enough qualifying rounds yet/)).toBeTruthy();
    expect(await findByText('Re-add')).toBeTruthy();
    expect(await findAllByLabelText(/^Include Course .+ in handicap$/)).toHaveLength(1);
  });
});
