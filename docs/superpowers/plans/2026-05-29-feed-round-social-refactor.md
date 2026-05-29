# Feed Round Social Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the feed into a mature clubhouse-style social feed with round-based photo stories and refactor finished-round drill-in views so the full scorecard is immediately easy to inspect.

**Architecture:** Keep domain shaping in store/helper modules and keep screens mostly orchestration. Add pure helpers for round story grouping and finished-round scorecard row preparation, then extract focused UI components for the rail, round feed cards, recap panel, tabs, and front/back scorecard tables.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, Jest with `@testing-library/react-native`, Supabase-backed store modules, existing theme tokens and `MemoriesStoriesViewer`.

---

## File Structure

- Modify `src/store/feedStore.js`: return `roundStories` from `buildFeed()` and export pure helpers for story grouping.
- Create `src/store/__tests__/feedStore.roundStories.test.js`: unit coverage for round story grouping and sorting.
- Create `src/components/feed/RoundStoriesRail.js`: horizontal story rail with round story rings.
- Create `src/components/feed/FeedRoundCard.js`: mature round activity card with top-three leaderboard preview.
- Create `src/components/feed/__tests__/RoundStoriesRail.test.js`: rail rendering and press behavior.
- Modify `src/components/MemoriesStoriesViewer.js`: add round-scoped header props while preserving gallery behavior.
- Modify `src/screens/FeedScreen.js`: render round stories, use extracted `FeedRoundCard`, open story viewer with selected round media.
- Create `src/screens/__tests__/FeedScreen.test.js`: screen-level integration for rail, story viewer launch, and round card navigation.
- Create `src/screens/roundSummaryModel.js`: pure helpers for recap metrics and front/back scorecard table rows.
- Create `src/screens/__tests__/roundSummaryModel.test.js`: helper coverage for scorecard splitting, early-finished rounds, and recap metrics.
- Create `src/components/roundSummary/RoundRecapPanel.js`: compact recap component.
- Create `src/components/roundSummary/RoundSummaryTabs.js`: local tab bar component.
- Create `src/components/roundSummary/RoundScorecardTables.js`: front/back scorecard tables.
- Create `src/components/roundSummary/__tests__/RoundScorecardTables.test.js`: UI coverage for front/back tables.
- Modify `src/screens/RoundSummaryScreen.js`: use extracted components, default to Scorecard tab, keep existing data load and `Open in scorecard` behavior.
- Create `src/screens/__tests__/RoundSummaryScreen.test.js`: screen coverage for default scorecard view and tab switching.

## Scope Guardrails

- Do not add a weekly summary card.
- Do not implement user-based stories.
- Do not add compare-player mode, key-hole automation, or player detail drawers in v1.
- Do not change Stableford scoring logic.
- Do not sync story viewed/unviewed state to Supabase.

### Task 1: Round Story Data Helpers

**Files:**
- Modify: `src/store/feedStore.js`
- Create: `src/store/__tests__/feedStore.roundStories.test.js`

- [ ] **Step 1: Write failing tests for round story grouping**

Create `src/store/__tests__/feedStore.roundStories.test.js`:

```js
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

  test('uses tournament-level fallback label for media without a round id', () => {
    const stories = buildRoundStories([tournament], [{
      id: 'm4',
      tournamentId: 't1',
      roundId: null,
      kind: 'photo',
      createdAt: '2026-05-29T12:00:00.000Z',
      uploaderLabel: 'Javi',
      url: 'https://example.com/m4.jpg',
      thumbUrl: 'https://example.com/m4-thumb.jpg',
    }]);

    expect(stories[0]).toMatchObject({
      key: 'story:t1:none',
      roundId: null,
      roundLabel: 'Weekend Match',
      count: 1,
    });
  });

  test('limits stories to the requested maximum', () => {
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

    expect(buildRoundStories([tournament], manyMedia, { limit: 12 })).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run the failing story helper tests**

Run: `npx jest src/store/__tests__/feedStore.roundStories.test.js --runInBand`

Expected: FAIL with an error containing `buildRoundStories is not a function`.

- [ ] **Step 3: Implement `buildRoundStories` and return it from `buildFeed()`**

In `src/store/feedStore.js`, add the helper near the existing photo grouping code:

```js
const ROUND_STORY_LIMIT = 12;

function mediaTs(media) {
  return Date.parse(media?.createdAt) || 0;
}

function mediaCountLabel(count, hasVideo) {
  if (count === 1) return hasVideo ? '1 memory' : '1 photo';
  return hasVideo ? `${count} memories` : `${count} photos`;
}

function roundLabelForStory(tournament, roundId) {
  const rounds = tournament?.rounds ?? [];
  const index = rounds.findIndex((r) => r.id === roundId);
  const round = index >= 0 ? rounds[index] : null;
  return {
    round,
    roundIndex: index,
    roundLabel: round?.courseName
      || (index >= 0 ? formatRoundLabel({
        kind: tournament?.kind,
        courseName: round?.courseName,
        roundIndex: index,
      }) : tournament?.name || 'Tournament photos'),
  };
}

