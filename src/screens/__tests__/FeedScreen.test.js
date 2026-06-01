import React from 'react';
import {
  act, fireEvent, render, waitFor,
} from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import FeedScreen from '../FeedScreen';
import { buildFeed, loadCommentCounts, loadReactions } from '../../store/feedStore';
import { notifyFeedActivity } from '../../store/notificationStore';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../components/CommentsSheet', () => function MockCommentsSheet({
  visible,
  itemKey,
  onCommentAdded,
}) {
  const { Text, TouchableOpacity, View } = require('react-native');
  return visible ? (
    <View>
      <Text>{`Mock comments ${itemKey}`}</Text>
      <TouchableOpacity
        accessibilityLabel="Mock post comment"
        onPress={() => onCommentAdded?.(itemKey, { body: 'Great round' })}
      >
        <Text>Post mock comment</Text>
      </TouchableOpacity>
    </View>
  ) : null;
});

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

jest.mock('../../store/tournamentStore', () => ({
  subscribeTournamentChanges: jest.fn(() => () => {}),
  formatRoundLabel: jest.fn(({ courseName, roundIndex }) => courseName || `Round ${roundIndex + 1}`),
}));

jest.mock('../../store/feedStore', () => ({
  buildFeed: jest.fn(),
  loadReactions: jest.fn(() => Promise.resolve({})),
  loadCommentCounts: jest.fn(() => Promise.resolve({})),
  toggleReaction: jest.fn(() => Promise.resolve(true)),
  FEED_REACTION_EMOJI: [],
  isValidReactionEmoji: jest.fn((value) => typeof value === 'string' && value.trim().length > 0),
}));

jest.mock('../../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ user: { id: 'u1' } })),
}));

jest.mock('../../store/notificationStore', () => ({
  notifyFeedActivity: jest.fn(() => Promise.resolve(true)),
}));

