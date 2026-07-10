# Round Summary Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feed's round drill-in page (`RoundSummaryScreen`) use the app's real scorecard and scoreboard UI, match the feed/home visual language, and fix its dead ends (untappable photos, read-only comments, no live refresh).

**Architecture:** Reuse-first refactor. Export the live scorecard's `ScorecardTable` (read-only via existing `editable` prop) plus a `resolveScorecardRows` mode helper from `GridView.js`; extract HomeScreen's `RoundScoreboard` and CommentsSheet's thread UI into shared components; rebuild the summary screen's tabs on top of them; delete the bespoke `RoundScorecardTables`.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, react-native-web, Jest (jest-expo) + @testing-library/react-native, theme via `src/theme/ThemeContext`.

**Spec:** `docs/superpowers/specs/2026-07-10-round-summary-redesign-design.md`

## Global Constraints

- `npm test` (~330+ tests) and `npm run lint` (ESLint 9 flat config, CI-blocking) must pass after every task.
- Domain logic lives in `src/store/` / model files, UI in screens/components (CLAUDE.md).
- All styling through `useTheme()` tokens (`theme.bg.*`, `theme.text.*`, `theme.accent.*`, `theme.border.*`, `theme.scoreColor(...)`) and the app's fonts (`PlusJakartaSans-*`, `PlayfairDisplay-*`). No hard-coded colors except the existing `#ffd700` avatar-initial convention.
- Zero visual change to the live scorecard (ScorecardScreen) and Home screen — extractions only.
- Commit after each task with a conventional-commit message ending in the Claude co-author trailer.

---

### Task 1: Export read-only scorecard pieces from GridView

**Files:**
- Modify: `src/components/scorecard/GridView.js` (function `ScorecardTable` at ~line 284, mode-resolution block inside `GridView` at ~lines 463-484)
- Test: `src/components/scorecard/__tests__/resolveScorecardRows.test.js` (create)

**Interfaces:**
- Produces: `export function resolveScorecardRows({ round, settings, players, meId, isBestBall })` → `{ mode, rowPlayers, rowHandicaps, effectiveMeId }`; `export function ScorecardTable({ round, players, scores, onSetScore, editable, mode, meId, handicapsOverride })` (existing component, now exported). Task 4 imports both from `'../components/scorecard/GridView'`.

- [ ] **Step 1: Write the failing test**

Create `src/components/scorecard/__tests__/resolveScorecardRows.test.js`:

```js
import { resolveScorecardRows } from '../GridView';

const players = [
  { id: 'p1', name: 'Ana', handicap: 10 },
  { id: 'p2', name: 'Bea', handicap: 20 },
];

describe('resolveScorecardRows', () => {
  test('defaults to stableford with players as rows', () => {
    const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
      round: { scoringMode: undefined },
      settings: {},
      players,
      meId: 'p2',
    });
    expect(mode).toBe('stableford');
    expect(rowPlayers).toBe(players);
    expect(rowHandicaps).toBeNull();
    expect(effectiveMeId).toBe('p2');
  });

  test('round scoringMode overrides settings and maps bestball', () => {
    const { mode } = resolveScorecardRows({
      round: { scoringMode: 'bestball' },
      settings: { scoringMode: 'stableford' },
      players,
      meId: 'p1',
    });
    expect(mode).toBe('bestball');
  });

  test('scramble mode swaps rows for team units keyed by captain', () => {
    const round = {
      scoringMode: 'scramblepairs',
      pairs: [[players[0], players[1]]],
      playerHandicaps: { p1: 10, p2: 20 },
    };
    const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
      round, settings: {}, players, meId: 'p2',
    });
    expect(mode).toBe('scramblepairs');
    expect(rowPlayers).toHaveLength(1);
    expect(rowPlayers[0].id).toBe('p1'); // captain = pair[0]
    expect(rowHandicaps).toHaveProperty('p1');
    expect(effectiveMeId).toBe('p1'); // me resolves to containing team's row
  });
});
```