export function buildRoundStories(tournaments, media, options = {}) {
  const limit = options.limit ?? ROUND_STORY_LIMIT;
  const tournamentById = new Map((tournaments ?? []).map((t) => [t.id, t]));
  const groups = new Map();

  for (const item of media ?? []) {
    if (!item?.tournamentId) continue;
    const tournament = tournamentById.get(item.tournamentId);
    if (!tournament) continue;
    const groupKey = `${item.tournamentId}:${item.roundId ?? 'none'}`;
    let group = groups.get(groupKey);
    if (!group) {
      const { round, roundIndex, roundLabel } = roundLabelForStory(tournament, item.roundId ?? null);
      group = {
        key: `story:${item.tournamentId}:${item.roundId ?? 'none'}`,
        tournamentId: item.tournamentId,
        tournamentName: tournament.name,
        roundId: item.roundId ?? null,
        roundIndex,
        roundLabel,
        courseName: round?.courseName ?? null,
        latestTs: 0,
        mediaList: [],
        count: 0,
        uploaderNames: [],
        hasVideo: false,
      };
      groups.set(groupKey, group);
    }
    group.mediaList.push(item);
    group.latestTs = Math.max(group.latestTs, mediaTs(item));
    group.hasVideo = group.hasVideo || item.kind === 'video';
    const name = (item.uploaderLabel ?? '').trim();
    if (name && !group.uploaderNames.includes(name)) group.uploaderNames.push(name);
  }

  return [...groups.values()]
    .map((group) => {
      const mediaList = group.mediaList.slice().sort((a, b) => mediaTs(a) - mediaTs(b));
      return {
        ...group,
        mediaList,
        count: mediaList.length,
        countLabel: mediaCountLabel(mediaList.length, group.hasVideo),
      };
    })
    .filter((group) => group.count > 0)
    .sort((a, b) => b.latestTs - a.latestTs)
    .slice(0, limit);
}
```

Then in `buildFeed()`, after `media` is loaded and `all` is known, compute:

```js
const roundStories = buildRoundStories(all, media);
```

Update every return shape in `buildFeed()`:

```js
return { me, friends, items, roundStories, partial, error: false };
```

For hard error returns before media is loaded, return an empty story list:

```js
return { me, friends, items: [], roundStories: [], partial: false, error: true };
```

- [ ] **Step 4: Run story helper tests**

Run: `npx jest src/store/__tests__/feedStore.roundStories.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Run existing feed-adjacent store tests**

Run: `npx jest src/store/__tests__/mediaQueue.test.js src/store/__tests__/tournamentStore.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/store/feedStore.js src/store/__tests__/feedStore.roundStories.test.js
git commit -m "feat: add round story feed data"
```

### Task 2: Round Stories Rail Component

**Files:**
- Create: `src/components/feed/RoundStoriesRail.js`
- Create: `src/components/feed/__tests__/RoundStoriesRail.test.js`

- [ ] **Step 1: Write failing component tests**

Create `src/components/feed/__tests__/RoundStoriesRail.test.js`:

```js
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
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
  test('renders nothing when no stories exist', () => {
    const { toJSON } = render(wrap(<RoundStoriesRail stories={[]} onPressStory={() => {}} />));
    expect(toJSON()).toBeNull();
  });

  test('renders round story labels and counts', () => {
    const { getByText, getByTestId } = render(wrap(
      <RoundStoriesRail stories={stories} onPressStory={() => {}} />
    ));

    expect(getByTestId('round-stories-rail')).toBeTruthy();
    expect(getByText('La Moraleja')).toBeTruthy();
    expect(getByText('7 photos')).toBeTruthy();
    expect(getByText('Santander')).toBeTruthy();
    expect(getByText('seen')).toBeTruthy();
  });

  test('calls onPressStory with the selected story', () => {
    const onPressStory = jest.fn();
    const { getByLabelText } = render(wrap(
      <RoundStoriesRail stories={stories} onPressStory={onPressStory} />
    ));

    fireEvent.press(getByLabelText('Open La Moraleja story, 7 photos'));

    expect(onPressStory).toHaveBeenCalledWith(stories[0]);
  });
});
```

- [ ] **Step 2: Run the failing rail tests**

Run: `npx jest src/components/feed/__tests__/RoundStoriesRail.test.js --runInBand`

Expected: FAIL with `Cannot find module '../RoundStoriesRail'`.

- [ ] **Step 3: Implement `RoundStoriesRail`**

Create `src/components/feed/RoundStoriesRail.js`:

```js
import React from 'react';
import {
  Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function coverForStory(story) {
  return story?.mediaList?.find((m) => m.thumbUrl || m.url) ?? null;
}

export default function RoundStoriesRail({ stories = [], onPressStory }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  if (!stories.length) return null;

  return (
    <ScrollView
      testID="round-stories-rail"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.rail}
    >
      {stories.map((story) => {
        const cover = coverForStory(story);
        const countLabel = story.viewed ? 'seen' : story.countLabel;
        return (
          <TouchableOpacity
            key={story.key}
            style={s.item}
            onPress={() => onPressStory?.(story)}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel={`Open ${story.roundLabel} story, ${countLabel}`}
          >
            <View style={[s.ring, story.viewed && s.ringViewed]}>
              <View style={s.thumbWrap}>
                {cover ? (
                  <Image
                    source={{ uri: cover.thumbUrl || cover.url }}
                    style={s.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={s.fallbackText}>{(story.roundLabel || '?').slice(0, 2).toUpperCase()}</Text>
                )}
              </View>
            </View>
            <Text style={s.label} numberOfLines={1}>{story.roundLabel}</Text>
            <Text style={s.count} numberOfLines={1}>{countLabel}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    rail: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 10,
    },
    item: {
      width: 76,
      alignItems: 'center',
    },
    ring: {
      width: 62,
      height: 62,
      borderRadius: 31,
      borderWidth: 2,
      borderColor: theme.accent.primary,
      padding: 3,
      backgroundColor: theme.bg.primary,
      marginBottom: 6,
    },
    ringViewed: {
      borderColor: theme.border.default,
    },
    thumbWrap: {
      flex: 1,
      borderRadius: 27,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.bg.secondary,
      borderWidth: 2,
      borderColor: theme.bg.card,
    },
    thumb: {
      width: '100%',
      height: '100%',
    },
    fallbackText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.accent.primary,
      fontSize: 12,
    },
    label: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 10,
      maxWidth: 72,
    },
    count: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 9,
      marginTop: 1,
      maxWidth: 72,
    },
  });
}
```

