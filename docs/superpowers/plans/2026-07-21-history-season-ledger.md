# History Tab — Season Ledger + Champions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the History tab as a single chronological, month-grouped timeline where every row shows a date block, avatar circles, and the user's result — and tournament rows carry a champion footer naming the winner with the user's placement pill.

**Architecture:** A new pure store module `src/store/historyModel.js` turns finished tournaments into presentation-ready row models and month sections (all domain logic — "me" matching, champion/placement resolution via the existing leaderboard resolvers, date grouping — lives there, fully unit-tested). A new presentational component `src/components/HistoryRow.js` renders one row from a model. `HistoryScreen.js` is refactored to: condensed record strip → filter chips → month sections of `HistoryRow`s, with delete moved from an always-visible trash button to long-press → existing confirm modal.

**Tech Stack:** React Native (Expo SDK 54) + react-native-web, Jest via jest-expo (`npx jest <path>` for a single file), `@testing-library/react-native`, react-native-reanimated (globally mocked in jest.config.js — no per-test mocks needed).

**Approved design:** scratchpad mockup `history-hybrid.html` (Season Ledger + champion footer + avatar stacks). The mockup states are: game row (single-decker), tournament won (gold WON badge + "Champion · You" footer + gold "1st of 8" pill), tournament placed 2nd (green podium pill), tournament lost to another player (neutral "3rd of 6" pill).

## Global Constraints

- **Quiet-clubhouse color grammar (project standard):** gold is earned-only (wins/champions: `semantic.winner`), Masters red `theme.destructive` is destructive-only, everything else green/neutral. Never introduce a new red.
- **Fonts:** display/serif = `PlayfairDisplay-*`, UI/sans = `PlusJakartaSans-*` (same families the current screen uses).
- **Domain logic in stores, not screens** (CLAUDE.md) — the screen may not compute placements, initials, grouping, or champion; it only calls `historyModel`.
- **Lint is CI-blocking:** `npm run lint` must pass after every task.
- **Existing behavior preserved:** loading spinner, empty state, delete-with-confirm (owner only), realtime reload on `subscribeTournamentChanges`, navigation to `Tournament` route on row press.
- **Player identity fields:** embedded players use `user_id` (snake_case) and `name`; profile identity is `{ userId, displayName }`.
- Commit after every task; work happens on the feature branch of the worktree created at execution time.

---

### Task 1: `historyModel.js` — pure row models + month sections

**Files:**
- Create: `src/store/historyModel.js`
- Create: `src/store/__tests__/historyModel.test.js`
- Modify: `src/store/profileStore.js:144-157` (replace local `findMyPlayer` with a delegate to the new shared helper)

**Interfaces:**
- Consumes (all existing):
  - `tournamentLeaderboardResolved(tournament)` from `./tournamentStore` → `{ mode, unit: 'pts'|'holes', entries: [{ player, points, strokes?, ... }] }` (entries pre-sorted)
  - `roundTotals(round, players)` from `./scoring` → `[{ player, totalPoints, totalStrokes, ... }]`
  - `roundScoringMode(tournament, round)`, `isScrambleMode(mode)` from `./scoring`
  - `assignPlacements(rows, comparator)`, `comparatorForBoardMode(mode)` from `./leaderboardPlacement` → rows annotated with `place` (tie-aware)
- Produces (used by Tasks 2 and 3):
  - `playerInitials(name) → string` (2-char uppercase, `'?'` for empty)
  - `findPlayerForIdentity(players, { userId, displayName }) → player | null`
  - `placeLabel(place) → '1st' | '2nd' | '3rd' | '4th' | … | '11th' | '12th' | '13th' | '21st' …`
  - `historyEntryModel(tournament, identity) → model` where model is:
    ```
    {
      id, kind: 'game'|'tournament', title, when: number(ms),
      dateBox: { top: string, bottom: string },   // '13'/'JUL' or '3'/'ROUNDS'
      subtitle: string,                            // course name / 'N courses' / ''
      avatars: [{ initials: string, isMe: bool }], // max 4, roster order
      extraPlayers: number,                        // overflow beyond 4
      isOwner: bool,
      result: { kind: 'won', points } | { kind: 'placement', place, label, points }
            | { kind: 'points', points } | { kind: 'team' } | { kind: 'none' },
      champion: null | { name, isMe, points, unit },
      myPlacement: null | { place, label, points, fieldSize, won, podium },
    }
    ```
  - `buildHistorySections(tournaments, identity) → [{ key: 'YYYY-MM', label: 'July 2026', items: [model] }]` (sections and items sorted newest-first)

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/historyModel.test.js`:

```js
import {
  playerInitials, findPlayerForIdentity, placeLabel,
  historyEntryModel, buildHistorySections,
} from '../historyModel';

const P = (id, name, extra = {}) => ({ id, name, handicap: 0, ...extra });
const HOLE = { number: 1, par: 4, strokeIndex: 1 };

// Single-hole stableford game: me (3 pts) vs Bob (2 pts).
const game = {
  id: '1780000000001',
  kind: 'game',
  name: 'Casual 18',
  createdAt: '2026-06-07T10:00:00.000Z',
  finishedAt: '2026-06-07T15:00:00.000Z',
  _role: 'owner',
  settings: { scoringMode: 'stableford' },
  players: [P('me', 'Marcos', { user_id: 'u1' }), P('b', 'Noel')],
  rounds: [{
    id: 'r0',
    courseName: 'CCVM Negro',
    holes: [HOLE],
    pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
    playerHandicaps: {},
    scores: { me: { 1: 3 }, b: { 1: 4 } }, // 3 pts / 2 pts
  }],
};

