import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SharedBoardScreen from '../SharedBoardScreen';
import { supabase } from '../../lib/supabase';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// Same shape/fixture style as src/store/__tests__/sharedBoard.test.js's
// "two-round tournament: one completed round, one live partial round" case —
// this screen only renders buildSharedBoardModel's output, so reusing that
// fixture keeps the two test suites honest about the same contract.
const happyPayload = {
  name: 'Weekend Cup',
  kind: 'casual',
  createdAt: '2026-08-14T09:00:00.000Z',
  currentRound: 1,
  players: [
    { id: 'p1', name: 'Ann Lee', handicap: 10 },
    { id: 'p2', name: 'Bob Ray', handicap: 5 },
  ],
  rounds: [
    {
      id: 'r1',
      courseName: 'Pebble Beach',
      scoringMode: 'stableford',
      holes: [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }],
      playerHandicaps: { p1: 0, p2: 0 },
      scores: { p1: { 1: 4, 2: 4 }, p2: { 1: 5, 2: 5 } },
    },
    {
      id: 'r2',
      courseName: 'Spyglass',
      scoringMode: 'stableford',
      holes: [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }],
      playerHandicaps: { p1: 0, p2: 0 },
      scores: { p1: { 1: 4 }, p2: { 1: 5 } },
    },
  ],
};

describe('SharedBoardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('accepts token via props.token and renders standings from a happy-path payload', async () => {
    supabase.rpc.mockResolvedValue({ data: happyPayload, error: null });

    const { findByText, getByText, getAllByText } = render(wrap(<SharedBoardScreen token="tok-123" />));

    expect(await findByText('Weekend Cup')).toBeTruthy();
    expect(supabase.rpc).toHaveBeenCalledWith('get_shared_board', { p_token: 'tok-123' });

    // LIVE pill for the in-progress round (currentRound: 1 -> round 2).
    expect(getByText('LIVE')).toBeTruthy();

    // Overall standings + per-round section both list each player (one row
    // apiece), so each name appears twice on screen.
    expect(getAllByText('Ann Lee')).toHaveLength(2);
    expect(getAllByText('Bob Ray')).toHaveLength(2);
    expect(getByText('6 pts')).toBeTruthy(); // p1 overall total
    expect(getByText('3 pts')).toBeTruthy(); // p2 overall total

    // Per-round section defaults to the live round (round 2 · Spyglass).
    expect(getByText('Round 2 · Spyglass · LIVE')).toBeTruthy();
  });

  test('reads token from route.params when props.token is absent', async () => {
    supabase.rpc.mockResolvedValue({ data: happyPayload, error: null });

    render(wrap(<SharedBoardScreen route={{ params: { token: 'route-tok' } }} />));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('get_shared_board', { p_token: 'route-tok' });
    });
  });

  test('renders a friendly not-found state when the rpc returns no data (bad/revoked token)', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const { findByText, queryByText } = render(wrap(<SharedBoardScreen token="dead-token" />));

    expect(await findByText("This board link isn't active")).toBeTruthy();
    expect(queryByText('Weekend Cup')).toBeNull();
  });

  test('renders an error state (not the not-found state) on an rpc error with no prior data', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    const { findByText, queryByText } = render(wrap(<SharedBoardScreen token="tok-123" />));

    expect(await findByText("Couldn't load this board")).toBeTruthy();
    expect(queryByText("This board link isn't active")).toBeNull();
  });
});
