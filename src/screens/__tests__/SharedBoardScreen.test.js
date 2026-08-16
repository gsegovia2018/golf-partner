import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import SharedBoardScreen from '../SharedBoardScreen';
import { supabase } from '../../lib/supabase';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: {
      from: () => ({
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
}));

// MemoriesStoriesViewer pulls in expo-video/expo-image/safe-area-context —
// mocked out the same way FeedScreen.test.js does, since this screen only
// needs to prove it's wired (visible/items/startIndex), not re-test the
// viewer's own playback behavior.
jest.mock('../../components/MemoriesStoriesViewer', () => function MockMemoriesStoriesViewer({
  visible,
  items,
  startIndex,
}) {
  const { Text, View } = require('react-native');
  return visible ? (
    <View>
      <Text>{`Story viewer ${items.length}`}</Text>
      <Text>{`Story start ${startIndex}`}</Text>
    </View>
  ) : null;
});

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// Same shape/fixture as src/store/__tests__/sharedBoard.test.js's "two-round
// tournament: one completed round, one live partial round" case — this
// screen only renders buildSharedBoardModel/buildSharedMediaModel's output,
// so reusing that fixture keeps the two test suites honest about the same
// contract. Points: r1 p1=4/p2=2 (birdie/bogey x2), r2 (live, 1 hole in) p1=2/p2=1
// -> overall p1=6, p2=3.
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

const mediaRows = [
  {
    id: 'm1',
    roundId: 'r1',
    holeIndex: 0,
    kind: 'photo',
    storagePath: 't/r1/m1.jpg',
    thumbPath: 't/r1/thumbs/m1.jpg',
    durationS: null,
    createdAt: '2026-08-14T10:00:00.000Z',
  },
];

function mockRpc(boardResponse, mediaResponse = { data: null, error: null }) {
  supabase.rpc.mockImplementation((name) => {
    if (name === 'get_shared_board') return Promise.resolve(boardResponse);
    if (name === 'get_shared_board_media') return Promise.resolve(mediaResponse);
    return Promise.resolve({ data: null, error: null });
  });
}

describe('SharedBoardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('happy path: renders the hero, podium overall standings, and a FeedRoundCard per round', async () => {
    mockRpc({ data: happyPayload, error: null }, { data: mediaRows, error: null });

    const {
      findByTestId, getByText, getAllByText, getByTestId,
    } = render(wrap(<SharedBoardScreen token="tok-123" />));

    const hero = await findByTestId('shared-board-hero');
    expect(within(hero).getByText('Weekend Cup')).toBeTruthy();
    expect(supabase.rpc).toHaveBeenCalledWith('get_shared_board', { p_token: 'tok-123' });
    expect(supabase.rpc).toHaveBeenCalledWith('get_shared_board_media', { p_token: 'tok-123' });

    // Hero: LIVE pill + gold leader callout (overall leader is Ann Lee, 6 pts).
    // The round-2 FeedRoundCard is also live, so "LIVE" renders twice total.
    expect(getAllByText('LIVE')).toHaveLength(2);
    expect(within(hero).getByText('Ann Lee leads · 6 pts')).toBeTruthy();

    // Overall standings (podium card) — one row per player, totals summed
    // across both rounds including the live one.
    expect(getByText('6 pts')).toBeTruthy();
    expect(getByText('3 pts')).toBeTruthy();

    // One FeedRoundCard per round, newest/live round included. Round 1's
    // label renders twice — once as the FeedRoundCard title, once as the
    // stories rail chip label (media exists only for round 1).
    expect(getAllByText('Round 1 · Pebble Beach')).toHaveLength(2);
    expect(getByText('Round 2 · Spyglass')).toBeTruthy();

    // Stories rail renders because media exists for round 1.
    expect(getByTestId('round-stories-rail')).toBeTruthy();
  });

  test('reads token from route.params when props.token is absent', async () => {
    mockRpc({ data: happyPayload, error: null });

    render(wrap(<SharedBoardScreen route={{ params: { token: 'route-tok' } }} />));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('get_shared_board', { p_token: 'route-tok' });
    });
  });

  test('media RPC failure degrades silently: board still renders, no media UI, no error state', async () => {
    mockRpc(
      { data: happyPayload, error: null },
      { data: null, error: { message: 'function get_shared_board_media does not exist' } },
    );

    const { findByTestId, queryByText, queryByTestId } = render(wrap(<SharedBoardScreen token="tok-123" />));

    const hero = await findByTestId('shared-board-hero');
    expect(within(hero).getByText('Weekend Cup')).toBeTruthy();
    expect(queryByText("Couldn't load this board")).toBeNull();
    expect(queryByTestId('round-stories-rail')).toBeNull();
  });

  test('renders a friendly not-found state when the rpc returns no data (bad/revoked token)', async () => {
    mockRpc({ data: null, error: null });

    const { findByText, queryByText } = render(wrap(<SharedBoardScreen token="dead-token" />));

    expect(await findByText("This board link isn't active")).toBeTruthy();
    expect(queryByText('Weekend Cup')).toBeNull();
  });

  test('renders an error state (not the not-found state) on an rpc error with no prior data', async () => {
    mockRpc({ data: null, error: { message: 'network down' } });

    const { findByText, queryByText } = render(wrap(<SharedBoardScreen token="tok-123" />));

    expect(await findByText("Couldn't load this board")).toBeTruthy();
    expect(queryByText("This board link isn't active")).toBeNull();
  });
});