// Two-round stableford tournament: me tops the board (6 pts vs 4).
const wonTournament = {
  id: '1780000000002',
  kind: 'tournament',
  name: 'Marbella Open',
  createdAt: '2026-06-19T09:00:00.000Z',
  finishedAt: '2026-06-21T18:00:00.000Z',
  _role: 'member',
  settings: { scoringMode: 'stableford' },
  players: [P('me', 'Marcos', { user_id: 'u1' }), P('b', 'Noel')],
  rounds: [
    {
      id: 'r0', courseName: 'Aloha', holes: [HOLE],
      pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
      playerHandicaps: {},
      scores: { me: { 1: 3 }, b: { 1: 4 } }, // 3 / 2
    },
    {
      id: 'r1', courseName: 'La Quinta', holes: [HOLE],
      pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
      playerHandicaps: {},
      scores: { me: { 1: 3 }, b: { 1: 4 } }, // 3 / 2
    },
  ],
  currentRound: 1,
};

// Same tournament shape but Noel wins and I come 2nd.
const lostTournament = {
  ...wonTournament,
  id: '1780000000003',
  name: 'Primavera Cup',
  createdAt: '2026-04-11T09:00:00.000Z',
  finishedAt: '2026-04-12T18:00:00.000Z',
  rounds: wonTournament.rounds.map((r) => ({
    ...r,
    scores: { me: { 1: 4 }, b: { 1: 3 } }, // 2 / 3 — Noel ahead
  })),
};

const identity = { userId: 'u1', displayName: 'Marcos' };

describe('playerInitials', () => {
  test('first two characters, uppercased', () => {
    expect(playerInitials('Claudio')).toBe('CL');
    expect(playerInitials('  javi ')).toBe('JA');
  });
  test('empty or missing name falls back to ?', () => {
    expect(playerInitials('')).toBe('?');
    expect(playerInitials(undefined)).toBe('?');
  });
});

describe('findPlayerForIdentity', () => {
  const players = [P('a', 'Ann', { user_id: 'ua' }), P('b', 'Bob')];
  test('prefers user_id match', () => {
    expect(findPlayerForIdentity(players, { userId: 'ua', displayName: 'Bob' }).id).toBe('a');
  });
  test('falls back to case-insensitive name match', () => {
    expect(findPlayerForIdentity(players, { displayName: '  bob ' }).id).toBe('b');
  });
  test('null when nothing matches', () => {
    expect(findPlayerForIdentity(players, { displayName: 'Zoe' })).toBeNull();
    expect(findPlayerForIdentity(players, {})).toBeNull();
  });
});

describe('placeLabel', () => {
  test('ordinal suffixes including the 11-13 exceptions', () => {
    expect(placeLabel(1)).toBe('1st');
    expect(placeLabel(2)).toBe('2nd');
    expect(placeLabel(3)).toBe('3rd');
    expect(placeLabel(4)).toBe('4th');
    expect(placeLabel(11)).toBe('11th');
    expect(placeLabel(12)).toBe('12th');
    expect(placeLabel(13)).toBe('13th');
    expect(placeLabel(21)).toBe('21st');
  });
});

describe('historyEntryModel — game', () => {
  test('date block, course subtitle, my points, no champion footer', () => {
    const m = historyEntryModel(game, identity);
    expect(m.kind).toBe('game');
    expect(m.dateBox).toEqual({ top: '7', bottom: 'JUN' });
    expect(m.subtitle).toBe('CCVM Negro');
    expect(m.result).toEqual({ kind: 'points', points: 3 });
    expect(m.champion).toBeNull();
    expect(m.isOwner).toBe(true);
    expect(m.avatars).toEqual([
      { initials: 'MA', isMe: true },
      { initials: 'NO', isMe: false },
    ]);
    expect(m.extraPlayers).toBe(0);
  });

  test('scramble game reports a team result instead of personal points', () => {
    const scramble = {
      ...game,
      id: '1780000000004',
      settings: { scoringMode: 'scramblepairs' },
      rounds: [{
        ...game.rounds[0],
        scoringMode: 'scramblepairs',
        pairs: [[P('me', 'Marcos'), P('b', 'Noel')]],
        scores: { me: { 1: 3 } },
      }],
    };
    expect(historyEntryModel(scramble, identity).result).toEqual({ kind: 'team' });
  });

  test('unknown identity yields a none result', () => {
    expect(historyEntryModel(game, { displayName: 'Stranger' }).result)
      .toEqual({ kind: 'none' });
  });
});

describe('historyEntryModel — tournament', () => {
  test('won: WON result, champion is me, gold-eligible placement', () => {
    const m = historyEntryModel(wonTournament, identity);
    expect(m.kind).toBe('tournament');
    expect(m.dateBox).toEqual({ top: '2', bottom: 'ROUNDS' });
    expect(m.subtitle).toBe('2 courses');
    expect(m.result).toEqual({ kind: 'won', points: 6 });
    expect(m.champion).toEqual({ name: 'Marcos', isMe: true, points: 6, unit: 'pts' });
    expect(m.myPlacement).toMatchObject({ place: 1, label: '1st', fieldSize: 2, won: true });
  });

  test('lost: placement result, champion is the other player', () => {
    const m = historyEntryModel(lostTournament, identity);
    expect(m.result).toEqual({ kind: 'placement', place: 2, label: '2nd', points: 4 });
    expect(m.champion).toEqual({ name: 'Noel', isMe: false, points: 6, unit: 'pts' });
    expect(m.myPlacement).toMatchObject({ place: 2, won: false, podium: true });
  });

  test('single distinct course shows its name; ROUND singular for one round', () => {
    const oneRound = {
      ...wonTournament,
      id: '1780000000005',
      rounds: [wonTournament.rounds[0], { ...wonTournament.rounds[1], courseName: 'Aloha' }],
    };
    expect(historyEntryModel(oneRound, identity).subtitle).toBe('Aloha');
    const single = { ...wonTournament, id: '1780000000006', rounds: [wonTournament.rounds[0]] };
    expect(historyEntryModel(single, identity).dateBox).toEqual({ top: '1', bottom: 'ROUND' });
  });
});