const navigation = { navigate: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const result = {
  me: 'u1',
  friends: [],
  partial: false,
  error: false,
  roundStories: [
    {
      key: 'story:t1:r1',
      tournamentId: 't1',
      tournamentName: 'Weekend Match',
      roundId: 'r1',
      roundLabel: 'La Moraleja',
      countLabel: '2 photos',
      viewed: false,
      mediaList: [
        { id: 'm1', url: 'https://example.com/1.jpg', thumbUrl: 'https://example.com/1t.jpg' },
        { id: 'm2', url: 'https://example.com/2.jpg', thumbUrl: 'https://example.com/2t.jpg' },
      ],
    },
    {
      key: 'story:t1:r2',
      tournamentId: 't1',
      tournamentName: 'Weekend Match',
      roundId: 'r2',
      roundLabel: 'Santander',
      countLabel: '1 photo',
      viewed: false,
      mediaList: [
        { id: 'm3', url: 'https://example.com/3.jpg', thumbUrl: 'https://example.com/3t.jpg' },
      ],
    },
  ],
  items: [{
    type: 'round',
    key: 'round:t1:r1',
    ts: Date.now(),
    isMine: true,
    withMe: true,
    actorName: 'Marcos',
    tournamentId: 't1',
    tournamentName: 'Weekend Match',
    tournamentKind: 'game',
    roundId: 'r1',
    roundIndex: 0,
    courseName: 'La Moraleja',
    playerCount: 4,
    mediaCount: 2,
    mediaCountLabel: '2 photos',
    mediaId: 'm2',
    mediaCoverUrl: 'https://example.com/2t.jpg',
    mediaList: [
      { id: 'm1', url: 'https://example.com/1.jpg', thumbUrl: 'https://example.com/1t.jpg' },
      { id: 'm2', url: 'https://example.com/2.jpg', thumbUrl: 'https://example.com/2t.jpg' },
    ],
    results: [
      { playerId: 'p1', name: 'Marcos', points: 38, strokes: 82, holes: 18, isMine: true },
      { playerId: 'p2', name: 'Pablo', points: 34, strokes: 88, holes: 18 },
      { playerId: 'p3', name: 'Luis', points: 31, strokes: 91, holes: 18 },
    ],
  }],
};

describe('FeedScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildFeed.mockResolvedValue(result);
  });

  test('renders cached base feed before remote media hydration completes', async () => {
    let resolveRemote;
    const cachedResult = {
      ...result,
      roundStories: [],
      items: [{
        ...result.items[0],
        key: 'round:cached-t1:r1',
        tournamentId: 'cached-t1',
        tournamentName: 'Cached Match',
        mediaCount: undefined,
        mediaCountLabel: undefined,
        mediaCoverUrl: null,
        mediaList: undefined,
      }],
    };
    const remoteResult = {
      ...result,
      items: [{
        ...result.items[0],
        key: 'round:remote-t1:r1',
        tournamentId: 'remote-t1',
        tournamentName: 'Remote Match',
      }],
    };

    buildFeed
      .mockResolvedValueOnce(cachedResult)
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRemote = () => resolve(remoteResult);
      }));

    const { findByText, queryByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('Cached Match')).toBeTruthy();
    expect(queryByText('Remote Match')).toBeNull();

    resolveRemote();
    expect(await findByText('Remote Match')).toBeTruthy();
    expect(buildFeed).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: 'u1',
      source: 'cache',
      includeMedia: false,
      limit: 30,
    }));
    expect(buildFeed).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userId: 'u1',
      source: 'remote',
      includeMedia: true,
    }));
    expect(buildFeed.mock.calls[1][0]).not.toHaveProperty('limit');
  });

  test('keeps remote overlay results when slower cached overlays finish later', async () => {
    let resolveCachedReactions;
    let resolveRemoteReactions;
    let resolveCachedComments;
    let resolveRemoteComments;
    const cachedKey = 'round:cached-t1:r1';
    const remoteKey = 'round:remote-t1:r1';
    const cachedResult = {
      ...result,
      roundStories: [],
      items: [{
        ...result.items[0],
        key: cachedKey,
        tournamentId: 'cached-t1',
        tournamentName: 'Cached Match',
        mediaCount: undefined,
        mediaCountLabel: undefined,
        mediaCoverUrl: null,
        mediaList: undefined,
      }],
    };
    const remoteResult = {
      ...result,
      items: [{
        ...result.items[0],
        key: remoteKey,
        tournamentId: 'remote-t1',
        tournamentName: 'Remote Match',
      }],
    };

    buildFeed
      .mockResolvedValueOnce(cachedResult)
      .mockResolvedValueOnce(remoteResult);
    loadReactions
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveCachedReactions = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRemoteReactions = resolve;
      }));
    loadCommentCounts
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveCachedComments = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRemoteComments = resolve;
      }));

    const { findByText, queryByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('Remote Match')).toBeTruthy();

    await act(async () => {
      resolveRemoteReactions({ [remoteKey]: { counts: { '🔥': 1 }, mine: [] } });
      resolveRemoteComments({ [remoteKey]: 2 });
    });

    expect(await findByText('🔥')).toBeTruthy();

    await act(async () => {
      resolveCachedReactions({ [cachedKey]: { counts: { '💤': 1 }, mine: [] } });
      resolveCachedComments({ [cachedKey]: 7 });
    });

    await waitFor(() => {
      expect(queryByText('🔥')).toBeTruthy();
      expect(queryByText('💤')).toBeNull();
    });
  });

  test('preserves cached feed when remote hydration returns an error result', async () => {
    let resolveRemote;
    const cachedResult = {
      ...result,
      roundStories: [],
      items: [{
        ...result.items[0],
        tournamentId: 'cached-t1',
        tournamentName: 'Cached Match',
        mediaCount: undefined,
        mediaCountLabel: undefined,
        mediaCoverUrl: null,
        mediaList: undefined,
      }],
    };
    const remoteErrorResult = {
      ...result,
      error: true,
      partial: false,
      items: [],
      roundStories: [],
    };

    buildFeed
      .mockResolvedValueOnce(cachedResult)
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRemote = () => resolve(remoteErrorResult);
      }));

    const { findByText, queryByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('Cached Match')).toBeTruthy();

    resolveRemote();

    expect(await findByText('Cached Match')).toBeTruthy();
    await waitFor(() => expect(queryByText('Could not load your feed')).toBeNull());
  });

  test('keeps error empty state on retry when no feed content is visible', async () => {
    const emptyCacheResult = {
      ...result,
      items: [],
      roundStories: [],
    };
    const remoteErrorResult = {
      ...result,
      error: true,
      partial: false,
      items: [],
      roundStories: [],
    };

    buildFeed
      .mockResolvedValueOnce(emptyCacheResult)
      .mockResolvedValueOnce(remoteErrorResult)
      .mockResolvedValueOnce(remoteErrorResult);

    const { findByText, getByText, queryByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('Could not load your feed')).toBeTruthy();

    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(buildFeed).toHaveBeenCalledTimes(3));
    expect(await findByText('Could not load your feed')).toBeTruthy();
    expect(queryByText('Your feed is quiet')).toBeNull();
  });

  test('renders round stories rail and opens the selected story inside the full story sequence', async () => {
    const { findByLabelText, findByText, getByLabelText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByLabelText('Open La Moraleja story, 2 photos')).toBeTruthy();
    expect(await findByText('Santander')).toBeTruthy();

    fireEvent.press(getByLabelText('Open Santander story, 1 photo'));

    expect(await findByText('Story viewer 3')).toBeTruthy();
    expect(await findByText('Story start 2')).toBeTruthy();
  });

  test('renders top-three result preview and navigates to round summary', async () => {
    const {
      findAllByText, getAllByText, getByLabelText, getByText, queryByText,
    } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    const titleMatches = await findAllByText('La Moraleja');
    const title = titleMatches[titleMatches.length - 1];
    expect(title).toBeTruthy();
    expect(getByText('Marcos led by 4 with 38 pts')).toBeTruthy();
    expect(getByText('Your round')).toBeTruthy();
    expect(getByText('4 players')).toBeTruthy();
    expect(getAllByText('2 photos').length).toBeGreaterThan(0);
    expect(getByLabelText('Open round photo 1 of 2')).toBeTruthy();
    expect(getByLabelText('Open round photo 2 of 2')).toBeTruthy();
    expect(getByText('React')).toBeTruthy();
    expect(queryByText('🔥')).toBeNull();
    expect(getByText('38')).toBeTruthy();
    expect(getByText('82 str')).toBeTruthy();
    expect(getByText('Pablo')).toBeTruthy();
    expect(getByText('Luis')).toBeTruthy();
    expect(queryByText('Javi')).toBeNull();
    expect(getByText('+1 more player')).toBeTruthy();
    expect(queryByText('All')).toBeNull();
    expect(queryByText('Mine')).toBeNull();
    await waitFor(() => expect(queryByText('Friends')).toBeNull());

    fireEvent.press(getByLabelText('Open round photo 2 of 2'));
    expect(navigation.navigate).toHaveBeenCalledWith('Gallery', {
      tournamentId: 't1',
      mediaId: 'm2',
    });

    fireEvent.press(title);
    expect(navigation.navigate).toHaveBeenCalledWith('RoundSummary', {
      tournamentId: 't1',
      roundId: 'r1',
    });
  });

  test('uses solo-round copy and still shows muted strokes next to points', async () => {
    buildFeed.mockResolvedValue({
      ...result,
      roundStories: [],
      items: [{
        ...result.items[0],
        mediaCount: 0,
        mediaCountLabel: null,
        mediaCoverUrl: null,
        mediaList: [],
        playerCount: 1,
        results: [
          { playerId: 'p1', name: 'You', points: 22, strokes: 79, holes: 18, isMine: true },
        ],
      }],
    });
    const { findByText, queryByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('You scored 22 pts')).toBeTruthy();
    expect(await findByText('79 str')).toBeTruthy();
    expect(queryByText(/led by/i)).toBeNull();
    expect(queryByText(/led with/i)).toBeNull();
  });

  test('allows any typed emoji reaction and notifies round friends', async () => {
    const { findByLabelText, getByLabelText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    fireEvent.press(await findByLabelText('React with any emoji'));
    fireEvent.changeText(getByLabelText('Emoji reaction'), '😎');
    fireEvent.press(getByLabelText('Send reaction'));

    await waitFor(() => expect(notifyFeedActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feed_reaction',
      tournamentId: 't1',
      roundId: 'r1',
      itemKey: 'round:t1:r1',
      emoji: '😎',
    })));
  });

  test('notifies round friends when a comment is added', async () => {
    const { findByLabelText, findByText, getByLabelText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    fireEvent.press(await findByLabelText('Comments'));
    expect(await findByText('Mock comments round:t1:r1')).toBeTruthy();
    fireEvent.press(getByLabelText('Mock post comment'));

    expect(notifyFeedActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feed_comment',
      tournamentId: 't1',
      roundId: 'r1',
      itemKey: 'round:t1:r1',
      commentBody: 'Great round',
    }));
  });
});