- [ ] **Step 4: Run rail tests**

Run: `npx jest src/components/feed/__tests__/RoundStoriesRail.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/components/feed/RoundStoriesRail.js src/components/feed/__tests__/RoundStoriesRail.test.js
git commit -m "feat: add round stories rail"
```

### Task 3: Feed Screen Integration

**Files:**
- Create: `src/components/feed/FeedRoundCard.js`
- Modify: `src/screens/FeedScreen.js`
- Create: `src/screens/__tests__/FeedScreen.test.js`

- [ ] **Step 1: Write failing feed screen tests**

Create `src/screens/__tests__/FeedScreen.test.js`:

```js
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import FeedScreen from '../FeedScreen';
import { buildFeed } from '../../store/feedStore';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => cb(),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../components/CommentsSheet', () => function MockCommentsSheet() {
  return null;
});

jest.mock('../../components/MemoriesStoriesViewer', () => function MockMemoriesStoriesViewer({ visible, items }) {
  return visible ? <Text>{`Story viewer ${items.length}`}</Text> : null;
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
  });

  test('renders top-three result preview and navigates to round summary', async () => {
    const { findByText, getByText } = render(wrap(
      <FeedScreen navigation={navigation} />
    ));

    expect(await findByText('Marcos and 3 others played La Moraleja')).toBeTruthy();
    expect(getByText('38')).toBeTruthy();
    expect(getByText('Pablo')).toBeTruthy();
    expect(getByText('Luis')).toBeTruthy();
    expect(() => getByText('Javi')).toThrow();

    fireEvent.press(getByText('Marcos and 3 others played La Moraleja'));

    expect(navigation.navigate).toHaveBeenCalledWith('RoundSummary', {
      tournamentId: 't1',
      roundId: 'r1',
    });
  });
});
```

- [ ] **Step 2: Run failing feed screen tests**

Run: `npx jest src/screens/__tests__/FeedScreen.test.js --runInBand`

Expected: FAIL because `RoundStoriesRail` is not rendered by `FeedScreen` and `FeedRoundCard` does not exist.

- [ ] **Step 3: Implement `FeedRoundCard`**

Create `src/components/feed/FeedRoundCard.js`:

```js
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { formatRoundLabel } from '../../store/tournamentStore';

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function Avatar({ item, theme, small = false }) {
  return (
    <View style={[
      small ? styles(theme).avatarSmall : styles(theme).avatar,
      { backgroundColor: item.actorAvatarColor || item.avatarColor || theme.accent.primary },
    ]}>
      <Text style={small ? styles(theme).avatarSmallText : styles(theme).avatarText}>
        {initials(item.actorName || item.name)}
      </Text>
    </View>
  );
}

export default function FeedRoundCard({
  item,
  now,
  timeAgo,
  onPress,
  children,
}) {
  const { theme } = useTheme();
  const s = styles(theme);
  const results = item.results ?? [];
  const topResults = results.slice(0, 3);
  const roundLabel = formatRoundLabel({
    kind: item.tournamentKind,
    courseName: item.courseName,
    roundIndex: item.roundIndex,
  });
  const otherCount = Math.max(0, results.length - 1);
  const title = otherCount > 0
    ? `${item.actorName} and ${otherCount} other${otherCount > 1 ? 's' : ''} played ${item.courseName || roundLabel}`
    : `${item.actorName} played ${item.courseName || roundLabel}`;

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.78} onPress={onPress}>
      <View style={s.header}>
        <Avatar item={item} theme={theme} />
        <View style={s.headerText}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.meta}>
            {roundLabel} · {item.tournamentName} · {timeAgo(item.ts, now)}
          </Text>
        </View>
        <View style={s.openPill}>
          <Text style={s.openText}>Open</Text>
        </View>
      </View>

      {topResults.length > 0 ? (
        <View style={s.leaderList}>
          {topResults.map((result, index) => (
            <View key={result.playerId} style={s.leaderRow}>
              <Text style={s.rank}>{index + 1}</Text>
              <Text style={s.player} numberOfLines={1}>{result.name}</Text>
              <Text style={s.points}>{result.points}</Text>
              <Text style={s.pointsLabel}>PTS</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!item.isMine && !item.withMe ? (
        <View style={s.contextRow}>
          <Feather name="users" size={11} color={theme.text.muted} />
          <Text style={s.contextText}>A round without you</Text>
        </View>
      ) : null}

      {children}
    </TouchableOpacity>
  );
}

function styles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
      padding: 14,
      marginBottom: 12,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerText: { flex: 1, minWidth: 0 },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarSmall: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: '#ffd700',
      fontSize: 12,
    },
    avatarSmallText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: '#ffd700',
      fontSize: 10,
    },
    title: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 14,
      lineHeight: 19,
    },
    meta: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 11,
      marginTop: 2,
    },
    openPill: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    openText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.secondary,
      fontSize: 10,
    },
    leaderList: {
      borderTopWidth: 1,
      borderTopColor: theme.border.default,
      marginTop: 12,
      paddingTop: 4,
    },
    leaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 31,
      gap: 8,
    },
    rank: {
      width: 22,
      textAlign: 'center',
      fontFamily: 'PlayfairDisplay-Bold',
      color: theme.text.muted,
      fontSize: 13,
    },
    player: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 13,
    },
    points: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 13,
      minWidth: 34,
      textAlign: 'right',
    },
    pointsLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.muted,
      fontSize: 8,
      minWidth: 24,
      textAlign: 'right',
    },
    contextRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 10,
    },
    contextText: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 11,
    },
  });
}
```