describe('buildHistorySections', () => {
  test('groups newest-first by month with human labels', () => {
    const sections = buildHistorySections([lostTournament, game, wonTournament], identity);
    expect(sections.map((s) => s.key)).toEqual(['2026-06', '2026-04']);
    expect(sections[0].label).toBe('June 2026');
    expect(sections[0].items.map((i) => i.id))
      .toEqual(['1780000000002', '1780000000001']); // Jun 21 before Jun 7
    expect(sections[1].items.map((i) => i.id)).toEqual(['1780000000003']);
  });

  test('falls back to the numeric id timestamp when dates are missing', () => {
    const bare = { ...game, id: '1750000000000', createdAt: undefined, finishedAt: undefined };
    const sections = buildHistorySections([bare], identity);
    expect(sections).toHaveLength(1);
    expect(sections[0].items[0].when).toBe(1750000000000);
  });
});
```

Note on `dateBox` expectations: `when` prefers `finishedAt`; `new Date(...).getDate()` / month formatting run in the test env's local timezone (dev machine here is Europe/Madrid) — the fixture times are midday UTC precisely so the calendar date is timezone-stable.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/historyModel.test.js`
Expected: FAIL — `Cannot find module '../historyModel'`

- [ ] **Step 3: Implement `src/store/historyModel.js`**

```js
import { tournamentLeaderboardResolved } from './tournamentStore';
import { roundTotals, roundScoringMode, isScrambleMode } from './scoring';
import { assignPlacements, comparatorForBoardMode } from './leaderboardPlacement';

// Pure presentation models for the History tab. Everything the screen
// renders per row is computed here so it stays unit-testable without UI.

const MAX_AVATARS = 4;

export function playerInitials(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 2).toUpperCase();
}

// Same resolution order as profileStore's me-matching: stamped user_id
// first, then a case-insensitive name match for legacy data.
export function findPlayerForIdentity(players, { userId, displayName } = {}) {
  const list = players ?? [];
  if (userId) {
    const byId = list.find((p) => p.user_id === userId);
    if (byId) return byId;
  }
  if (displayName) {
    const target = displayName.trim().toLowerCase();
    return list.find((p) => p.name.trim().toLowerCase() === target) ?? null;
  }
  return null;
}

export function placeLabel(place) {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  const mod10 = place % 10;
  if (mod10 === 1) return `${place}st`;
  if (mod10 === 2) return `${place}nd`;
  if (mod10 === 3) return `${place}rd`;
  return `${place}th`;
}

// finishedAt > createdAt > the numeric id (ids are Date.now() strings).
function entryTimestamp(t) {
  const parsed = Date.parse(t.finishedAt ?? t.createdAt ?? '');
  if (!Number.isNaN(parsed)) return parsed;
  const numericId = Number(t.id);
  return Number.isNaN(numericId) ? 0 : numericId;
}

function gameDateBox(when) {
  const d = new Date(when);
  return {
    top: String(d.getDate()),
    bottom: d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
  };
}

function tournamentSubtitle(tournament) {
  const names = [...new Set(
    (tournament.rounds ?? []).map((r) => r.courseName).filter(Boolean),
  )];
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.length} courses`;
}

function gameResult(tournament, me) {
  const round = tournament.rounds?.[0];
  if (!round) return { kind: 'none' };
  if (isScrambleMode(roundScoringMode(tournament, round))) return { kind: 'team' };
  if (!me) return { kind: 'none' };
  const mine = roundTotals(round, tournament.players ?? [])
    .find((e) => e.player.id === me.id);
  if (!mine || mine.totalStrokes === 0) return { kind: 'none' };
  return { kind: 'points', points: mine.totalPoints };
}

function tournamentStanding(tournament, me) {
  const board = tournamentLeaderboardResolved(tournament);
  const entries = board?.entries ?? [];
  if (entries.length === 0) return { champion: null, myPlacement: null };
  const placed = assignPlacements(entries, comparatorForBoardMode(board.mode));
  const top = placed[0];
  const champion = (top?.points ?? 0) > 0 && top?.player?.name
    ? {
      name: top.player.name,
      isMe: !!me && top.player.id === me.id,
      points: top.points,
      unit: board.unit,
    }
    : null;
  const myRow = me ? placed.find((r) => r.player?.id === me.id) : null;
  const myPlacement = myRow
    ? {
      place: myRow.place,
      label: placeLabel(myRow.place),
      points: myRow.points,
      fieldSize: entries.length,
      won: myRow.place === 1 && (myRow.points ?? 0) > 0,
      podium: myRow.place <= 3,
    }
    : null;
  return { champion, myPlacement };
}

export function historyEntryModel(tournament, identity = {}) {
  const isGame = tournament.kind === 'game';
  const me = findPlayerForIdentity(tournament.players, identity);
  const when = entryTimestamp(tournament);
  const players = tournament.players ?? [];
  const rounds = tournament.rounds ?? [];

  const base = {
    id: tournament.id,
    kind: isGame ? 'game' : 'tournament',
    title: tournament.name,
    when,
    avatars: players.slice(0, MAX_AVATARS).map((p) => ({
      initials: playerInitials(p.name),
      isMe: !!me && p.id === me.id,
    })),
    extraPlayers: Math.max(0, players.length - MAX_AVATARS),
    isOwner: tournament._role === 'owner',
  };

  if (isGame) {
    return {
      ...base,
      dateBox: gameDateBox(when),
      subtitle: rounds[0]?.courseName ?? 'Single round',
      result: gameResult(tournament, me),
      champion: null,
      myPlacement: null,
    };
  }

  const { champion, myPlacement } = tournamentStanding(tournament, me);
  let result = { kind: 'none' };
  if (myPlacement) {
    result = myPlacement.won
      ? { kind: 'won', points: myPlacement.points }
      : {
        kind: 'placement',
        place: myPlacement.place,
        label: myPlacement.label,
        points: myPlacement.points,
      };
  }
  return {
    ...base,
    dateBox: {
      top: String(rounds.length),
      bottom: rounds.length === 1 ? 'ROUND' : 'ROUNDS',
    },
    subtitle: tournamentSubtitle(tournament),
    result,
    champion,
    myPlacement,
  };
}

