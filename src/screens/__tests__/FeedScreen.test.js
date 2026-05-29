import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import FeedScreen from '../FeedScreen';
import { buildFeed } from '../../store/feedStore';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../components/CommentsSheet', () => function MockCommentsSheet() {
  return null;
});

jest.mock('../../components/MemoriesStoriesViewer', () => function MockMemoriesStoriesViewer({
  visible,
  items,
  storyTitle,
  storySubtitle,
}) {
  const { Text, View } = require('react-native');
  return visible ? (
    <View>
      <Text>{`Story viewer ${items.length}`}</Text>
      <Text>{`Story title ${storyTitle}`}</Text>
      <Text>{`Story subtitle ${storySubtitle}`}</Text>
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
  FEED_REACTION_EMOJI: ['🔥'],
  isValidReactionEmoji: jest.fn(() => true),
}));

const navigation = { navigate: jest.fn() };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const result = {
  me: 'u1',
  friends: [],
  partial: false,
  error: false,
  roundStories: [{
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
  }],
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
    results: [
      { playerId: 'p1', name: 'Marcos', points: 38, strokes: 82, holes: 18, isMine: true },
      { playerId: 'p2', name: 'Pablo', points: 34, strokes: 88, holes: 18 },
      { playerId: 'p3', name: 'Luis', points: 31, strokes: 91, holes: 18 },
      { playerId: 'p4', name: 'Javi', points: 29, strokes: 93, holes: 18 },
    ],
  }],
};

describe('FeedScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildFeed.mockResolvedValue(result);
  });

  test('renders round stories rail and opens selected round story', async () => {
    const { findByText, getByLabelText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('La Moraleja')).toBeTruthy();
    fireEvent.press(getByLabelText('Open La Moraleja story, 2 photos'));

    expect(await findByText('Story viewer 2')).toBeTruthy();
    expect(await findByText('Story title La Moraleja')).toBeTruthy();
    expect(await findByText('Story subtitle Weekend Match')).toBeTruthy();
  });

  test('renders top-three result preview and navigates to round summary', async () => {
    const { findByText, getByText, queryByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    const title = await findByText('Marcos and 3 others played La Moraleja');
    expect(title).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
    expect(getByText('Pablo')).toBeTruthy();
    expect(getByText('Luis')).toBeTruthy();
    expect(queryByText('Javi')).toBeNull();
    expect(getByText('+1 more player')).toBeTruthy();

    fireEvent.press(title);
    expect(navigation.navigate).toHaveBeenCalledWith('RoundSummary', {
      tournamentId: 't1',
      roundId: 'r1',
    });
  });
});
