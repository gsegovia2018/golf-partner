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
});