export function buildHistorySections(tournaments, identity = {}) {
  const models = (tournaments ?? [])
    .map((t) => historyEntryModel(t, identity))
    .sort((a, b) => b.when - a.when);
  const sections = [];
  let current = null;
  for (const model of models) {
    const d = new Date(model.when);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!current || current.key !== key) {
      current = {
        key,
        label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        items: [],
      };
      sections.push(current);
    }
    current.items.push(model);
  }
  return sections;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/historyModel.test.js`
Expected: PASS (all suites)

- [ ] **Step 5: Deduplicate profileStore's me-matching**

In `src/store/profileStore.js`, delete the local `findMyPlayer` function (lines 144-157, its comment included) and replace its single call site (`findMyPlayer(t, userId, displayName)` inside `computePersonalStats`) with the shared helper:

```js
import { findPlayerForIdentity } from './historyModel';
```

```js
    const me = findPlayerForIdentity(t.players, { userId, displayName });
```

(No import cycle: `historyModel` does not import `profileStore`.)

- [ ] **Step 6: Run neighboring suites to verify nothing broke**

Run: `npx jest src/store/__tests__/historyModel.test.js src/screens/__tests__/MyStatsScreen.test.js src/screens/__tests__/HistoryScreen.test.js`
Expected: PASS

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/store/historyModel.js src/store/__tests__/historyModel.test.js src/store/profileStore.js
git commit -m "feat(history): pure row/section models for the season-ledger History tab"
```

---

### Task 2: `HistoryRow` component

**Files:**
- Create: `src/components/HistoryRow.js`
- Create: `src/components/__tests__/HistoryRow.test.js`

**Interfaces:**
- Consumes: the `model` shape produced by `historyEntryModel` (Task 1), `PressableScale` (`src/components/ui/PressableScale.js`, props: `style`, `activeScale`, plus any `Pressable` props such as `onPress`/`onLongPress`/`accessibilityLabel`), `useTheme()` from `../theme/ThemeContext`, `semantic` from `../theme/tokens`, `Feather` from `@expo/vector-icons`.
- Produces: `export default function HistoryRow({ model, onPress, onLongPress })` — used by Task 3.

**Visual contract (from the approved mockup):**
- Single card, radius 18, `theme.bg.card` surface; main strip = date block (46×50, `theme.bg.secondary`; green-tinted `theme.accent.light` + green number for tournaments) · title (serif bold 15.5) · subtitle row (course text + avatar circles) · result column · chevron.
- Avatar circles: 20px, overlapping by −5, initials 7.5px extra-bold; "me" gets `theme.accent.primary` background with `theme.text.inverse` text; overflow renders one extra `+N` circle.
- Result column: `won` → gold pill "WON" (award icon) with points caption; `placement` → serif label (`2nd`) with `{points} pts` caption; `points` → serif green number with `pts` caption; `team` → `—` with `team` caption; `none` → `—` with `pts` caption.
- Champion footer (tournaments with `model.champion` only): hairline top border `theme.border.subtle`, surface `theme.isDark ? theme.bg.secondary : '#faf8f4'`, gold award icon, text `Champion · {You|name} · {points} {unit}` with the name segment gold+extra-bold; right side placement pill `"{label} of {fieldSize}"` — gold treatment when `myPlacement.won`, `theme.accent.light`+green when `podium`, neutral (`theme.bg.secondary` + `theme.text.secondary`) otherwise. No pill when `myPlacement` is null.
- Gold tokens: `const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;` `const goldBg = theme.isDark ? 'rgba(255,215,0,0.12)' : '#f7f0dd';` (mirrors the CoachHero fix-first badge treatment).

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/HistoryRow.test.js`:

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import HistoryRow from '../HistoryRow';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const wonModel = {
  id: 't1',
  kind: 'tournament',
  title: 'Marbella Open',
  when: 0,
  dateBox: { top: '3', bottom: 'ROUNDS' },
  subtitle: '3 courses',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'NO', isMe: false }],
  extraPlayers: 3,
  isOwner: true,
  result: { kind: 'won', points: 104 },
  champion: { name: 'Marcos', isMe: true, points: 104, unit: 'pts' },
  myPlacement: { place: 1, label: '1st', points: 104, fieldSize: 8, won: true, podium: true },
};

const gameModel = {
  id: 'g1',
  kind: 'game',
  title: 'Casual 18',
  when: 0,
  dateBox: { top: '7', bottom: 'JUN' },
  subtitle: 'CCVM Negro',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'NO', isMe: false }],
  extraPlayers: 0,
  isOwner: false,
  result: { kind: 'points', points: 29 },
  champion: null,
  myPlacement: null,
};

describe('HistoryRow', () => {
  test('won tournament renders WON badge, champion-as-You footer, and gold pill', () => {
    const { getByText } = render(wrap(<HistoryRow model={wonModel} onPress={() => {}} />));
    getByText('WON');
    getByText(/Champion ·/);
    getByText('You');
    getByText('1st of 8');
    getByText('+3'); // avatar overflow
  });

  test('game renders points and no champion footer', () => {
    const { getByText, queryByText } = render(wrap(<HistoryRow model={gameModel} onPress={() => {}} />));
    getByText('29');
    getByText('CCVM Negro');
    expect(queryByText(/Champion/)).toBeNull();
    expect(queryByText(/of \d/)).toBeNull();
  });

  test('press and long-press fire the callbacks', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const { getByLabelText } = render(wrap(
      <HistoryRow model={gameModel} onPress={onPress} onLongPress={onLongPress} />,
    ));
    const row = getByLabelText('Casual 18');
    fireEvent.press(row);
    fireEvent(row, 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/__tests__/HistoryRow.test.js`