- [ ] **Step 4: Integrate rail, card, and story viewer in `FeedScreen`**

In `src/screens/FeedScreen.js`:

1. Import the new components:

```js
import RoundStoriesRail from '../components/feed/RoundStoriesRail';
import FeedRoundCard from '../components/feed/FeedRoundCard';
import MemoriesStoriesViewer from '../components/MemoriesStoriesViewer';
```

2. Add state:

```js
const [roundStories, setRoundStories] = useState([]);
const [openStory, setOpenStory] = useState(null);
```

3. In `load`, after `const feedItems = result.items ?? [];`, add:

```js
setRoundStories(result.roundStories ?? []);
```

4. In `renderRound`, replace the current round card JSX with:

```js
return (
  <FeedRoundCard
    item={item}
    now={now}
    timeAgo={timeAgo}
    onPress={() => openRound(item)}
  >
    <ReactionBar
      itemKey={item.key}
      reactions={reactions[item.key]}
      onChange={applyReaction}
      commentCount={commentCounts[item.key] ?? 0}
      onOpenComments={setOpenCommentsKey}
      s={s}
      theme={theme}
    />
  </FeedRoundCard>
);
```

5. Render the rail above filters:

```js
<RoundStoriesRail stories={roundStories} onPressStory={setOpenStory} />
```

6. Render the viewer near `CommentsSheet`:

```js
<MemoriesStoriesViewer
  visible={!!openStory}
  items={openStory?.mediaList ?? []}
  startIndex={0}
  rounds={[]}
  storyTitle={openStory?.roundLabel}
  storySubtitle={openStory?.tournamentName}
  onClose={() => setOpenStory(null)}
/>
```

- [ ] **Step 5: Run feed screen tests**

Run: `npx jest src/screens/__tests__/FeedScreen.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/components/feed/FeedRoundCard.js src/screens/FeedScreen.js src/screens/__tests__/FeedScreen.test.js
git commit -m "feat: integrate round stories into feed"
```

### Task 4: Round-Scoped Story Viewer Header

**Files:**
- Modify: `src/components/MemoriesStoriesViewer.js`
- Modify: `src/screens/__tests__/FeedScreen.test.js`

- [ ] **Step 1: Add a test expectation for viewer props through the mock**

In `src/screens/__tests__/FeedScreen.test.js`, replace the `MemoriesStoriesViewer` mock with:

```js
jest.mock('../../components/MemoriesStoriesViewer', () => function MockMemoriesStoriesViewer({
  visible,
  items,
  storyTitle,
  storySubtitle,
}) {
  return visible ? (
    <>
      <Text>{`Story viewer ${items.length}`}</Text>
      <Text>{storyTitle}</Text>
      <Text>{storySubtitle}</Text>
    </>
  ) : null;
});
```

In the rail test, add:

```js
expect(await findByText('La Moraleja')).toBeTruthy();
expect(await findByText('Weekend Match')).toBeTruthy();
```

- [ ] **Step 2: Run the feed screen test**

Run: `npx jest src/screens/__tests__/FeedScreen.test.js --runInBand`

Expected: PASS if Task 3 already passed and `FeedScreen` passes the title/subtitle props.

- [ ] **Step 3: Update `MemoriesStoriesViewer` to use story title props**

In `src/components/MemoriesStoriesViewer.js`, change the function signature:

```js
export default function MemoriesStoriesViewer({
  visible,
  items = [],
  startIndex = 0,
  rounds,
  storyTitle,
  storySubtitle,
  onClose,
}) {
```

Replace the `topLabel` construction with:

```js
const defaultTopLabel = `R${curRoundIndex >= 0 ? curRoundIndex + 1 : '?'}${
  curRound?.courseName ? ` · ${curRound.courseName}` : ''
} · ${index + 1}/${items.length}`;
const topLabel = storyTitle
  ? `${storyTitle} · ${index + 1}/${items.length}`
  : defaultTopLabel;
```

Then update the header text:

```js
<Text style={s.topLabel}>
  {topLabel}
</Text>
{storySubtitle ? (
  <Text style={s.topSubtitle} numberOfLines={1}>{storySubtitle}</Text>
) : null}
```

Add style:

```js
topSubtitle: {
  color: 'rgba(255,255,255,0.72)',
  fontFamily: 'PlusJakartaSans-Regular',
  fontSize: 10,
  marginTop: 1,
},
```

- [ ] **Step 4: Run viewer-adjacent tests**

Run: `npx jest src/screens/__tests__/FeedScreen.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/components/MemoriesStoriesViewer.js src/screens/__tests__/FeedScreen.test.js
git commit -m "feat: support round-scoped story headers"
```

### Task 5: Finished Round Model Helpers

**Files:**
- Create: `src/screens/roundSummaryModel.js`
- Create: `src/screens/__tests__/roundSummaryModel.test.js`

- [ ] **Step 1: Write failing model tests**

Create `src/screens/__tests__/roundSummaryModel.test.js`:

