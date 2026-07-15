import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import HandicapTab from '../tabs/HandicapTab';
import { upsertProfile } from '../../../store/profileStore';

jest.mock('../../../store/profileStore', () => ({
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

const mockCourses = [{
  id: 'c1',
  name: 'Villaitana Levante',
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
  tees: [
    { id: 'tee-y', label: 'Yellow', rating: 71.5, slope: 128, ratingWomen: null, slopeWomen: null },
    { id: 'tee-r', label: 'Red', rating: 69.0, slope: 118, ratingWomen: 71.0, slopeWomen: 124 },
  ],
}];
jest.mock('../../../store/libraryStore', () => ({
  fetchCourses: jest.fn(() => Promise.resolve(mockCourses)),
  getCachedCourses: jest.fn(() => Promise.resolve([])),
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

describe('course handicap preview', () => {
  it('shows the playing handicap for the selected course and tee', async () => {
    const { findByText } = renderTab();
    fireEvent.press(await findByText('Villaitana Levante'));
    fireEvent.press(await findByText('Yellow'));
    // index 8.0 → round(8 × 128/113 + (71.5 − 72)) = round(8.56) = 9
    expect(await findByText(/you'd play off 9/i)).toBeTruthy();
  });

  it('uses women’s ratings for female players', async () => {
    const { findByText } = renderTab({ gender: 'female' });
    fireEvent.press(await findByText('Villaitana Levante'));
    fireEvent.press(await findByText('Red'));
    // index 8.0 → round(8 × 124/113 + (71.0 − 72)) = round(7.78) = 8
    expect(await findByText(/you'd play off 8/i)).toBeTruthy();
  });
});