Expected: FAIL — `Cannot find module '../HistoryRow'`

- [ ] **Step 3: Implement `src/components/HistoryRow.js`**

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from './ui/PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

// One History timeline row (game or tournament) rendered from a
// historyEntryModel. Tournaments with a resolved champion grow a footer
// strip naming the winner and the viewer's placement.
export default function HistoryRow({ model, onPress, onLongPress }) {
  const { theme } = useTheme();
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const goldBg = theme.isDark ? 'rgba(255,215,0,0.12)' : '#f7f0dd';
  const s = useMemo(() => makeStyles(theme, gold, goldBg), [theme, gold, goldBg]);

  const { result, champion, myPlacement } = model;

  return (
    <PressableScale
      style={s.card}
      activeScale={0.98}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={model.title}
      accessibilityHint={model.isOwner ? 'Opens the event. Long press to delete.' : 'Opens the event.'}
    >
      <View style={s.main}>
        <View style={[s.dateBox, model.kind === 'tournament' && s.dateBoxTournament]}>
          <Text style={[s.dateTop, model.kind === 'tournament' && s.dateTopTournament]}>
            {model.dateBox.top}
          </Text>
          <Text style={s.dateBottom}>{model.dateBox.bottom}</Text>
        </View>

        <View style={s.mid}>
          <Text style={s.title} numberOfLines={1}>{model.title}</Text>
          <View style={s.subline}>
            {model.subtitle ? (
              <Text style={s.subtitle} numberOfLines={1}>{model.subtitle}</Text>
            ) : null}
            <View style={s.avatars}>
              {model.avatars.map((a, i) => (
                <View
                  key={`${a.initials}-${i}`}
                  style={[s.avatar, i > 0 && s.avatarOverlap, a.isMe && s.avatarMe]}
                >
                  <Text style={[s.avatarText, a.isMe && s.avatarTextMe]}>{a.initials}</Text>
                </View>
              ))}
              {model.extraPlayers > 0 && (
                <View style={[s.avatar, s.avatarOverlap]}>
                  <Text style={s.avatarText}>{`+${model.extraPlayers}`}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={s.result}>
          {result.kind === 'won' && (
            <>
              <View style={s.wonBadge}>
                <Feather name="award" size={10} color={gold} />
                <Text style={s.wonBadgeText}>WON</Text>
              </View>
              <Text style={s.resultCaption}>{`${result.points} pts`}</Text>
            </>
          )}
          {result.kind === 'placement' && (
            <>
              <Text style={s.resultBig}>{result.label}</Text>
              <Text style={s.resultCaption}>{`${result.points} pts`}</Text>
            </>
          )}
          {result.kind === 'points' && (
            <>
              <Text style={s.resultBig}>{String(result.points)}</Text>
              <Text style={s.resultCaption}>pts</Text>
            </>
          )}
          {result.kind === 'team' && (
            <>
              <Text style={s.resultBig}>—</Text>
              <Text style={s.resultCaption}>team</Text>
            </>
          )}
          {result.kind === 'none' && (
            <>
              <Text style={s.resultBig}>—</Text>
              <Text style={s.resultCaption}>pts</Text>
            </>
          )}
        </View>

        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </View>

      {champion && (
        <View style={s.foot}>
          <View style={s.champ}>
            <Feather name="award" size={12} color={gold} />
            <Text style={s.champText} numberOfLines={1}>
              {'Champion · '}
              <Text style={s.champName}>{champion.isMe ? 'You' : champion.name}</Text>
              {` · ${champion.points} ${champion.unit}`}
            </Text>
          </View>
          {myPlacement && (
            <View style={[
              s.placePill,
              myPlacement.won ? s.placePillWon : (myPlacement.podium ? s.placePillPodium : null),
            ]}
            >
              <Text style={[
                s.placePillText,
                myPlacement.won ? s.placePillTextWon : (myPlacement.podium ? s.placePillTextPodium : null),
              ]}
              >
                {`${myPlacement.label} of ${myPlacement.fieldSize}`}
              </Text>
            </View>
          )}
        </View>
      )}
    </PressableScale>
  );
}

function makeStyles(theme, gold, goldBg) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 18,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border ?? theme.border.default : 'transparent',
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    main: {
      padding: 13, flexDirection: 'row', alignItems: 'center', gap: 13,
    },
    dateBox: {
      width: 46, height: 50, borderRadius: 12,
      backgroundColor: theme.bg.secondary,
      alignItems: 'center', justifyContent: 'center',
    },
    dateBoxTournament: { backgroundColor: theme.accent.light },
    dateTop: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, lineHeight: 20,
      color: theme.text.primary,
    },
    dateTopTournament: { color: theme.accent.primary },
    dateBottom: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 1,
      color: theme.text.muted, marginTop: 3,
    },
    mid: { flex: 1, minWidth: 0 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 15.5, color: theme.text.primary },
    subline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
    subtitle: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 11.5,
      color: theme.text.secondary, flexShrink: 1,
    },
    avatars: { flexDirection: 'row' },
    avatar: {
      width: 20, height: 20, borderRadius: 10,
      borderWidth: 1.5, borderColor: theme.bg.card,
      backgroundColor: theme.bg.secondary,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarOverlap: { marginLeft: -5 },
    avatarMe: { backgroundColor: theme.accent.primary },
    avatarText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 7.5, color: theme.text.secondary,
    },
    avatarTextMe: { color: theme.text.inverse },
    result: { alignItems: 'center', minWidth: 46, gap: 2 },
    resultBig: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 16, color: theme.accent.primary },
    resultCaption: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 0.6,
      color: theme.text.muted, textTransform: 'uppercase',
    },
    wonBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: goldBg, borderRadius: 999,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    wonBadgeText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10, color: gold,
    },
    foot: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderTopWidth: 1, borderTopColor: theme.border.subtle,
      backgroundColor: theme.isDark ? theme.bg.secondary : '#faf8f4',
      paddingVertical: 8, paddingHorizontal: 14,
    },
    champ: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    champText: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11.5, color: theme.text.secondary,
    },
    champName: { color: gold, fontFamily: 'PlusJakartaSans-ExtraBold' },
    placePill: {
      backgroundColor: theme.bg.secondary, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 3,
    },
    placePillWon: { backgroundColor: goldBg },
    placePillPodium: { backgroundColor: theme.accent.light },
    placePillText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 10.5, color: theme.text.secondary,
    },
    placePillTextWon: { color: gold },
    placePillTextPodium: { color: theme.accent.primary },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/__tests__/HistoryRow.test.js`
Expected: PASS

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/components/HistoryRow.js src/components/__tests__/HistoryRow.test.js
git commit -m "feat(history): HistoryRow card with champion footer and avatar stack"
```