```js
import {
  buildRoundRecap,
  buildScorecardSections,
} from '../roundSummaryModel';

const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: i % 3 === 0 ? 5 : i % 3 === 1 ? 4 : 3,
  strokeIndex: i + 1,
}));

const players = [
  { id: 'p1', name: 'Marcos', user_id: 'u1' },
  { id: 'p2', name: 'Pablo', user_id: 'u2' },
];

const totals = [
  { player: players[0], totalPoints: 38, totalStrokes: 82 },
  { player: players[1], totalPoints: 34, totalStrokes: 88 },
];

describe('roundSummaryModel', () => {
  test('buildRoundRecap reports winner, margin, strokes, holes, and player count', () => {
    const round = {
      holes,
      scores: {
        p1: Object.fromEntries(holes.map((h) => [h.number, 4])),
        p2: Object.fromEntries(holes.map((h) => [h.number, 5])),
      },
    };

    expect(buildRoundRecap({ round, ranked: totals })).toEqual({
      winnerName: 'Marcos',
      winnerPoints: 38,
      margin: 4,
      winnerStrokes: 82,
      holesPlayed: 18,
      playerCount: 2,
    });
  });

  test('buildRoundRecap counts early-finished holes from entered scores', () => {
    const round = {
      holes,
      scores: {
        p1: { 1: 4, 2: 5, 3: 4 },
        p2: { 1: 5, 2: 5 },
      },
    };

    expect(buildRoundRecap({ round, ranked: totals }).holesPlayed).toBe(3);
  });

  test('buildScorecardSections splits front and back nine with player rows and totals', () => {
    const round = {
      holes,
      scores: {
        p1: Object.fromEntries(holes.map((h) => [h.number, 4])),
        p2: Object.fromEntries(holes.map((h) => [h.number, h.number <= 9 ? 5 : null])),
      },
    };

    const sections = buildScorecardSections({ round, ranked: totals });

    expect(sections).toHaveLength(2);
    expect(sections[0].label).toBe('Front');
    expect(sections[0].holes.map((h) => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sections[1].label).toBe('Back');
    expect(sections[1].holes.map((h) => h.number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(sections[0].playerRows[0]).toMatchObject({
      playerId: 'p1',
      name: 'Marcos',
      scores: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      total: 36,
    });
    expect(sections[1].playerRows[1].scores).toEqual([null, null, null, null, null, null, null, null, null]);
    expect(sections[1].playerRows[1].total).toBe(0);
  });
});
```

- [ ] **Step 2: Run failing model tests**

Run: `npx jest src/screens/__tests__/roundSummaryModel.test.js --runInBand`

Expected: FAIL with `Cannot find module '../roundSummaryModel'`.

- [ ] **Step 3: Implement round summary model helpers**

Create `src/screens/roundSummaryModel.js`:

```js
function scoreFor(round, playerId, holeNumber) {
  const value = round?.scores?.[playerId]?.[holeNumber];
  return value == null ? null : value;
}

function countPlayedHoles(round) {
  const played = new Set();
  const scores = round?.scores ?? {};
  for (const playerScores of Object.values(scores)) {
    for (const [hole, value] of Object.entries(playerScores ?? {})) {
      if (value != null) played.add(Number(hole));
    }
  }
  return played.size;
}

export function buildRoundRecap({ round, ranked }) {
  const winner = ranked?.[0] ?? null;
  const second = ranked?.[1] ?? null;
  return {
    winnerName: winner?.player?.name ?? 'No winner',
    winnerPoints: winner?.totalPoints ?? 0,
    margin: winner && second ? winner.totalPoints - second.totalPoints : 0,
    winnerStrokes: winner?.totalStrokes ?? 0,
    holesPlayed: countPlayedHoles(round),
    playerCount: ranked?.length ?? 0,
  };
}

function buildSection(label, holes, ranked, round) {
  return {
    label,
    holes,
    parTotal: holes.reduce((sum, h) => sum + (h.par || 0), 0),
    playerRows: (ranked ?? []).map((entry) => {
      const scores = holes.map((hole) => scoreFor(round, entry.player.id, hole.number));
      return {
        playerId: entry.player.id,
        name: entry.player.name,
        scores,
        total: scores.reduce((sum, value) => sum + (value ?? 0), 0),
      };
    }),
  };
}

export function buildScorecardSections({ round, ranked }) {
  const holes = round?.holes ?? [];
  const front = holes.filter((h) => h.number >= 1 && h.number <= 9);
  const back = holes.filter((h) => h.number >= 10 && h.number <= 18);
  return [
    buildSection('Front', front, ranked, round),
    buildSection('Back', back, ranked, round),
  ].filter((section) => section.holes.length > 0);
}
```

- [ ] **Step 4: Run model tests**

Run: `npx jest src/screens/__tests__/roundSummaryModel.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/screens/roundSummaryModel.js src/screens/__tests__/roundSummaryModel.test.js
git commit -m "feat: add finished round summary model"
```

### Task 6: Finished Round UI Components

**Files:**
- Create: `src/components/roundSummary/RoundRecapPanel.js`
- Create: `src/components/roundSummary/RoundSummaryTabs.js`
- Create: `src/components/roundSummary/RoundScorecardTables.js`
- Create: `src/components/roundSummary/__tests__/RoundScorecardTables.test.js`

- [ ] **Step 1: Write failing scorecard table tests**

