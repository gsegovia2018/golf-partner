import { buildRoundStories } from '../feedStore';

const tournament = {
  id: 't1',
  name: 'Weekend Match',
  kind: 'game',
  rounds: [
    { id: 'r1', courseName: 'La Moraleja' },
    { id: 'r2', courseName: 'Santander' },
  ],
};

const media = [
  {
    id: 'm2',
    tournamentId: 't1',
    roundId: 'r1',
    kind: 'photo',
    createdAt: '2026-05-29T10:10:00.000Z',
    uploaderLabel: 'Pablo',
    url: 'https://example.com/m2.jpg',
    thumbUrl: 'https://example.com/m2-thumb.jpg',
  },
  {
    id: 'm1',
    tournamentId: 't1',
    roundId: 'r1',
    kind: 'photo',
    createdAt: '2026-05-29T10:00:00.000Z',
    uploaderLabel: 'Marcos',
    url: 'https://example.com/m1.jpg',
    thumbUrl: 'https://example.com/m1-thumb.jpg',
  },
  {
    id: 'm3',
    tournamentId: 't1',
    roundId: 'r2',
    kind: 'video',
    createdAt: '2026-05-29T11:00:00.000Z',
    uploaderLabel: 'Luis',
    url: 'https://example.com/m3.mp4',
    thumbUrl: 'https://example.com/m3-thumb.jpg',
  },
];

describe('buildRoundStories', () => {
  test('groups media by tournament and round, newest round first', () => {
    const stories = buildRoundStories([tournament], media);

    expect(stories).toHaveLength(2);
    expect(stories[0]).toMatchObject({
      key: 'story:t1:r2',
      tournamentId: 't1',
      roundId: 'r2',
      roundLabel: 'Santander',
      count: 1,
      latestTs: Date.parse('2026-05-29T11:00:00.000Z'),
      uploaderNames: ['Luis'],
    });
    expect(stories[1]).toMatchObject({
      key: 'story:t1:r1',
      roundLabel: 'La Moraleja',
      count: 2,
      uploaderNames: ['Marcos', 'Pablo'],
    });
  });

  test('sorts media oldest-first inside each story for playback', () => {
    const stories = buildRoundStories([tournament], media);
    const moraleja = stories.find((story) => story.roundId === 'r1');

    expect(moraleja.mediaList.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  test('skips media without a real round id', () => {
    const stories = buildRoundStories([tournament], [{
      id: 'm4',
      tournamentId: 't1',
      roundId: null,
      kind: 'photo',
      createdAt: '2026-05-29T12:00:00.000Z',
      uploaderLabel: 'Javi',
      url: 'https://example.com/m4.jpg',
      thumbUrl: 'https://example.com/m4-thumb.jpg',
    }, {
      id: 'm5',
      tournamentId: 't1',
      roundId: 'missing-round',
      kind: 'photo',
      createdAt: '2026-05-29T12:05:00.000Z',
      uploaderLabel: 'Luis',
      url: 'https://example.com/m5.jpg',
      thumbUrl: 'https://example.com/m5-thumb.jpg',
    }]);

    expect(stories).toEqual([]);
  });

  test('limits stories to the requested maximum', () => {
    const manyTournament = {
      ...tournament,
      rounds: Array.from({ length: 14 }, (_, i) => ({
        id: `r-${i}`,
        courseName: `Course ${i}`,
      })),
    };
    const manyMedia = Array.from({ length: 14 }, (_, i) => ({
      id: `m-${i}`,
      tournamentId: 't1',
      roundId: `r-${i}`,
      kind: 'photo',
      createdAt: new Date(Date.UTC(2026, 4, 29, 10, i)).toISOString(),
      uploaderLabel: 'Marcos',
      url: `https://example.com/${i}.jpg`,
      thumbUrl: `https://example.com/${i}-thumb.jpg`,
    }));

    expect(buildRoundStories([manyTournament], manyMedia, { limit: 12 })).toHaveLength(12);
  });
});