---

### Task 3: HistoryScreen refactor — record strip, filter chips, month sections, long-press delete

**Files:**
- Modify: `src/screens/HistoryScreen.js` (rewrite of the render path; keep `confirm`/`ConfirmModal`, `reload`, focus-effect subscription, `openTournament`, `confirmDelete` logic)
- Modify: `src/screens/__tests__/HistoryScreen.test.js` (delete moves to long-press; new content assertions)

**Interfaces:**
- Consumes: `buildHistorySections(tournaments, { userId, displayName })` (Task 1), `HistoryRow` (Task 2), `Reveal` (`src/components/ui/Reveal.js`, props `{ delay, dy, duration, style, children }` — plays on mount), plus everything the screen already imports.
- Produces: no new exports — screen behavior only. Record-strip press navigates via `navigation.navigate('MyStats')` (tab route name from `App.js` `TAB_SCREENS`).

**Screen layout (top to bottom):**
1. Header title `History` (unchanged).
2. **Record strip** (only when `stats?.roundsPlayed > 0`): one card row of four cells — Rounds / Wins (gold value) / Avg pts (`avgPointsPerRound.toFixed(1)`) / Best (`bestRound?.points ?? '—'`) — separated by hairline dividers, trailing chevron; pressable → `navigation.navigate('MyStats')`. Replaces the six-tile `YOUR RECORD` grid.
3. **Filter chips**: `All` / `Tournaments` / `Games` — local state `filter: 'all' | 'tournament' | 'game'`; chips filter the list before section building; active chip = green fill + inverse text; no animation on switch.
4. **Month sections**: for each section from `buildHistorySections` — overline label (existing `sectionLabel` style) then its `HistoryRow`s, each wrapped in `Reveal` with `delay={Math.min(rowIndex * 30, 300)}` (a single running row index across sections, so the whole list staggers once on mount).
5. Existing empty state when there are no finished events at all; when a filter empties the list, show the empty state with the copy `Nothing in this filter yet.` as the subtitle instead.
6. `ConfirmModal` unchanged. Delete = `onLongPress` on owner rows → existing `confirmDelete(t)`.

`CardGrid` and `IconButton` imports are removed (single-column timeline replaces the grid; trash button replaced by long-press).

- [ ] **Step 1: Rewrite the screen test**

Replace `src/screens/__tests__/HistoryScreen.test.js` with the suite below (keeps the existing mock style; fixtures now carry real single-hole scoring data so the historyModel chain computes real results):

