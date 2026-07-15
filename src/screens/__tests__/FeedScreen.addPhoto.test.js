import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import FeedScreen from '../FeedScreen';
import { buildFeed } from '../../store/feedStore';
import { getTournament } from '../../store/tournamentStore';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../components/CommentsSheet', () => () => null);
jest.mock('../../components/MemoriesStoriesViewer', () => () => null);

jest.mock('../../store/tournamentStore', () => ({
  subscribeTournamentChanges: jest.fn(() => () => {}),
  formatRoundLabel: jest.fn(({ courseName, roundIndex }) => courseName || `Round ${roundIndex + 1}`),
  getTournament: jest.fn(),
}));

jest.mock('../../store/feedStore', () => ({
  buildFeed: jest.fn(),
  loadReactions: jest.fn(() => Promise.resolve({})),
  loadCommentCounts: jest.fn(() => Promise.resolve({})),
  toggleReaction: jest.fn(() => Promise.resolve(true)),
  invalidateFeedCache: jest.fn(),
  isValidReactionEmoji: jest.fn(() => false),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ user: { id: 'u1' } })),
}));
jest.mock('../../store/notificationStore', () => ({
  notifyFeedActivity: jest.fn(() => Promise.resolve(true)),
}));

const mockOpenCaptureMenu = jest.fn();
jest.mock('../../hooks/useMediaAttachFlow', () => ({
  __esModule: true,
  default: jest.fn(() => ({ openCaptureMenu: mockOpenCaptureMenu, sheets: null })),
}));

const feedItem = (overrides) => ({
  key: `round:t1:${overrides.roundId ?? 'r1'}`,
  tournamentId: 't1',
  roundId: 'r1',
  roundIndex: 0,
  tournamentKind: 'tournament',
  courseName: 'Poniente',
  results: [],
  ts: Date.now(),
  ...overrides,
});

const renderFeed = async (items) => {
  buildFeed.mockResolvedValue({ items, roundStories: [], hasMore: false });
  const utils = render(
    <ThemeProvider>
      <FeedScreen navigation={{ navigate: jest.fn() }} />
    </ThemeProvider>
  );
  await waitFor(() => expect(buildFeed).toHaveBeenCalled());
  await act(async () => {});
  return utils;
};

describe('FeedScreen add photo', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows the Add photo chip only on own rounds', async () => {
    const { queryAllByLabelText } = await renderFeed([
      feedItem({ roundId: 'r1', withMe: true }),
      feedItem({ roundId: 'r2', key: 'round:t1:r2', withMe: false, isMine: false }),
    ]);
    expect(queryAllByLabelText('Add photo')).toHaveLength(1);
  });

  test('tapping the chip loads the tournament and opens the capture menu', async () => {
    getTournament.mockResolvedValue({ id: 't1', rounds: [{ id: 'r1', holes: [] }] });
    const { getByLabelText } = await renderFeed([feedItem({ withMe: true })]);
    await act(async () => {
      fireEvent.press(getByLabelText('Add photo'));
    });
    expect(getTournament).toHaveBeenCalledWith('t1');
    expect(mockOpenCaptureMenu).toHaveBeenCalled();
  });
});
