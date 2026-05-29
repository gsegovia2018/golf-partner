import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundStoriesRail from '../RoundStoriesRail';

const stories = [
  {
    key: 'story:t1:r1',
    roundLabel: 'La Moraleja',
    countLabel: '7 photos',
    mediaList: [
      { id: 'm1', thumbUrl: 'https://example.com/m1.jpg', url: 'https://example.com/m1.jpg' },
    ],
    latestTs: 1779960000000,
    viewed: false,
  },
  {
    key: 'story:t1:r2',
    roundLabel: 'Santander',
    countLabel: 'seen',
    mediaList: [
      { id: 'm2', thumbUrl: 'https://example.com/m2.jpg', url: 'https://example.com/m2.jpg' },
    ],
    latestTs: 1779960300000,
    viewed: true,
  },
];

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundStoriesRail', () => {
  test('renders nothing when no stories exist', async () => {
    const { toJSON } = render(wrap(<RoundStoriesRail stories={[]} onPressStory={() => {}} />));
    await waitFor(() => expect(toJSON()).toBeNull());
  });

  test('renders round story labels and counts', async () => {
    const { getByText, getByTestId } = render(wrap(
      <RoundStoriesRail stories={stories} onPressStory={() => {}} />,
    ));

    await waitFor(() => expect(getByTestId('round-stories-rail')).toBeTruthy());
    expect(getByText('La Moraleja')).toBeTruthy();
    expect(getByText('7 photos')).toBeTruthy();
    expect(getByText('Santander')).toBeTruthy();
    expect(getByText('seen')).toBeTruthy();
  });

  test('renders as a horizontal rail without a scroll indicator', async () => {
    const { getByTestId } = render(wrap(
      <RoundStoriesRail stories={stories} onPressStory={() => {}} />,
    ));

    const rail = await waitFor(() => getByTestId('round-stories-rail'));
    expect(rail.props.horizontal).toBe(true);
    expect(rail.props.showsHorizontalScrollIndicator).toBe(false);
  });

  test('applies viewed ring style to viewed stories', async () => {
    const { getByTestId } = render(wrap(
      <RoundStoriesRail stories={stories} onPressStory={() => {}} />,
    ));

    const activeRing = await waitFor(() => getByTestId('round-story-ring-story:t1:r1'));
    const viewedRing = getByTestId('round-story-ring-story:t1:r2');

    expect(StyleSheet.flatten(viewedRing.props.style).borderColor)
      .not.toBe(StyleSheet.flatten(activeRing.props.style).borderColor);
  });

  test('uses the first media item with a thumbnail or url as the cover', async () => {
    const coverStories = [
      {
        ...stories[0],
        mediaList: [
          { id: 'm-without-cover' },
          { id: 'm-thumb', thumbUrl: 'https://example.com/thumb.jpg' },
          { id: 'm-url', url: 'https://example.com/full.jpg' },
        ],
      },
    ];
    const { getByTestId } = render(wrap(
      <RoundStoriesRail stories={coverStories} onPressStory={() => {}} />,
    ));

    const cover = await waitFor(() => getByTestId('round-story-cover-story:t1:r1'));
    expect(cover.props.source.uri).toBe('https://example.com/thumb.jpg');
  });

  test('renders fallback initials from the round label when no cover exists', async () => {
    const fallbackStories = [
      {
        ...stories[0],
        mediaList: [{ id: 'm-no-cover' }],
      },
    ];
    const { getByText } = render(wrap(
      <RoundStoriesRail stories={fallbackStories} onPressStory={() => {}} />,
    ));

    await waitFor(() => expect(getByText('LM')).toBeTruthy());
  });

  test('calls onPressStory with the selected story', async () => {
    const onPressStory = jest.fn();
    const { getByLabelText } = render(wrap(
      <RoundStoriesRail stories={stories} onPressStory={onPressStory} />,
    ));

    await waitFor(() => expect(getByLabelText('Open La Moraleja story, 7 photos')).toBeTruthy());
    fireEvent.press(getByLabelText('Open La Moraleja story, 7 photos'));

    expect(onPressStory).toHaveBeenCalledWith(stories[0]);
  });
});