```js
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import HistoryScreen from '../HistoryScreen';
import { deleteTournament } from '../../store/tournamentStore';

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (effect) => {
      React.useEffect(effect, [effect]);
    },
  };
});

const GAME = {
  id: '1780001519615',
  name: '28 May game',
  kind: 'game',
  _role: 'owner',
  createdAt: '2026-05-28T10:00:00.000Z',
  finishedAt: '2026-05-28T20:54:37.232Z',
  settings: { scoringMode: 'stableford' },
  players: [
    { id: 'p1', name: 'Marcos', user_id: 'u1', handicap: 0 },
    { id: 'p2', name: 'Noel', handicap: 0 },
  ],
  rounds: [{
    id: 'r0',
    courseName: 'Real Club de Golf Lomas-Bosque',
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs: [[{ id: 'p1', name: 'Marcos' }], [{ id: 'p2', name: 'Noel' }]],
    playerHandicaps: {},
    scores: { p1: { 1: 3 }, p2: { 1: 4 } },
  }],
};

const TOURNAMENT = {
  id: '1780001519616',
  name: 'June Cup',
  kind: 'tournament',
  _role: 'member',
  createdAt: '2026-06-01T10:00:00.000Z',
  finishedAt: '2026-06-02T18:00:00.000Z',
  settings: { scoringMode: 'stableford' },
  players: [
    { id: 'p1', name: 'Marcos', user_id: 'u1', handicap: 0 },
    { id: 'p2', name: 'Noel', handicap: 0 },
  ],
  rounds: [{
    id: 'r0',
    courseName: 'Retamares',
    holes: [{ number: 1, par: 4, strokeIndex: 1 }],
    pairs: [[{ id: 'p1', name: 'Marcos' }], [{ id: 'p2', name: 'Noel' }]],
    playerHandicaps: {},
    scores: { p1: { 1: 3 }, p2: { 1: 4 } },
  }],
  currentRound: 0,
};

jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    loadAllTournamentsWithFallback: jest.fn(() => Promise.resolve({ list: [] })),
    isTournamentFinished: jest.fn(() => true),
    subscribeTournamentChanges: jest.fn(() => jest.fn()),
    deleteTournament: jest.fn(() => Promise.resolve()),
  };
});

jest.mock('../../store/profileStore', () => ({
  loadProfile: jest.fn(() => Promise.resolve({ userId: 'u1', displayName: 'Marcos' })),
  computePersonalStats: jest.fn(() => Promise.resolve({
    tournamentsPlayed: 3, roundsPlayed: 12, totalPoints: 360,
    avgPointsPerRound: 30, bestRound: { points: 41 }, wins: 2,
  })),
}));

const { loadAllTournamentsWithFallback } = require('../../store/tournamentStore');

describe('HistoryScreen', () => {
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    loadAllTournamentsWithFallback.mockResolvedValue({ list: [GAME, TOURNAMENT] });
  });

  afterEach(() => {
    if (Alert.alert.mockRestore) Alert.alert.mockRestore();
  });

  test('renders month sections newest-first with rows inside', async () => {
    const { findByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    await findByText('JUNE 2026');
    await findByText('MAY 2026');
    await findByText('June Cup');
    await findByText('28 May game');
  });

  test('record strip shows the condensed stats and opens My Stats', async () => {
    const navigation = { navigate: jest.fn() };
    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={navigation} />,
    ));
    await findByText('12'); // rounds
    await findByText('30.0'); // avg
    const strip = await findByLabelText('Your record. Opens My Stats.');
    fireEvent.press(strip);
    expect(navigation.navigate).toHaveBeenCalledWith('MyStats');
  });

  test('filter chips narrow the timeline', async () => {
    const { findByText, queryByText, getByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    await findByText('June Cup');
    fireEvent.press(getByText('Games'));
    expect(queryByText('June Cup')).toBeNull();
    expect(getByText('28 May game')).toBeTruthy();
    fireEvent.press(getByText('Tournaments'));
    expect(queryByText('28 May game')).toBeNull();
    expect(getByText('June Cup')).toBeTruthy();
  });

  test('long-press on an owned row confirms then deletes', async () => {
    const { findByLabelText, findByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    const row = await findByLabelText('28 May game');
    fireEvent(row, 'longPress');
    const confirmBtn = await findByText('Delete');
    fireEvent.press(confirmBtn);
    await waitFor(() => expect(deleteTournament).toHaveBeenCalledWith('1780001519615'));
  });

  test('long-press on a non-owned row does nothing', async () => {
    const { findByLabelText, queryByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    const row = await findByLabelText('June Cup');
    fireEvent(row, 'longPress');
    expect(queryByText('Delete')).toBeNull();
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  test('tapping a row opens the tournament', async () => {
    const navigation = { navigate: jest.fn() };
    const { findByLabelText } = render(wrap(
      <HistoryScreen navigation={navigation} />,
    ));
    fireEvent.press(await findByLabelText('June Cup'));
    expect(navigation.navigate).toHaveBeenCalledWith('Tournament', {
      tournamentId: '1780001519616', viewMode: 'tournament',
    });
  });

  test('empty archive shows the empty state', async () => {
    loadAllTournamentsWithFallback.mockResolvedValue({ list: [] });
    const { findByText } = render(wrap(
      <HistoryScreen navigation={{ navigate: jest.fn() }} />,
    ));
    await findByText('No history yet');
  });
});
```

Notes for the implementer:
- The `tournamentStore` mock uses `jest.requireActual` so `tournamentLeaderboardResolved` and the scoring chain run for real against the fixtures — only async/IO functions are stubbed. If `jest.requireActual('../../store/tournamentStore')` fails in the jest env because of a transitive import (e.g. the supabase client reading env), stub that transitive module the way existing store tests do — check `src/store/__tests__/loadTournamentCached.test.js` for the established supabase mock pattern and copy it. Do NOT mock `historyModel` itself.
- The month labels are rendered uppercased in source (`section.label.toUpperCase()`), so `findByText('JUNE 2026')` matches the rendered string directly.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npx jest src/screens/__tests__/HistoryScreen.test.js`
Expected: FAIL (old screen: no month sections, no record-strip label, delete is a visible button)

- [ ] **Step 3: Rewrite `src/screens/HistoryScreen.js`**

Full replacement for the component body (keep `ConfirmModal` and the confirm-promise machinery verbatim from the current file):

```js
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
  Alert, Modal, Pressable,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import HistoryRow from '../components/HistoryRow';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadAllTournamentsWithFallback, isTournamentFinished,
  subscribeTournamentChanges, deleteTournament, tournamentNounCapitalized,
} from '../store/tournamentStore';
import { loadProfile, computePersonalStats } from '../store/profileStore';
import { buildHistorySections } from '../store/historyModel';
import { semantic } from '../theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'tournament', label: 'Tournaments' },
  { key: 'game', label: 'Games' },
];

