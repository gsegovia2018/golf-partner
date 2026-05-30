import { photoPrefetchUrls, storySwipeAction } from '../MemoriesStoriesViewer';

jest.mock('expo-image', () => ({
  Image: jest.fn(() => null),
}));

jest.mock('expo-video', () => ({
  VideoView: jest.fn(() => null),
  useVideoPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: jest.fn(() => null),
}));

describe('MemoriesStoriesViewer helpers', () => {
  test('maps right-to-left swipes to next story navigation', () => {
    expect(storySwipeAction({ dx: -80, dy: 0 })).toBe('next');
  });

  test('maps left-to-right swipes to previous story navigation', () => {
    expect(storySwipeAction({ dx: 80, dy: 0 })).toBe('previous');
  });

  test('ignores short and mostly vertical gestures for story navigation', () => {
    expect(storySwipeAction({ dx: -20, dy: 0 })).toBeNull();
    expect(storySwipeAction({ dx: -80, dy: 90 })).toBeNull();
  });

  test('selects previous, current, and next photo urls for prefetching', () => {
    const items = [
      { id: 'm1', kind: 'photo', url: 'https://example.com/1.jpg' },
      { id: 'm2', kind: 'photo', url: 'https://example.com/2.jpg' },
      { id: 'm3', kind: 'photo', url: 'https://example.com/3.jpg' },
    ];

    expect(photoPrefetchUrls(items, 1)).toEqual([
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
    ]);
  });

  test('dedupes photo urls and skips videos when selecting prefetch urls', () => {
    const items = [
      { id: 'm1', kind: 'photo', url: 'https://example.com/1.jpg' },
      { id: 'm2', kind: 'video', url: 'https://example.com/2.mp4' },
      { id: 'm3', kind: 'photo', url: 'https://example.com/1.jpg' },
    ];

    expect(photoPrefetchUrls(items, 1)).toEqual([
      'https://example.com/1.jpg',
    ]);
  });
});