Create `src/components/roundSummary/__tests__/RoundScorecardTables.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundScorecardTables from '../RoundScorecardTables';

const sections = [
  {
    label: 'Front',
    holes: [
      { number: 1, par: 4 },
      { number: 2, par: 3 },
    ],
    parTotal: 7,
    playerRows: [
      { playerId: 'p1', name: 'Marcos', scores: [5, 3], total: 8 },
      { playerId: 'p2', name: 'Pablo', scores: [null, 4], total: 4 },
    ],
  },
  {
    label: 'Back',
    holes: [
      { number: 10, par: 4 },
      { number: 11, par: 5 },
    ],
    parTotal: 9,
    playerRows: [
      { playerId: 'p1', name: 'Marcos', scores: [4, 6], total: 10 },
    ],
  },
];

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundScorecardTables', () => {
  test('renders front and back sections with holes, par, players, and totals', () => {
    const { getByText, getAllByText } = render(wrap(
      <RoundScorecardTables sections={sections} />
    ));

    expect(getByText('Front nine')).toBeTruthy();
    expect(getByText('Back nine')).toBeTruthy();
    expect(getAllByText('Marcos').length).toBe(2);
    expect(getByText('Pablo')).toBeTruthy();
    expect(getByText('Out')).toBeTruthy();
    expect(getByText('In')).toBeTruthy();
    expect(getByText('·')).toBeTruthy();
  });

  test('renders an empty message when sections are absent', () => {
    const { getByText } = render(wrap(
      <RoundScorecardTables sections={[]} />
    ));

    expect(getByText('No scorecard data for this round')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing component tests**

Run: `npx jest src/components/roundSummary/__tests__/RoundScorecardTables.test.js --runInBand`

Expected: FAIL with `Cannot find module '../RoundScorecardTables'`.

- [ ] **Step 3: Implement `RoundScorecardTables`**

Create `src/components/roundSummary/RoundScorecardTables.js`:

```js
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

function sectionTitle(label) {
  return label === 'Front' ? 'Front nine' : label === 'Back' ? 'Back nine' : label;
}

function totalLabel(label) {
  return label === 'Front' ? 'Out' : label === 'Back' ? 'In' : 'Tot';
}

export default function RoundScorecardTables({ sections }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  if (!sections?.length) {
    return <Text style={s.empty}>No scorecard data for this round</Text>;
  }

  return (
    <View style={s.wrap}>
      {sections.map((section) => (
        <View key={section.label} style={s.section}>
          <Text style={s.sectionTitle}>{sectionTitle(section.label)}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.table}>
              <View style={s.row}>
                <View style={[s.cell, s.nameCell, s.headCell]}><Text style={s.headText}>Hole</Text></View>
                {section.holes.map((hole) => (
                  <View key={hole.number} style={[s.cell, s.headCell]}>
                    <Text style={s.headText}>{hole.number}</Text>
                  </View>
                ))}
                <View style={[s.cell, s.totalCell, s.headCell]}><Text style={s.headText}>{totalLabel(section.label)}</Text></View>
              </View>
              <View style={s.row}>
                <View style={[s.cell, s.nameCell]}><Text style={s.parText}>Par</Text></View>
                {section.holes.map((hole) => (
                  <View key={hole.number} style={s.cell}><Text style={s.parText}>{hole.par}</Text></View>
                ))}
                <View style={[s.cell, s.totalCell]}><Text style={s.totalText}>{section.parTotal}</Text></View>
              </View>
              {section.playerRows.map((player) => (
                <View key={player.playerId} style={s.row}>
                  <View style={[s.cell, s.nameCell]}><Text style={s.nameText} numberOfLines={1}>{player.name}</Text></View>
                  {player.scores.map((score, index) => (
                    <View key={`${player.playerId}-${index}`} style={s.cell}>
                      <Text style={s.scoreText}>{score ?? '·'}</Text>
                    </View>
                  ))}
                  <View style={[s.cell, s.totalCell]}><Text style={s.totalText}>{player.total || '·'}</Text></View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: 14 },
    section: {
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border.default,
      overflow: 'hidden',
    },
    sectionTitle: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 13,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 8,
    },
    table: { paddingHorizontal: 12, paddingBottom: 12 },
    row: { flexDirection: 'row' },
    cell: {
      width: 34,
      minHeight: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.bg.card,
    },
    nameCell: {
      width: 72,
      alignItems: 'flex-start',
      paddingHorizontal: 8,
      backgroundColor: theme.bg.secondary,
    },
    headCell: { backgroundColor: theme.bg.secondary },
    totalCell: { width: 42, backgroundColor: theme.accent.light },
    headText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.muted,
      fontSize: 9,
    },
    parText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 11,
    },
    nameText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.primary,
      fontSize: 11,
    },
    scoreText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 12,
    },
    totalText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.accent.primary,
      fontSize: 12,
    },
    empty: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 13,
      paddingVertical: 12,
    },
  });
}
```

- [ ] **Step 4: Implement `RoundRecapPanel`**

Create `src/components/roundSummary/RoundRecapPanel.js`:

```js
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export default function RoundRecapPanel({ recap, roundLabel, tournamentName }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <View style={s.card}>
      <Text style={s.kicker}>{tournamentName}</Text>
      <Text style={s.title}>{roundLabel}</Text>
      <Text style={s.summary}>
        {recap.winnerName === 'No winner'
          ? 'No scores recorded for this round.'
          : `${recap.winnerName} led with ${recap.winnerPoints} points.`}
      </Text>
      <View style={s.stats}>
        <Stat label="Winner" value={recap.winnerPoints} />
        <Stat label="Margin" value={`+${recap.margin}`} />
        <Stat label="Strokes" value={recap.winnerStrokes} />
        <Stat label="Holes" value={recap.holesPlayed} />
      </View>
    </View>
  );
}