Note: check `scrambleUnits(round, players)` in `src/store/tournamentStore.js` before finalizing the scramble fixture — the test fixture must match its expected `round.pairs` shape. Adjust the fixture (not the assertion intent) if it reads pairs differently.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/resolveScorecardRows.test.js`
Expected: FAIL — `resolveScorecardRows` is not exported.

- [ ] **Step 3: Implement — extract the helper and export the table**

In `GridView.js`, above `function ScorecardTable`, add (this is the exact logic currently inline in `GridView`, moved verbatim):

```js
// Resolve what the scorecard table actually renders for a round: the engine
// mode, the row "players" (scramble modes collapse to team units keyed by
// the captain), the handicap override for those rows, and which row counts
// as "me". Shared by the live GridView and the read-only round summary.
export function resolveScorecardRows({ round, settings, players, meId, isBestBall = false }) {
  const rawMode = round?.scoringMode ?? settings?.scoringMode ?? 'stableford';
  const mode = rawMode === 'matchplay' ? 'matchplay'
    : rawMode === 'sindicato' ? 'sindicato'
    : rawMode === 'pairsmatchplay' ? 'pairsmatchplay'
    : isScrambleMode(rawMode) ? rawMode
    : rawMode === 'bestball' || isBestBall ? 'bestball'
    : 'stableford';

  const isScramble = isScrambleMode(mode);
  const rowPlayers = isScramble ? scrambleUnits(round, players) : players;
  const rowHandicaps = isScramble
    ? Object.fromEntries(rowPlayers.map((u) => [u.id, u.handicap]))
    : null;
  const effectiveMeId = isScramble
    ? (rowPlayers.find((u) => u.members?.some((m) => m.id === meId))?.id ?? meId)
    : meId;
  return { mode, rowPlayers, rowHandicaps, effectiveMeId };
}
```

Then:
1. Change `function ScorecardTable(` to `export function ScorecardTable(`.
2. Replace the inline block in `GridView` (the `rawMode`/`mode`/`isScramble`/`rowPlayers`/`rowHandicaps`/`effectiveMeId` declarations, ~lines 464-484) with:

```js
  const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
    round, settings, players, meId, isBestBall,
  });
```

Behavior note: the original `GridView` mapped raw `'bestball'` into the `isBestBall ? 'bestball' : 'stableford'` fallback; the helper adds `rawMode === 'bestball'` explicitly so the summary screen (which has no `isBestBall` prop) still resolves best-ball rounds. This is a superset of the old behavior — when `isBestBall` is passed nothing changes.

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/scorecard`
Expected: new test PASSES, existing GridView/scorecard tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/GridView.js src/components/scorecard/__tests__/resolveScorecardRows.test.js
git commit -m "refactor(scorecard): export ScorecardTable and resolveScorecardRows for reuse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract shared RoundScoreboard component

**Files:**
- Create: `src/components/RoundScoreboard.js`
- Modify: `src/screens/HomeScreen.js` (delete the `RoundScoreboard` definition at ~lines 2261-2362; import the new component; drop the `theme`/`s` props at the `RoundPage` call site ~line 2251)
- Test: `src/components/__tests__/RoundScoreboard.test.js` (create)

**Interfaces:**
- Produces: `export default function RoundScoreboard({ round, players, meId, showRunning = true, ranked = false, teeLabels = null })`. Task 4 imports it from `'../components/RoundScoreboard'`.
- Consumes: `roundTotals(round, players)` from `src/store/tournamentStore` (array of `{ player, totalPoints, totalStrokes, handicap }`), `playersMeFirst(players, meId)` from `src/lib/playerOrder`.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/RoundScoreboard.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundScoreboard from '../RoundScoreboard';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../store/tournamentStore', () => ({
  roundTotals: jest.fn((round, players) => players.map((p, i) => ({
    player: p,
    totalPoints: p.id === 'p2' ? 40 : 30,
    totalStrokes: 80 + i,
    handicap: 12,
  }))),
}));

