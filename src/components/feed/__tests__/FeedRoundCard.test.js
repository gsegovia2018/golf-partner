import React from 'react';
import { Image } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import FeedRoundCard from '../FeedRoundCard';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

function makeRoundItem(media) {
  return {
    type: 'round',
    key: 'round:t1:r1',
    isMine: true,
    withMe: true,
    actorName: 'Marcos',
    tournamentId: 't1',
    tournamentName: 'Weekend Match',
    roundId: 'r1',
    roundIndex: 0,
    courseName: 'Lomas-Bosque',
    playerCount: 1,
    mediaCount: 1,
    mediaCountLabel: media.kind === 'video' ? '1 memory' : '1 photo',
    mediaId: media.id,
    mediaCoverUrl: media.thumbUrl,
    mediaUrl: media.url,
    mediaHasVideo: media.kind === 'video',
    mediaList: [media],
    results: [
      { playerId: 'p1', name: 'Marcos', points: 38, strokes: 82, holes: 18, isMine: true },
    ],
  };
}

describe('FeedRoundCard', () => {
  test('shows video thumbnails without cropping the frame', async () => {
    const video = {
      id: 'video-1',
      kind: 'video',
      url: 'https://example.com/video.mp4',
      thumbUrl: 'https://example.com/video.jpg',
    };
    const { UNSAFE_getAllByType } = render(wrap(
      <FeedRoundCard
        item={makeRoundItem(video)}
        timestamp="Today"
        onPress={() => {}}
        onPressMedia={() => {}}
      />
    ));

    const mediaImage = UNSAFE_getAllByType(Image).find(
      (node) => node.props.source?.uri === video.thumbUrl
    );

    await waitFor(() => expect(mediaImage.props.resizeMode).toBe('contain'));
  });

  test('renders every player tile for a four-player round without an overflow note', () => {
    const item = {
      type: 'round',
      key: 'round:t1:r2',
      tournamentId: 't1',
      tournamentName: 'Weekend Match',
      roundId: 'r2',
      playerCount: 4,
      results: [
        { playerId: 'p1', name: 'Marcos', points: 38, strokes: 82, holes: 18, isMine: true },
        { playerId: 'p2', name: 'Pablo', points: 34, strokes: 88, holes: 18 },
        { playerId: 'p3', name: 'Luis', points: 31, strokes: 91, holes: 18 },
        { playerId: 'p4', name: 'Javi', points: 29, strokes: 94, holes: 18 },
      ],
    };
    const { getByText, queryByText } = render(wrap(
      <FeedRoundCard item={item} timestamp="Today" onPress={() => {}} />
    ));

    expect(getByText('Marcos')).toBeTruthy();
    expect(getByText('Pablo')).toBeTruthy();
    expect(getByText('Luis')).toBeTruthy();
    expect(getByText('Javi')).toBeTruthy();
    expect(queryByText(/more player/)).toBeNull();
  });
});