function Stat({ label, value }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 14,
    },
    kicker: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 11,
      marginBottom: 3,
    },
    title: {
      fontFamily: 'PlayfairDisplay-Bold',
      color: theme.text.primary,
      fontSize: 22,
      lineHeight: 27,
    },
    summary: {
      fontFamily: 'PlusJakartaSans-Regular',
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 6,
    },
    stats: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: theme.bg.secondary,
      borderRadius: 12,
      paddingVertical: 8,
      minWidth: 0,
    },
    statValue: {
      fontFamily: 'PlayfairDisplay-Bold',
      color: theme.text.primary,
      fontSize: 18,
    },
    statLabel: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.muted,
      fontSize: 8,
      marginTop: 2,
    },
  });
}
```

- [ ] **Step 5: Implement `RoundSummaryTabs`**

Create `src/components/roundSummary/RoundSummaryTabs.js`:

```js
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export const ROUND_SUMMARY_TABS = [
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'photos', label: 'Photos' },
  { key: 'comments', label: 'Comments' },
];

export default function RoundSummaryTabs({ active, onChange }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.tabs}
      testID="round-summary-tabs"
    >
      {ROUND_SUMMARY_TABS.map((tab) => {
        const selected = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, selected && s.tabActive]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
          >
            <Text style={[s.tabText, selected && s.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tabs: {
      gap: 8,
      paddingVertical: 12,
    },
    tab: {
      borderWidth: 1,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.card,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    tabActive: {
      backgroundColor: theme.accent.primary,
      borderColor: theme.accent.primary,
    },
    tabText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.secondary,
      fontSize: 12,
    },
    tabTextActive: {
      color: theme.text.inverse,
    },
  });
}
```

- [ ] **Step 6: Run round summary component tests**

Run: `npx jest src/components/roundSummary/__tests__/RoundScorecardTables.test.js --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/components/roundSummary
git commit -m "feat: add finished round summary components"
```

### Task 7: Round Summary Screen Integration

**Files:**
- Modify: `src/screens/RoundSummaryScreen.js`
- Create: `src/screens/__tests__/RoundSummaryScreen.test.js`

- [ ] **Step 1: Write failing screen tests**

Create `src/screens/__tests__/RoundSummaryScreen.test.js`:

```js
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundSummaryScreen from '../RoundSummaryScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => cb(),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'u1' } } })) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
        })),
      })),
    })),
  },
}));