const players = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Bea' },
];
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4 }));
const fullScores = Object.fromEntries(
  Array.from({ length: 18 }, (_, i) => [i + 1, 4]),
);

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('RoundScoreboard', () => {
  test('renders a stat card per player, me first', () => {
    const { getByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p2"
      />,
    ));
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Bea')).toBeTruthy();
    expect(getByText('Points')).toBeTruthy();
    expect(getByText('vs Par')).toBeTruthy();
  });

  test('ranked mode orders by points and shows rank badges', () => {
    const { getByLabelText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p1"
        ranked
      />,
    ));
    // Bea has 40 pts (mock) -> rank 1
    expect(getByLabelText('Rank 1: Bea')).toBeTruthy();
    expect(getByLabelText('Rank 2: Ana')).toBeTruthy();
  });

  test('shows glowing HOLE badge only mid-round', () => {
    const partial = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [i + 1, 4]),
    );
    const { getByLabelText, rerender, queryByLabelText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: partial } }}
        players={[players[0]]}
        meId="p1"
      />,
    ));
    expect(getByLabelText('On hole 6')).toBeTruthy();

    rerender(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores } }}
        players={[players[0]]}
        meId="p1"
      />,
    ));
    expect(queryByLabelText(/On hole/)).toBeNull();
  });

  test('shows tee badge when teeLabels provided', () => {
    const { getByText } = render(wrap(
      <RoundScoreboard
        round={{ holes, scores: { p1: fullScores, p2: fullScores } }}
        players={players}
        meId="p1"
        teeLabels={{ p1: { label: 'Yellow' } }}
      />,
    ));
    expect(getByText('Yellow')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/RoundScoreboard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/components/RoundScoreboard.js`**

Move the body of HomeScreen's `RoundScoreboard` (lines ~2265-2362) into the new file with its own theme-derived styles (copied verbatim from HomeScreen's `makeStyles`: `roundProgressRow/Track/Fill/Text`, `gamePlayerCard`, `gamePlayerCardLeader`, `gamePlayerHeader`, `gamePlayerName`, `gamePlayerHeaderRight`, `gamePlayerHcp`, `holeBadge`, `holeBadgeText`, `gameStatsRow`, `gameStatCell`, `gameStatDivider`, `gameStatValue`, `gameStatLabel`). New behavior is additive and prop-gated:

```js
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { roundTotals } from '../store/tournamentStore';
import { playersMeFirst } from '../lib/playerOrder';

// Universal round scoreboard — the same player stat cards in every scoring
// mode. Home shows it unranked (me first, no standings); the round summary
// shows it ranked (sorted by Stableford points with rank badges and a
// leader tint). Holes-played progress bar on top; glowing HOLE badge while
// a player is mid-round.
export default function RoundScoreboard({
  round, players, meId, showRunning = true, ranked = false, teeLabels = null,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const holes = round?.holes ?? [];
  const totalHoles = holes.length || 18;

  const totals = roundTotals(round, players);
  const totalsById = Object.fromEntries(totals.map((t) => [t.player.id, t]));
  let rows = playersMeFirst(players, meId).map((player) => {
    const ps = round?.scores?.[player.id] ?? {};
    let strokes = 0;
    let parThrough = 0;
    let played = 0;
    for (const hole of holes) {
      const sc = ps[hole.number];
      if (sc) { strokes += sc; parThrough += hole.par ?? 0; played++; }
    }
    return {
      player,
      handicap: totalsById[player.id]?.handicap,
      points: totalsById[player.id]?.totalPoints ?? 0,
      strokes,
      played,
      vsPar: strokes - parThrough,
    };
  });
  if (ranked) rows = [...rows].sort((a, b) => b.points - a.points);

  const holesPlayed = rows.length ? Math.max(...rows.map((r) => r.played)) : 0;
  const progressPct = totalHoles > 0 ? Math.min(100, Math.round((holesPlayed / totalHoles) * 100)) : 0;

  const vsParText = (r) => {
    if (r.played === 0) return '—';
    if (r.vsPar === 0) return 'E';
    return r.vsPar > 0 ? `+${r.vsPar}` : `${r.vsPar}`;
  };
  const vsParColor = (r) => {
    if (r.played === 0) return theme.text.muted;
    if (r.vsPar < 0) return theme.scoreColor('excellent');
    if (r.vsPar === 0) return theme.scoreColor('good');
    return theme.scoreColor('poor');
  };

  return (
    <>
      <View style={s.roundProgressRow}>
        <View style={s.roundProgressTrack}>
          <View style={[s.roundProgressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={s.roundProgressText}>{holesPlayed} / {totalHoles}</Text>
      </View>
      <View style={{ gap: 10 }}>
        {rows.map((r, i) => {
          const onHole = showRunning && r.played > 0 && r.played < totalHoles
            ? r.played + 1
            : null;
          const isLeader = ranked && i === 0 && r.points > 0;
          const tee = teeLabels?.[r.player.id]?.label;
          return (
            <View key={r.player.id} style={[s.gamePlayerCard, isLeader && s.gamePlayerCardLeader]}>
              <View style={s.gamePlayerHeader}>
                <View
                  style={s.gamePlayerNameWrap}
                  accessibilityLabel={ranked ? `Rank ${i + 1}: ${r.player.name}` : undefined}
                >
                  {ranked && (
                    <View style={s.rankBadge}>
                      <Text style={s.rankBadgeText}>{i + 1}</Text>
                    </View>
                  )}
                  <Text style={s.gamePlayerName} numberOfLines={1}>{r.player.name}</Text>
                  {tee ? <Text style={s.teeBadge}>{tee}</Text> : null}
                </View>
                <View style={s.gamePlayerHeaderRight}>
                  {onHole != null && (
                    <View style={s.holeBadge} accessibilityLabel={`On hole ${onHole}`}>
                      <Text style={s.holeBadgeText}>HOLE {onHole}</Text>
                    </View>
                  )}
                  <Text style={s.gamePlayerHcp}>
                    HCP {Number.isFinite(r.handicap) ? r.handicap : '—'}
                  </Text>
                </View>
              </View>
              <View style={s.gameStatsRow}>
                <View style={s.gameStatCell}>
                  <Text style={s.gameStatValue}>{showRunning ? r.points : '—'}</Text>
                  <Text style={s.gameStatLabel}>Points</Text>
                </View>
                <View style={s.gameStatDivider} />
                <View style={s.gameStatCell}>
                  <Text style={s.gameStatValue}>
                    {showRunning && r.played > 0 ? r.strokes : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>Strokes</Text>
                </View>
                <View style={s.gameStatDivider} />
                <View style={s.gameStatCell}>
                  <Text style={[s.gameStatValue, showRunning && { color: vsParColor(r) }]}>
                    {showRunning ? vsParText(r) : '—'}
                  </Text>
                  <Text style={s.gameStatLabel}>vs Par</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}
```

`makeStyles(t)` copies the listed HomeScreen styles verbatim, plus three new ones:

```js
  gamePlayerNameWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    flex: 1, minWidth: 0,
  },
  rankBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
  },
  rankBadgeText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.secondary, fontSize: 11 },
  teeBadge: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11,
    color: t.accent.primary, backgroundColor: t.accent.light,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
```

- [ ] **Step 4: Update HomeScreen**

1. Add `import RoundScoreboard from '../components/RoundScoreboard';`.
2. Delete the local `const RoundScoreboard = React.memo(...)` block (~lines 2261-2362) including its comment.
3. At the call site in `RoundPage`, change to `<RoundScoreboard round={round} players={players} meId={meId} showRunning={showRunning} />` (drop `theme`/`s`).
4. Do NOT delete the copied styles from HomeScreen's `makeStyles` — first `grep` each name (`roundProgress`, `gamePlayerCard`, `gameStatsRow`, `holeBadge`, …) in `HomeScreen.js`; remove only the ones with zero remaining references after the deletion. (Some, like `holeBadge`, may be used elsewhere in the file.)

- [ ] **Step 5: Run tests**

Run: `npx jest src/components/__tests__/RoundScoreboard.test.js src/screens/__tests__ && npm run lint`
Expected: PASS (HomeScreen tests included).

- [ ] **Step 6: Commit**

```bash
git add src/components/RoundScoreboard.js src/components/__tests__/RoundScoreboard.test.js src/screens/HomeScreen.js
git commit -m "refactor(home): extract RoundScoreboard into shared component with ranked mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract CommentThread from CommentsSheet

**Files:**
- Create: `src/components/CommentThread.js`
- Modify: `src/components/CommentsSheet.js` (becomes a thin BottomSheet wrapper)
- Test: `src/components/__tests__/CommentThread.test.js` (create)

**Interfaces:**
- Produces: `export default function CommentThread({ itemKey, active = true, scroll = false, onCountChange, onCommentAdded })`. Task 4 renders it inline with `scroll={false}` (list in a plain View so it nests inside the screen's scroll container); CommentsSheet renders it with `scroll` and its own maxHeight.
- Consumes: `loadComments(itemKey)`, `addComment(itemKey, body)`, `deleteComment(id)` from `src/store/feedStore`.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/CommentThread.test.js`:

```js
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import CommentThread from '../CommentThread';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../store/feedStore', () => ({
  loadComments: jest.fn(() => Promise.resolve([
    { id: 'c1', body: 'Nice round!', createdAt: '2026-07-10T10:00:00Z', isMine: false, author: { name: 'Bea' } },
  ])),
  addComment: jest.fn(() => Promise.resolve(
    { id: 'c2', body: 'Thanks!', createdAt: '2026-07-10T10:05:00Z', isMine: true, author: { name: 'Ana' } },
  )),
  deleteComment: jest.fn(() => Promise.resolve(true)),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('CommentThread', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads and renders the thread', async () => {
    const { findByText } = render(wrap(<CommentThread itemKey="round:t1:r1" />));
    expect(await findByText('Nice round!')).toBeTruthy();
  });

  test('posts a comment optimistically', async () => {
    const { addComment } = require('../../store/feedStore');
    const onCountChange = jest.fn();
    const { findByText, getByPlaceholderText, getByLabelText } = render(wrap(
      <CommentThread itemKey="round:t1:r1" onCountChange={onCountChange} />,
    ));
    await findByText('Nice round!');

    fireEvent.changeText(getByPlaceholderText('Add a comment…'), 'Thanks!');
    fireEvent.press(getByLabelText('Post comment'));

    expect(await findByText('Thanks!')).toBeTruthy();
    expect(addComment).toHaveBeenCalledWith('round:t1:r1', 'Thanks!');
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith('round:t1:r1', 1));
  });

  test('shows the offline error when posting fails', async () => {
    const { addComment } = require('../../store/feedStore');
    addComment.mockResolvedValueOnce(null);
    const { findByText, getByPlaceholderText, getByLabelText } = render(wrap(
      <CommentThread itemKey="round:t1:r1" />,
    ));
    await findByText('Nice round!');

    fireEvent.changeText(getByPlaceholderText('Add a comment…'), 'Hello');
    fireEvent.press(getByLabelText('Post comment'));

    expect(await findByText(/Couldn't post/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/__tests__/CommentThread.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create CommentThread and slim CommentsSheet**

`src/components/CommentThread.js`: move from `CommentsSheet.js` — `relTime`, `confirmDelete`, `CommentRow`, the `comments/state/draft/sending/sendError` state machine, `load`/`onSend`/`onDelete`, the loading / error / empty / list states, and the composer row, plus all their styles. Differences from the sheet version:

- Props: `{ itemKey, active = true, scroll = false, onCountChange, onCommentAdded }`.
- Load effect keys on `[itemKey, active]` and no-ops while `!active` (replaces the sheet's `visible` gating):

```js
  useEffect(() => {
    if (!active || !itemKey) return;
    setDraft('');
    setSendError(false);
    load();
  }, [active, itemKey, load]);
```

- The list renders in a `ScrollView` only when `scroll` is true; otherwise a plain `View` (so the summary screen can host it inside its own scroll container):

```js
  const List = scroll ? ScrollView : View;
  // ...
  <List style={scroll ? s.list : undefined} contentContainerStyle={scroll ? s.listContent : undefined}>
    {scroll
      ? comments.map((c) => <CommentRow key={c.id} comment={c} theme={theme} s={s} onDelete={onDelete} />)
      : <View style={s.listContent}>{comments.map((c) => (
          <CommentRow key={c.id} comment={c} theme={theme} s={s} onDelete={onDelete} />
        ))}</View>}
  </List>
```

(Equivalent simpler structure is fine — the requirement is: no nested ScrollView when `scroll={false}`, identical visuals when `scroll={true}`.)

`src/components/CommentsSheet.js` becomes:

```js
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BottomSheet from './BottomSheet';
import CommentThread from './CommentThread';
import { useTheme } from '../theme/ThemeContext';

// Bottom-sheet comment thread for a single feed item (a round or a photo
// reel), keyed by the feed item key. The thread itself (load, optimistic
// post, delete-own) lives in CommentThread, shared with the round summary.
export default function CommentsSheet({ visible, itemKey, onClose, onCountChange, onCommentAdded }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
      <Text style={s.title}>Comments</Text>
      <CommentThread
        itemKey={itemKey}
        active={visible}
        scroll
        onCountChange={onCountChange}
        onCommentAdded={onCommentAdded}
      />
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.border.default, marginBottom: 10,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary,
    marginBottom: 12,
  },
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/components && npm run lint`
Expected: PASS, including any existing FeedScreen/CommentsSheet tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommentThread.js src/components/CommentsSheet.js src/components/__tests__/CommentThread.test.js
git commit -m "refactor(feed): extract CommentThread from CommentsSheet for inline reuse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rebuild RoundSummaryScreen on the shared components

**Files:**
- Modify: `src/screens/RoundSummaryScreen.js`
- Modify: `src/screens/roundSummaryModel.js` (delete `buildScorecardSections`; keep `buildRoundRecap`; add `buildRoundHighlights`)
- Delete: `src/components/roundSummary/RoundScorecardTables.js`, `src/components/roundSummary/__tests__/RoundScorecardTables.test.js`
- Test: `src/screens/__tests__/RoundSummaryScreen.test.js` (update), `src/screens/__tests__/roundSummaryModel.test.js` (update)

**Interfaces:**
- Consumes: `ScorecardTable` + `resolveScorecardRows` (Task 1), `RoundScoreboard` (Task 2), `CommentThread` (Task 3), `PullToRefresh` (`src/components/PullToRefresh.js`, ScrollView drop-in with `refreshing`/`onRefresh`).
- Produces: `export function buildRoundHighlights({ round })` in `roundSummaryModel.js` → `{ eagles, birdies, pars, bogeys, doubles }` (Task 5's recap panel consumes it via a `highlights` prop).

- [ ] **Step 1: Update the model tests (failing first)**

In `src/screens/__tests__/roundSummaryModel.test.js`: remove `buildScorecardSections` cases, add:

```js
import { buildRoundHighlights } from '../roundSummaryModel';

describe('buildRoundHighlights', () => {
  const holes = [
    { number: 1, par: 4 },
    { number: 2, par: 4 },
    { number: 3, par: 5 },
  ];

  test('counts hole results across all players', () => {
    const round = {
      holes,
      scores: {
        p1: { 1: 3, 2: 4, 3: 7 },  // birdie, par, double
        p2: { 1: 5, 2: 3, 3: 3 },  // bogey, birdie, eagle
      },
    };
    expect(buildRoundHighlights({ round })).toEqual({
      eagles: 1, birdies: 2, pars: 1, bogeys: 1, doubles: 1,
    });
  });

  test('returns zeros for empty scores', () => {
    expect(buildRoundHighlights({ round: { holes, scores: {} } })).toEqual({
      eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0,
    });
  });
});
```

Run: `npx jest src/screens/__tests__/roundSummaryModel.test.js` — expected FAIL.

- [ ] **Step 2: Implement model changes**

In `roundSummaryModel.js`: delete `buildScorecardSections`, `scoreValue`, `scoreTotal` (and `playerHolesPlayed`/`currentHoleNumber` if nothing else references them — `buildRoundRecap`/`countPlayedHoles` stay). Add:

```js
import { classifyHoleResult } from '../components/scorecard/constants';

// Count semantic hole results (same buckets as the scorecard's score-shape
// chips) across every player in the round, for the recap highlights row.
export function buildRoundHighlights({ round } = {}) {
  const counts = { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 };
  const keyByResult = {
    eagle: 'eagles', birdie: 'birdies', par: 'pars', bogey: 'bogeys', double: 'doubles',
  };
  for (const hole of asArray(round?.holes)) {
    for (const playerScores of Object.values(round?.scores ?? {})) {
      const result = classifyHoleResult(hole?.par, playerScores?.[hole?.number]);
      const key = keyByResult[result];
      if (key) counts[key] += 1;
    }
  }
  return counts;
}
```

Check `classifyHoleResult(par, score)`'s exact return values in `src/components/scorecard/constants.js` first (expected: `'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | null`; eagle-or-better classifies as `'eagle'`). Adjust the map if names differ.

Run the model test again — expected PASS.

- [ ] **Step 3: Update the screen tests (failing first)**

Rewrite `src/screens/__tests__/RoundSummaryScreen.test.js` assertions (keep the existing mock scaffolding, with these mock changes):

- Extend the `tournamentStore` mock with the pieces the real `ScorecardTable` needs:

```js
  calcExtraShots: jest.fn(() => 0),
  scrambleUnits: jest.fn((round, players) => players),
```

- Add a `feedStore` mock entry for `addComment: jest.fn(() => Promise.resolve(null))` and `deleteComment: jest.fn(() => Promise.resolve(true))` (CommentThread imports them).

New/changed test cases:

```js
  test('scorecard tab renders the real scorecard table', async () => {
    const { findByText, getAllByText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    expect(await findByText('FRONT NINE')).toBeTruthy();
    expect(await findByText('BACK NINE')).toBeTruthy();
    // Strokes / Points display toggle from the live scorecard
    expect(getAllByText('Points').length).toBeGreaterThan(0);
    expect(getAllByText('Strokes').length).toBeGreaterThan(0);
  });

  test('leaderboard tab renders shared RoundScoreboard ranked', async () => {
    const { findByLabelText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByLabelText('Leaderboard'));
    expect(await findByLabelText('Rank 1: Marcos')).toBeTruthy();
    expect(await findByLabelText('Rank 2: Pablo')).toBeTruthy();
  });

  test('comments tab has a composer wired to the feed thread', async () => {
    const { findByLabelText, findByPlaceholderText } = render(wrap(
      <RoundSummaryScreen navigation={navigation} route={route} />,
    ));
    fireEvent.press(await findByLabelText('Comments'));
    expect(await findByPlaceholderText('Add a comment…')).toBeTruthy();
  });
```

Keep the notes-preservation test and the feed-comments test as-is (they must still pass — the feed-comments test's `loadComments` is now called by CommentThread when the tab activates). Run: `npx jest src/screens/__tests__/RoundSummaryScreen.test.js` — expected FAIL.

- [ ] **Step 4: Rebuild the screen**

In `RoundSummaryScreen.js`:

1. **Imports:** drop `RoundScorecardTables` and `buildScorecardSections`; add:

```js
import PullToRefresh from '../components/PullToRefresh';
import RoundScoreboard from '../components/RoundScoreboard';
import CommentThread from '../components/CommentThread';
import { ScorecardTable, resolveScorecardRows } from '../components/scorecard/GridView';
import { buildRoundRecap, buildRoundHighlights } from './roundSummaryModel';
```

2. **Refresh state:** add `const [refreshing, setRefreshing] = useState(false);` and

```js
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);
```

Replace the content `ScrollView` with `<PullToRefresh contentContainerStyle={s.content} refreshing={refreshing} onRefresh={onRefresh}>`.

3. **Live polling:** after the `live` flag is computed, hold it in a ref and extend the focus effect:

```js
  const liveRef = useRef(false);
  liveRef.current = live;

  useFocusEffect(useCallback(() => {
    load();
    // Poll while the round is live so scores tick in without a manual pull.
    const id = setInterval(() => { if (liveRef.current) load(); }, 45000);
    return () => clearInterval(id);
  }, [load]));
```

4. **Scorecard tab:** replace `<RoundScorecardTables sections={scorecardSections} />` with:

```js
  const myPlayerId = players.find((p) => p.user_id && p.user_id === me)?.id ?? null;
  const { mode, rowPlayers, rowHandicaps, effectiveMeId } = resolveScorecardRows({
    round, settings: tournament?.settings, players, meId: myPlayerId,
  });
```

(The scorecard highlights "my" row by player id, not auth user id.)

```js
  {activeTab === 'scorecard' ? (
    <ScorecardTable
      round={round}
      players={rowPlayers}
      scores={round.scores ?? {}}
      onSetScore={() => {}}
      editable={() => false}
      mode={mode}
      meId={effectiveMeId}
      handicapsOverride={rowHandicaps}
    />
  ) : null}
```

Delete the `scorecardSections` / `liveByPlayer` derivations.

5. **Leaderboard tab:** replace the bespoke rows with:

```js
  {activeTab === 'leaderboard' ? (
    ranked.length === 0 ? (
      <Text style={s.empty}>No scores recorded for this round.</Text>
    ) : (
      <RoundScoreboard
        round={round}
        players={players}
        meId={myPlayerId}
        ranked
        teeLabels={round.playerTees}
      />
    )
  ) : null}
```

(`ranked` — the `roundTotals`-derived array — stays: `buildRoundRecap` still consumes it.)

6. **Photos tab:** 3-column wrap grid, tappable:

```js
  {activeTab === 'photos' ? (
    media.length > 0 ? (
      <View style={s.photoGrid}>
        {media.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={s.photoCell}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Gallery', { tournamentId, mediaId: m.id })}
            accessibilityRole="imagebutton"
            accessibilityLabel="Open photo in gallery"
          >
            <Image source={{ uri: m.thumbUrl || m.url }} style={s.photo} resizeMode="cover" />
            {m.kind === 'video' ? (
              <View style={s.photoKindBadge}>
                <Feather name="film" size={11} color="#fff" />
              </View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    ) : (
      <Text style={s.empty}>No photos for this round.</Text>
    )
  ) : null}
```

Styles (replace the old `photo` style):

```js
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoCell: {
    width: '31.5%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden',
    backgroundColor: theme.bg.secondary,
  },
  photo: { width: '100%', height: '100%' },
  photoKindBadge: {
    position: 'absolute', right: 6, bottom: 6,
    borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.58)', padding: 5,
  },
```

7. **Comments tab:** replace the read-only list (keep the notes sections below it):

```js
  {activeTab === 'comments' ? (
    <View>
      <CommentThread itemKey={roundFeedKey(tournamentId, roundId)} active={activeTab === 'comments'} />
      {hasNotes ? ( /* existing NOTES + HOLE NOTES blocks unchanged */ ) : null}
    </View>
  ) : null}
```

Remove the now-unused `feedComments` state + `loadComments` wiring from the screen's `load()` (CommentThread loads its own thread), `commentName`, `hasFeedComments`, and the `commentList/commentRow/commentAvatar/commentAvatarImage/commentAvatarText/commentBodyWrap/commentAuthor/commentBody` styles. Also delete the dead leaderboard (`lbRow`, `lbRowMe`, `lbRank`, `lbNameWrap`, `lbName`, `lbNameMe`, `lbStat`, `lbStatValue`, `lbStatLabel`, `onHoleBadge`, `onHoleBadgeText`, `thruText`, `teeBadge`) and grid (`gridWrap` … `gridTotValue`) styles from `makeStyles`.

8. **Recap:** pass highlights (panel consumes it in Task 5): `<RoundRecapPanel ... highlights={buildRoundHighlights({ round })} />`.

- [ ] **Step 5: Delete the bespoke table**

```bash
git rm src/components/roundSummary/RoundScorecardTables.js src/components/roundSummary/__tests__/RoundScorecardTables.test.js
```

- [ ] **Step 6: Run tests**

Run: `npx jest src/screens src/components && npm run lint`
Expected: PASS. Fix any straggling references (`grep -rn "RoundScorecardTables\|buildScorecardSections" src/`).

- [ ] **Step 7: Commit**

```bash
git add -A src/screens/RoundSummaryScreen.js src/screens/roundSummaryModel.js src/screens/__tests__ src/components/roundSummary
git commit -m "feat(round-summary): reuse live scorecard, shared scoreboard, inline comments, tappable photos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Recap panel restyle + highlights row

**Files:**
- Modify: `src/components/roundSummary/RoundRecapPanel.js`
- Test: `src/components/roundSummary/__tests__/RoundRecapPanel.test.js` (create)

**Interfaces:**
- Consumes: `highlights` prop `{ eagles, birdies, pars, bogeys, doubles }` (from Task 4's `buildRoundHighlights`). All existing props unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/components/roundSummary/__tests__/RoundRecapPanel.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import RoundRecapPanel from '../RoundRecapPanel';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;
const recap = { winnerName: 'Ana', winnerPoints: 38, margin: 4, winnerStrokes: 82, holesPlayed: 18, playerCount: 2 };

describe('RoundRecapPanel highlights', () => {
  test('renders highlight chips for non-zero counts only', () => {
    const { getByText, queryByText } = render(wrap(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        summary="Ana won the round."
        highlights={{ eagles: 0, birdies: 3, pars: 10, bogeys: 4, doubles: 1 }}
      />,
    ));
    expect(getByText('3 birdies')).toBeTruthy();
    expect(getByText('10 pars')).toBeTruthy();
    expect(getByText('4 bogeys')).toBeTruthy();
    expect(getByText('1 double+')).toBeTruthy();
    expect(queryByText(/eagle/)).toBeNull();
  });

  test('hides the highlights row when all counts are zero', () => {
    const { queryByText } = render(wrap(
      <RoundRecapPanel
        recap={recap}
        roundLabel="Round 1"
        summary="Ana won the round."
        highlights={{ eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 }}
      />,
    ));
    expect(queryByText(/birdies|pars|bogeys/)).toBeNull();
  });
});
```

Run: `npx jest src/components/roundSummary` — expected FAIL.

- [ ] **Step 2: Implement**

In `RoundRecapPanel.js`:

1. Accept `highlights` prop. Add above the stats row:

```js
  const highlightChips = [
    { key: 'eagles', count: highlights?.eagles ?? 0, singular: 'eagle', plural: 'eagles', tone: 'excellent' },
    { key: 'birdies', count: highlights?.birdies ?? 0, singular: 'birdie', plural: 'birdies', tone: 'good' },
    { key: 'pars', count: highlights?.pars ?? 0, singular: 'par', plural: 'pars', tone: null },
    { key: 'bogeys', count: highlights?.bogeys ?? 0, singular: 'bogey', plural: 'bogeys', tone: 'neutral' },
    { key: 'doubles', count: highlights?.doubles ?? 0, singular: 'double+', plural: 'double+', tone: 'poor' },
  ].filter((c) => c.count > 0);
```

```js
  {highlightChips.length > 0 ? (
    <View style={s.highlightRow}>
      {highlightChips.map((c) => {
        const color = c.tone ? theme.scoreColor(c.tone) : theme.text.secondary;
        return (
          <View key={c.key} style={[s.highlightChip, { borderColor: color + '55' }]}>
            <View style={[s.highlightDot, { backgroundColor: color }]} />
            <Text style={[s.highlightText, { color }]}>
              {c.count} {c.count === 1 ? c.singular : c.plural}
            </Text>
          </View>
        );
      })}
    </View>
  ) : null}
```

2. Restyle to the feed-card language (only these style values change):

```js
    card: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderRadius: 10,          // was 8 — matches FeedRoundCard
      borderWidth: 1,
      gap: 10,
      padding: 14,               // was 12 — matches FeedRoundCard
    },
    playerPill: {                // winner pill goes accent, like the feed's statusPill
      backgroundColor: theme.accent.light,
      borderRadius: 999,
      maxWidth: '48%',
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    playerPillText: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 11,
    },
    stat: {                      // stat tiles pick up the Home gameStatsRow surface
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
      borderRadius: 10,
      flexBasis: '30%',
      flexGrow: 1,
      minWidth: 74,
      paddingHorizontal: 8,
      paddingVertical: 8,
      alignItems: 'center',
    },
    statValue: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 15,
    },
    statLabel: {
      color: theme.text.muted,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 9,
      letterSpacing: 0.8,
      marginTop: 3,
      textTransform: 'uppercase',
    },
```

New styles:

```js
    highlightRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    highlightChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      borderRadius: 999, borderWidth: 1,
      paddingHorizontal: 8, paddingVertical: 4,
    },
    highlightDot: { width: 6, height: 6, borderRadius: 3 },
    highlightText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
```

- [ ] **Step 3: Run tests**

Run: `npx jest src/components/roundSummary src/screens/__tests__/RoundSummaryScreen.test.js && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/roundSummary
git commit -m "feat(round-summary): recap panel in feed-card style with score highlights row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test` — expected: all pass.
Run: `npm run lint` — expected: clean (warnings in new test files must be fixed).

- [ ] **Step 2: Runtime verify (main session)**

Use the project `verify` skill (Expo web + Playwright): open the feed, tap a round card, and screenshot each tab (Scorecard incl. Points toggle, Leaderboard, Photos, Comments) in light and dark theme; confirm the live scorecard and Home screen render unchanged. This step is executed by the main session, not a subagent.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(round-summary): runtime polish after verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