// History tab: a condensed record strip, filter chips, and the archive of
// finished games and tournaments as one month-grouped timeline.
export default function HistoryScreen({ navigation }) {
  const { theme } = useTheme();
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const s = useMemo(() => makeStyles(theme, gold), [theme, gold]);

  const [finished, setFinished] = useState([]);
  const [identity, setIdentity] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);
  const confirm = useCallback(({ title, message, confirmLabel = 'Confirm', destructive = false }) => (
    new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ title, message, confirmLabel, destructive });
    })
  ), []);
  const resolveConfirm = useCallback((result) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(result);
  }, []);

  const reload = useCallback(async () => {
    try {
      const { list } = await loadAllTournamentsWithFallback();
      setFinished(list.filter((t) => isTournamentFinished(t)));
      try {
        const profile = await loadProfile();
        if (profile?.userId || profile?.displayName) {
          const id = { userId: profile?.userId, displayName: profile?.displayName };
          setIdentity(id);
          setStats(await computePersonalStats(id));
        }
      } catch { /* stats are best-effort */ }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    reload();
    const unsub = subscribeTournamentChanges(() => { if (!cancelled) reload(); });
    return () => { cancelled = true; unsub(); };
  }, [reload]));

  function openTournament(id) {
    navigation.navigate('Tournament', { tournamentId: id, viewMode: 'tournament' });
  }

  async function confirmDelete(t) {
    const confirmed = await confirm({
      title: `Delete ${tournamentNounCapitalized(t)}`,
      message: `Delete "${t.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteTournament(t.id);
      await reload();
    } catch (err) {
      const msg = err?.message ?? 'Could not delete';
      Alert.alert('Error', msg);
    }
  }

  const filtered = useMemo(() => (
    filter === 'all'
      ? finished
      : finished.filter((t) => (filter === 'game' ? t.kind === 'game' : t.kind !== 'game'))
  ), [finished, filter]);

  const sections = useMemo(
    () => buildHistorySections(filtered, identity),
    [filtered, identity],
  );
  const byId = useMemo(
    () => Object.fromEntries(finished.map((t) => [t.id, t])),
    [finished],
  );

  const recordCells = stats ? [
    { label: 'Rounds', value: String(stats.roundsPlayed) },
    { label: 'Wins', value: String(stats.wins), gold: true },
    { label: 'Avg pts', value: stats.roundsPlayed > 0 ? stats.avgPointsPerRound.toFixed(1) : '—' },
    { label: 'Best', value: stats.bestRound ? String(stats.bestRound.points) : '—' },
  ] : [];

  let rowIndex = -1;

  return (
    <ScreenContainer style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>History</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {stats && stats.roundsPlayed > 0 && (
            <PressableScale
              style={s.recordStrip}
              activeScale={0.98}
              onPress={() => navigation.navigate('MyStats')}
              accessibilityRole="button"
              accessibilityLabel="Your record. Opens My Stats."
            >
              {recordCells.map((c, i) => (
                <React.Fragment key={c.label}>
                  {i > 0 && <View style={s.recordDivider} />}
                  <View style={s.recordCell}>
                    <Text style={[s.recordValue, c.gold && s.recordValueGold]}>{c.value}</Text>
                    <Text style={s.recordLabel}>{c.label}</Text>
                  </View>
                </React.Fragment>
              ))}
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </PressableScale>
          )}

          <View style={s.chips}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[s.chip, filter === f.key && s.chipOn]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f.key }}
              >
                <Text style={[s.chipText, filter === f.key && s.chipTextOn]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {sections.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="clock" size={44} color={theme.text.muted} />
              <Text style={s.emptyTitle}>No history yet</Text>
              <Text style={s.emptySub}>
                {finished.length === 0
                  ? 'Finished games and tournaments will be archived here.'
                  : 'Nothing in this filter yet.'}
              </Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.key}>
                <Text style={s.sectionLabel}>{section.label.toUpperCase()}</Text>
                {section.items.map((model) => {
                  rowIndex += 1;
                  const t = byId[model.id];
                  return (
                    <Reveal
                      key={model.id}
                      delay={Math.min(rowIndex * 30, 300)}
                      dy={8}
                      duration={250}
                      style={s.rowWrap}
                    >
                      <HistoryRow
                        model={model}
                        onPress={() => openTournament(model.id)}
                        onLongPress={model.isOwner && t ? () => confirmDelete(t) : undefined}
                      />
                    </Reveal>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      )}
      <ConfirmModal state={confirmState} onResult={resolveConfirm} theme={theme} s={s} />
    </ScreenContainer>
  );
}
```

`ConfirmModal` stays exactly as in the current file. `makeStyles` loses its `statColumns` parameter (signature becomes `makeStyles(theme, gold)`), drops the old `statsGrid`/`statCell`/`statValue`/`statLabel`/`cardWrapper`/`card`/`cardWithDelete`/`cardName`/`cardMeta`/`cardRound`/`deleteBtn` styles, keeps container/header/headerTitle/center/content/sectionLabel/emptyState/emptyTitle/emptySub/confirm* unchanged, and adds:

```js
    recordStrip: {
      marginTop: 6, marginBottom: 4, paddingVertical: 13, paddingHorizontal: 16,
      backgroundColor: theme.bg.card, borderRadius: 16,
      borderWidth: 1, borderColor: theme.border.default,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    recordCell: { alignItems: 'center', flex: 1 },
    recordValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary },
    recordValueGold: { color: gold },
    recordLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 0.8,
      color: theme.text.muted, marginTop: 2, textTransform: 'uppercase',
    },
    recordDivider: { width: 1, height: 26, backgroundColor: theme.border.default },
    chips: { flexDirection: 'row', gap: 8, paddingTop: 14, paddingBottom: 2 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
      borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.bg.card,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.secondary,
    },
    chipTextOn: { color: theme.text.inverse },
    rowWrap: { marginBottom: 10 },
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx jest src/screens/__tests__/HistoryScreen.test.js`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Run the full test suite and lint**

Run: `npx jest` then `npm run lint`
Expected: full suite green, lint clean. (If unrelated suites fail from nested-worktree scanning, verify you are inside the isolated worktree — jest there scans only its own tree.)

- [ ] **Step 6: Commit**

```bash
git add src/screens/HistoryScreen.js src/screens/__tests__/HistoryScreen.test.js
git commit -m "feat(history): season-ledger timeline with record strip, filters, and long-press delete"
```

---

## Self-Review Notes

- **Spec coverage:** merged timeline + month groups (Task 1 sections, Task 3 render), date blocks (Task 1 `dateBox`, Task 2 render), avatar circles with green "me" + overflow (Tasks 1/2), result column incl. gold WON (Tasks 1/2), champion footer + placement pill with quiet-clubhouse tones (Tasks 1/2), record strip → My Stats (Task 3), filter chips (Task 3), long-press delete replacing the trash button (Task 3), stagger/press motion via existing `Reveal`/`PressableScale` (Tasks 2/3), empty states incl. filtered-empty copy (Task 3). Deferred by design: search, swipe-to-delete, "Won" filter (Option C features not in the approved hybrid).
- **Type consistency:** the `model` shape is defined once in Task 1 and consumed verbatim in Tasks 2/3; `buildHistorySections(tournaments, identity)` signature identical across tasks; `findPlayerForIdentity(players, { userId, displayName })` matches the profileStore rewrite.
- **Placeholders:** none — all steps carry full code or exact commands.