jest.mock('../../store/mediaStore', () => ({
  loadRoundMedia: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../store/tournamentStore', () => ({
  readLocal: jest.fn(),
  setActiveTournament: jest.fn(() => Promise.resolve()),
  getTournamentSnapshot: jest.fn(() => ({
    id: 't1',
    name: 'Weekend Match',
    kind: 'game',
    players: [
      { id: 'p1', name: 'Marcos', user_id: 'u1' },
      { id: 'p2', name: 'Pablo', user_id: 'u2' },
    ],
    rounds: [{
      id: 'r1',
      courseName: 'La Moraleja',
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
      scores: {
        p1: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])),
        p2: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 5])),
      },
    }],
  })),
  formatRoundLabel: jest.fn(({ courseName }) => courseName),
  roundTotals: jest.fn((round, players) => [
    { player: players[0], totalPoints: 38, totalStrokes: 72 },
    { player: players[1], totalPoints: 34, totalStrokes: 90 },
  ]),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { tournamentId: 't1', roundId: 'r1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundSummaryScreen', () => {
  test('defaults to scorecard tab with recap and front/back scorecards', async () => {
    const { findByText, getByText, getByLabelText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />
    ));

    expect(await findByText('Marcos led with 38 points.')).toBeTruthy();
    expect(getByLabelText('Scorecard').props.accessibilityState.selected).toBe(true);
    expect(getByText('Front nine')).toBeTruthy();
    expect(getByText('Back nine')).toBeTruthy();
  });

  test('switches to leaderboard tab', async () => {
    const { findByLabelText, findByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />
    ));

    fireEvent.press(await findByLabelText('Leaderboard'));

    expect(await findByText('Marcos')).toBeTruthy();
    expect(await findByText('38')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing screen tests**

Run: `npx jest src/screens/__tests__/RoundSummaryScreen.test.js --runInBand`

Expected: FAIL because the screen does not render the new tabs or front/back table components.

- [ ] **Step 3: Integrate new model and components in `RoundSummaryScreen`**

In `src/screens/RoundSummaryScreen.js`, add imports:

```js
import RoundRecapPanel from '../components/roundSummary/RoundRecapPanel';
import RoundSummaryTabs from '../components/roundSummary/RoundSummaryTabs';
import RoundScorecardTables from '../components/roundSummary/RoundScorecardTables';
import { buildRoundRecap, buildScorecardSections } from './roundSummaryModel';
```

Add tab state:

```js
const [activeTab, setActiveTab] = useState('scorecard');
```

After `ranked` and `roundLabel` are derived:

```js
const recap = round ? buildRoundRecap({ round, ranked }) : null;
const scorecardSections = round ? buildScorecardSections({ round, ranked }) : [];
```

Replace the current `ScrollView` body with this structure:

```js
<ScrollView contentContainerStyle={s.content}>
  {recap ? (
    <RoundRecapPanel
      recap={recap}
      roundLabel={roundLabel}
      tournamentName={tournament.name}
    />
  ) : null}

  <RoundSummaryTabs active={activeTab} onChange={setActiveTab} />

  {activeTab === 'scorecard' ? (
    <RoundScorecardTables sections={scorecardSections} />
  ) : null}

  {activeTab === 'leaderboard' ? (
    <View>
      {ranked.length === 0 ? (
        <Text style={s.empty}>No scores recorded for this round.</Text>
      ) : ranked.map((entry, i) => {
        const isMe = entry.player.user_id && entry.player.user_id === me;
        return (
          <View key={entry.player.id} style={[s.lbRow, isMe && s.lbRowMe]}>
            <Text style={s.lbRank}>{i + 1}</Text>
            <View style={s.lbNameWrap}>
              <Text style={[s.lbName, isMe && s.lbNameMe]} numberOfLines={1}>
                {entry.player.name}{isMe ? '  (you)' : ''}
              </Text>
            </View>
            <View style={s.lbStat}>
              <Text style={s.lbStatValue}>{entry.totalPoints}</Text>
              <Text style={s.lbStatLabel}>PTS</Text>
            </View>
            <View style={s.lbStat}>
              <Text style={s.lbStatValue}>{entry.totalStrokes}</Text>
              <Text style={s.lbStatLabel}>STR</Text>
            </View>
          </View>
        );
      })}
    </View>
  ) : null}

  {activeTab === 'photos' ? (
    media.length > 0 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {media.map((m) => (
          <Image
            key={m.id}
            source={{ uri: m.thumbUrl || m.url }}
            style={s.photo}
            resizeMode="cover"
          />
        ))}
      </ScrollView>
    ) : (
      <Text style={s.empty}>No photos for this round.</Text>
    )
  ) : null}

  {activeTab === 'comments' ? (
    <Text style={s.empty}>Comments appear from the feed thread for this round.</Text>
  ) : null}

  {iAmPlaying && (
    <TouchableOpacity
      style={s.openBtn}
      onPress={openInScorecard}
      activeOpacity={0.85}
    >
      <Feather name="edit-3" size={15} color={theme.text.inverse} />
      <Text style={s.openBtnText}>Open in scorecard</Text>
    </TouchableOpacity>
  )}
</ScrollView>
```

Remove the old inline `sectionLabel`, `gridWrap`, and old scorecard grid JSX from the rendered body. Leave styles that are still used by leaderboard, photos, notes, and open button.

- [ ] **Step 4: Run round summary screen tests**

Run: `npx jest src/screens/__tests__/RoundSummaryScreen.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Run all new focused tests**

Run:

```bash
npx jest \
  src/store/__tests__/feedStore.roundStories.test.js \
  src/components/feed/__tests__/RoundStoriesRail.test.js \
  src/screens/__tests__/FeedScreen.test.js \
  src/screens/__tests__/roundSummaryModel.test.js \
  src/components/roundSummary/__tests__/RoundScorecardTables.test.js \
  src/screens/__tests__/RoundSummaryScreen.test.js \
  --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/screens/RoundSummaryScreen.js src/screens/__tests__/RoundSummaryScreen.test.js
git commit -m "feat: refactor finished round summary view"
```

### Task 8: Polish, Lint, and Full Verification

**Files:**
- Modify files touched by Tasks 1-7 only when verification finds concrete issues.

- [ ] **Step 1: Run lint**

Run: `npm run lint`

Expected: PASS. If lint fails, fix only the reported files from this plan.

- [ ] **Step 2: Run full Jest suite**

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Run web export**

Run: `npm run build:web`

Expected: PASS and Expo export completes without route/component errors.

- [ ] **Step 4: Start web app for manual browser verification**

Run: `npm run web`

Expected: Expo starts and prints a local URL, typically `http://localhost:8081`.

- [ ] **Step 5: Verify feed manually in browser**

Open the Expo web URL and verify:

- Feed loads without console errors.
- Round stories rail appears when media exists.
- Feed starts with the rail, not a weekly summary card.
- Tapping a rail story opens the story viewer with only that round's media.
- Round cards show top-three result previews.
- Tapping a round card opens the finished round view.

- [ ] **Step 6: Verify finished round manually in browser**

In the finished round view, verify:

- Recap panel is compact and mature.
- Scorecard tab is selected by default.
- Front nine and back nine scorecards are visible without hunting through the page.
- Leaderboard tab shows Stableford points and strokes.
- Photos tab handles empty and non-empty media states.
- `Open in scorecard` still appears for a participant round.

- [ ] **Step 7: Commit final verification fixes**

If Step 1-6 required edits:

```bash
git status --short
git add src/store/feedStore.js src/store/__tests__/feedStore.roundStories.test.js src/components/feed/RoundStoriesRail.js src/components/feed/FeedRoundCard.js src/components/feed/__tests__/RoundStoriesRail.test.js src/components/MemoriesStoriesViewer.js src/screens/FeedScreen.js src/screens/__tests__/FeedScreen.test.js src/screens/roundSummaryModel.js src/screens/__tests__/roundSummaryModel.test.js src/components/roundSummary/RoundRecapPanel.js src/components/roundSummary/RoundSummaryTabs.js src/components/roundSummary/RoundScorecardTables.js src/components/roundSummary/__tests__/RoundScorecardTables.test.js src/screens/RoundSummaryScreen.js src/screens/__tests__/RoundSummaryScreen.test.js
git commit -m "fix: polish feed round social refactor"
```

If no edits were required, do not create an empty commit.

## Rollback Plan

Each task is committed separately. If the story rail creates problems, revert Tasks 2-4 while keeping Task 1's data helper only if no caller depends on it. If the finished-round refactor creates problems, revert Tasks 5-7. No database migration is required, and story viewed/unviewed state is local-only.

## Self-Review Notes

- Spec coverage: round stories, no weekly summary, top-three round cards, round-scoped story viewer, recap-first finished round, front/back scorecard, scorecard tabs, empty states, and tests are all covered by tasks.
- Scope: player comparison, key-hole automation, and user stories are explicitly excluded.
- Type consistency: story objects use `key`, `roundLabel`, `countLabel`, `mediaList`, `latestTs`, and `viewed`; scorecard sections use `label`, `holes`, `parTotal`, and `playerRows`.
