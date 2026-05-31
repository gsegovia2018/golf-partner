# Quick Start Favorite Courses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Play-screen quick-start rail for favorited courses that opens a player-selection sheet and creates a single-round game with course, tee, handicap, scoring, and routing defaults filled automatically.

**Architecture:** Put quick-start game construction in a pure helper module, `src/lib/quickStartGame.js`, so `HomeScreen` does not duplicate setup wizard creation logic. Add a focused `QuickStartCourses` presentational component for the rail and sheet, then wire data loading, save/start, post-create invite, and edit-details navigation from `HomeScreen`. Extend `SetupScreen` only enough to accept a prefilled game state and initial step for the `Edit details` path.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, React Navigation, Supabase-backed store helpers, Jest with `jest-expo`.

---

## File Structure

- Create `src/lib/quickStartGame.js`: pure game-name, round, tee-default, and tournament-draft helpers.
- Create `src/lib/__tests__/quickStartGame.test.js`: focused tests for tee defaulting, round copying, handicap derivation, and pairs.
- Modify `src/screens/setupWizard.js`: add a tiny pure `initialStepIndex` helper for prefilled setup navigation.
- Modify `src/screens/__tests__/setupWizard.test.js`: cover `initialStepIndex`.
- Modify `src/screens/SetupScreen.js`: consume `route.params.prefill` and `route.params.initialStep`.
- Create `src/components/QuickStartCourses.js`: favorite-course rail and player-selection sheet.
- Create `src/components/__tests__/QuickStartCourses.test.js`: cover exported pure helpers used by the component.
- Modify `src/screens/HomeScreen.js`: load favorite courses and players, render quick start, resolve tee history, create the game, route to scorecard, and route to setup for `Edit details`.

---

### Task 1: Add Quick-Start Game Helpers

**Files:**
- Create: `src/lib/quickStartGame.js`
- Create: `src/lib/__tests__/quickStartGame.test.js`

- [ ] **Step 1: Write the failing helper tests**

Create `src/lib/__tests__/quickStartGame.test.js`:

```js
import {
  buildQuickStartGameName,
  courseToQuickStartRound,
  resolveQuickStartPlayerTees,
  buildQuickStartTournamentDraft,
} from '../quickStartGame';

const tees = [
  { label: 'Black', slope: 140, rating: 73.2 },
  { label: 'White', slope: 128, rating: 70.4 },
  { label: 'Yellow', slope: 118, rating: 68.6 },
  { label: 'Red', slope: 110, rating: 66.1 },
];

const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: i % 6 === 0 ? 5 : i % 3 === 0 ? 3 : 4,
  strokeIndex: i + 1,
}));

const course = {
  id: 'course-1',
  name: 'Sant Cugat',
  holes,
  tees,
};

const players = [
  { id: 'p1', name: 'Marcos', handicap: 12.4, user_id: 'u-me' },
  { id: 'p2', name: 'Alex', handicap: 8.7, user_id: 'u-alex' },
  { id: 'p3', name: 'Dani', handicap: 17.2, user_id: null },
];

describe('buildQuickStartGameName', () => {
  test('uses course name and short date stamp', () => {
    const date = new Date('2026-06-01T10:00:00Z');
    expect(buildQuickStartGameName('Sant Cugat', date)).toBe('Sant Cugat · 1 Jun');
  });

  test('truncates long course names consistently with setup games', () => {
    const date = new Date('2026-06-01T10:00:00Z');
    expect(buildQuickStartGameName('Very Long Golf Course Name Here', date))
      .toBe('Very Long Golf Course… · 1 Jun');
  });
});

describe('courseToQuickStartRound', () => {
  test('copies a complete course without sharing hole or tee references', () => {
    const round = courseToQuickStartRound(course);
    expect(round).toMatchObject({
      courseId: 'course-1',
      courseName: 'Sant Cugat',
      tees,
    });
    expect(round.holes).toEqual(holes);
    expect(round.holes).not.toBe(holes);
    expect(round.holes[0]).not.toBe(holes[0]);
    expect(round.tees).not.toBe(tees);
    expect(round.tees[0]).not.toBe(tees[0]);
  });

  test('falls back to default 18 holes when course hole data is incomplete', () => {
    const round = courseToQuickStartRound({ ...course, holes: holes.slice(0, 9) });
    expect(round.holes).toHaveLength(18);
    expect(round.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 1 });
  });
});

describe('resolveQuickStartPlayerTees', () => {
  test('keeps a player own last-used tee', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: players.slice(0, 1),
      currentUserId: 'u-me',
      lastTeeByPlayer: { p1: { label: 'White', slope: 125, rating: 70 } },
    });
    expect(out).toEqual({ p1: { label: 'White', slope: 128, rating: 70.4 } });
  });

  test('gives players without history the group tee when one player has history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: players.slice(0, 2),
      currentUserId: 'u-me',
      lastTeeByPlayer: { p1: { label: 'Yellow', slope: 117, rating: 68 } },
    });
    expect(out).toEqual({
      p1: { label: 'Yellow', slope: 118, rating: 68.6 },
      p2: { label: 'Yellow', slope: 118, rating: 68.6 },
    });
  });

  test('uses the most common history tee for players without history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: [
        ...players,
        { id: 'p4', name: 'Sam', handicap: 20, user_id: null },
      ],
      currentUserId: 'u-me',
      lastTeeByPlayer: {
        p1: { label: 'White' },
        p2: { label: 'Yellow' },
        p3: { label: 'Yellow' },
      },
    });
    expect(out.p4).toEqual({ label: 'Yellow', slope: 118, rating: 68.6 });
  });

  test('breaks tied group tees with the signed-in user tee', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId: 'u-me',
      lastTeeByPlayer: {
        p1: { label: 'White' },
        p2: { label: 'Yellow' },
      },
    });
    expect(out.p3).toEqual({ label: 'White', slope: 128, rating: 70.4 });
  });

  test('breaks tied group tees by course tee order when current user has no tied history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId: 'u-missing',
      lastTeeByPlayer: {
        p1: { label: 'White' },
        p2: { label: 'Yellow' },
      },
    });
    expect(out.p3).toEqual({ label: 'White', slope: 128, rating: 70.4 });
  });

  test('falls back to the middle named tee when nobody has history', () => {
    const out = resolveQuickStartPlayerTees({
      course,
      players: players.slice(0, 2),
      currentUserId: 'u-me',
      lastTeeByPlayer: {},
    });
    expect(out).toEqual({
      p1: { label: 'Yellow', slope: 118, rating: 68.6 },
      p2: { label: 'Yellow', slope: 118, rating: 68.6 },
    });
  });

  test('returns an empty map when the course has no named tees', () => {
    const out = resolveQuickStartPlayerTees({
      course: { ...course, tees: [{ label: '', slope: 113, rating: 72 }] },
      players,
      currentUserId: 'u-me',
      lastTeeByPlayer: { p1: { label: '' } },
    });
    expect(out).toEqual({});
  });
});

describe('buildQuickStartTournamentDraft', () => {
  test('builds a single-round game with resolved tees and playing handicaps', () => {
    const draft = buildQuickStartTournamentDraft({
      course,
      players: players.slice(0, 2),
      playerTees: {
        p1: { label: 'White', slope: 128, rating: 70.4 },
        p2: { label: 'White', slope: 128, rating: 70.4 },
      },
      settings: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
      userId: 'u-me',
      now: new Date('2026-06-01T10:00:00Z'),
    });
    expect(draft.kind).toBe('game');
    expect(draft.name).toBe('Sant Cugat · 1 Jun');
    expect(draft.meId).toBe('p1');
    expect(draft.players).toEqual(players.slice(0, 2));
    expect(draft.rounds).toHaveLength(1);
    expect(draft.rounds[0]).toMatchObject({
      id: 'r0',
      courseId: 'course-1',
      courseName: 'Sant Cugat',
      playerTees: {
        p1: { label: 'White', slope: 128, rating: 70.4 },
        p2: { label: 'White', slope: 128, rating: 70.4 },
      },
      manualHandicaps: {},
      scores: {},
      notes: '',
      pairs: [[players[0]], [players[1]]],
    });
    expect(draft.rounds[0].playerHandicaps.p1).toEqual(expect.any(Number));
    expect(draft.rounds[0].playerHandicaps.p2).toEqual(expect.any(Number));
  });

  test('uses team pairs when the scoring mode supports partners for the roster', () => {
    const four = [
      ...players,
      { id: 'p4', name: 'Sam', handicap: 20, user_id: null },
    ];
    const draft = buildQuickStartTournamentDraft({
      course,
      players: four,
      playerTees: {},
      settings: { scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1 },
      userId: 'u-me',
      now: new Date('2026-06-01T10:00:00Z'),
    });
    expect(draft.rounds[0].pairs).toHaveLength(2);
    expect(draft.rounds[0].pairs.flat()).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/lib/__tests__/quickStartGame.test.js --runInBand
```

Expected: FAIL because `src/lib/quickStartGame.js` does not exist.

- [ ] **Step 3: Implement the helper module**

Create `src/lib/quickStartGame.js`:

```js
import { defaultHoles } from '../store/libraryStore';
import {
  createTournament,
  DEFAULT_SETTINGS,
  deriveRoundPlayingHandicap,
  randomPairs,
} from '../store/tournamentStore';
import { middleTee, teeByLabel } from '../store/tees';
import { fallbackScoringMode, isScoringModeAllowed, scoringModeUsesTeams } from '../components/scoringModes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COURSE_NAME_MAX = 22;

function cloneHoles(holes) {
  return (holes ?? []).map((h) => ({ ...h }));
}

function cloneTees(tees) {
  return (tees ?? []).map((t) => ({ ...t }));
}

function namedTees(tees) {
  return (tees ?? []).filter((t) => String(t?.label ?? '').trim());
}

function teeSnapshot(tee) {
  return tee ? { label: tee.label, slope: tee.slope, rating: tee.rating } : null;
}

function teeOrderIndex(tees, label) {
  const key = String(label ?? '').trim().toLowerCase();
  const idx = tees.findIndex((t) => String(t?.label ?? '').trim().toLowerCase() === key);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function validHistoryTee(tees, history) {
  return teeSnapshot(teeByLabel(tees, history?.label));
}

export function buildQuickStartGameName(courseName, date = new Date()) {
  const stamp = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const trimmed = String(courseName ?? '').trim();
  if (!trimmed) return `Game · ${stamp}`;
  const shortCourse = trimmed.length > COURSE_NAME_MAX
    ? `${trimmed.slice(0, COURSE_NAME_MAX - 1).trimEnd()}…`
    : trimmed;
  return `${shortCourse} · ${stamp}`;
}

export function courseToQuickStartRound(course) {
  const holes = Array.isArray(course?.holes) && course.holes.length === 18
    ? cloneHoles(course.holes)
    : defaultHoles();
  return {
    courseId: course?.id ?? null,
    courseName: String(course?.name ?? '').trim(),
    holes,
    tees: cloneTees(course?.tees),
    slope: course?.slope ?? null,
    courseRating: course?.rating ?? null,
    playerHandicaps: null,
    playerTees: null,
    manualHandicaps: {},
  };
}

export function resolveQuickStartPlayerTees({
  course,
  players = [],
  currentUserId = null,
  lastTeeByPlayer = {},
}) {
  const courseTees = namedTees(course?.tees);
  if (players.length === 0 || courseTees.length === 0) return {};

  const playerHistory = players.map((player) => ({
    player,
    tee: validHistoryTee(courseTees, lastTeeByPlayer[player.id]),
  }));
  const histories = playerHistory.filter((entry) => entry.tee);

  let groupTee = null;
  if (histories.length > 0) {
    const counts = new Map();
    histories.forEach(({ tee }) => {
      counts.set(tee.label, (counts.get(tee.label) ?? 0) + 1);
    });
    const maxCount = Math.max(...counts.values());
    const tiedLabels = [...counts.entries()]
      .filter(([, count]) => count === maxCount)
      .map(([label]) => label);
    const currentUserHistory = histories.find(({ player }) => player.user_id === currentUserId);
    const preferredLabel = currentUserHistory && tiedLabels.includes(currentUserHistory.tee.label)
      ? currentUserHistory.tee.label
      : tiedLabels.sort((a, b) => teeOrderIndex(courseTees, a) - teeOrderIndex(courseTees, b))[0];
    groupTee = teeSnapshot(teeByLabel(courseTees, preferredLabel));
  } else {
    groupTee = teeSnapshot(middleTee(courseTees));
  }

  if (!groupTee) return {};
  return Object.fromEntries(
    playerHistory.map(({ player, tee }) => [player.id, tee ?? groupTee]),
  );
}

export function buildQuickStartRound({ course, players, playerTees }) {
  const base = courseToQuickStartRound(course);
  const roundWithTees = {
    ...base,
    playerTees: Object.keys(playerTees ?? {}).length > 0 ? playerTees : null,
  };
  const playerHandicaps = Object.fromEntries(
    players.map((p) => [p.id, deriveRoundPlayingHandicap(p.handicap, roundWithTees, p.id)]),
  );
  return {
    ...roundWithTees,
    id: 'r0',
    playerHandicaps,
    playerTees: roundWithTees.playerTees,
    manualHandicaps: {},
    notes: '',
    scores: {},
  };
}

export function normalizeQuickStartSettings(settings, playerCount) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const requested = merged.scoringMode;
  const scoringMode = isScoringModeAllowed(requested, playerCount)
    ? requested
    : fallbackScoringMode(playerCount);
  return {
    ...merged,
    scoringMode,
    bestBallValue: parseInt(merged.bestBallValue, 10) || 1,
    worstBallValue: parseInt(merged.worstBallValue, 10) || 1,
  };
}

export function buildQuickStartTournamentDraft({
  course,
  players,
  playerTees = {},
  settings = DEFAULT_SETTINGS,
  userId = null,
  now = new Date(),
}) {
  const normalizedSettings = normalizeQuickStartSettings(settings, players.length);
  const round = buildQuickStartRound({ course, players, playerTees });
  const pairs = scoringModeUsesTeams(normalizedSettings.scoringMode, players.length)
    ? randomPairs(players)
    : players.map((p) => [p]);
  const meId = players.find((p) => p.user_id && p.user_id === userId)?.id ?? null;
  return createTournament({
    kind: 'game',
    name: buildQuickStartGameName(course?.name, now),
    players,
    meId,
    rounds: [{ ...round, pairs }],
    settings: normalizedSettings,
  });
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- src/lib/__tests__/quickStartGame.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit helper module**

```bash
git add src/lib/quickStartGame.js src/lib/__tests__/quickStartGame.test.js
git commit -m "feat: add quick start game helpers"
```

---

### Task 2: Add Setup Prefill Support For Edit Details

**Files:**
- Modify: `src/screens/setupWizard.js`
- Modify: `src/screens/__tests__/setupWizard.test.js`
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Add failing setup helper tests**

Modify the first import in `src/screens/__tests__/setupWizard.test.js`:

```js
import {
  wizardSteps,
  isStepValid,
  shouldOfferPostCreateEditorInvite,
  initialStepIndex,
} from '../setupWizard';
```

Add this block after the `wizardSteps` tests:

```js
describe('initialStepIndex', () => {
  test('returns the requested step index when it exists', () => {
    const steps = ['course', 'players', 'tees', 'scoring', 'review'];
    expect(initialStepIndex(steps, 'tees')).toBe(2);
  });

  test('falls back to the first step when the requested step is absent', () => {
    const steps = ['course', 'players', 'review'];
    expect(initialStepIndex(steps, 'tees')).toBe(0);
    expect(initialStepIndex(steps, null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/screens/__tests__/setupWizard.test.js --runInBand
```

Expected: FAIL with `initialStepIndex` not exported.

- [ ] **Step 3: Implement `initialStepIndex`**

Append to `src/screens/setupWizard.js` after `wizardSteps`:

```js
/**
 * Initial wizard index for prefilled flows. Unknown or unavailable requested
 * steps fall back to the first step so navigation never opens past the active
 * step list.
 * @param {string[]} steps
 * @param {string | null | undefined} requestedStep
 * @returns {number}
 */
export function initialStepIndex(steps, requestedStep) {
  if (!requestedStep) return 0;
  const index = steps.indexOf(requestedStep);
  return index >= 0 ? index : 0;
}
```

- [ ] **Step 4: Modify `SetupScreen` to consume prefill params**

In `src/screens/SetupScreen.js`, update the import from `./setupWizard`:

```js
import {
  wizardSteps,
  isStepValid,
  shouldOfferPostCreateEditorInvite,
  initialStepIndex,
} from './setupWizard';
```

Inside `SetupScreen`, immediately after `const isGame = kind === 'game';`, add:

```js
  const prefill = route?.params?.prefill ?? null;
  const prefilledPlayers = Array.isArray(prefill?.players) ? prefill.players : [];
  const prefilledRounds = Array.isArray(prefill?.rounds) && prefill.rounds.length > 0
    ? prefill.rounds
    : null;
  const initialSteps = wizardSteps(kind, prefilledPlayers.length);
```

Replace the existing state initializers for `players`, `rounds`, `settings`, and `rawStep` with:

```js
  const [players, setPlayers] = useState(() => prefilledPlayers);
  const [rounds, setRounds] = useState(() => prefilledRounds ?? [
    { id: newRoundId(), courseName: '', holes: defaultHoles(), tees: [], playerHandicaps: null, playerTees: null },
  ]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...(prefill?.settings ?? {}) });
  const [rawStep, setStep] = useState(() => initialStepIndex(initialSteps, route?.params?.initialStep));
```

Add a ref before the signed-in-user pre-add effect:

```js
  const skipMePreaddRef = useRef(prefilledPlayers.length > 0);
```

Update the first line of the signed-in-user pre-add effect:

```js
    if (skipMePreaddRef.current || mePreaddedRef.current || !user?.id) return;
```

- [ ] **Step 5: Run setup wizard tests**

Run:

```bash
npm test -- src/screens/__tests__/setupWizard.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit setup prefill support**

```bash
git add src/screens/setupWizard.js src/screens/__tests__/setupWizard.test.js src/screens/SetupScreen.js
git commit -m "feat: support prefilled game setup"
```

---

### Task 3: Add QuickStartCourses Component

**Files:**
- Create: `src/components/QuickStartCourses.js`
- Create: `src/components/__tests__/QuickStartCourses.test.js`

- [ ] **Step 1: Write failing component helper tests**

Create `src/components/__tests__/QuickStartCourses.test.js`:

```js
import {
  coursePar,
  courseTeeCount,
  quickStartCourseMeta,
  initialQuickStartPlayerIds,
} from '../QuickStartCourses';

describe('QuickStartCourses helpers', () => {
  test('coursePar sums hole pars when available', () => {
    expect(coursePar({
      holes: [{ par: 4 }, { par: 5 }, { par: 3 }],
    })).toBe(12);
    expect(coursePar({ holes: [] })).toBeNull();
  });

  test('courseTeeCount counts only named tees', () => {
    expect(courseTeeCount({
      tees: [{ label: 'White' }, { label: '' }, { label: 'Yellow' }],
    })).toBe(2);
  });

  test('quickStartCourseMeta combines par and tee count', () => {
    expect(quickStartCourseMeta({
      holes: [{ par: 4 }, { par: 5 }],
      tees: [{ label: 'White' }, { label: 'Yellow' }],
    })).toBe('Par 9 · 2 tees');
    expect(quickStartCourseMeta({ holes: [], tees: [] })).toBe('');
  });

  test('initialQuickStartPlayerIds preselects the signed-in user player', () => {
    const players = [
      { id: 'p1', name: 'Guest', user_id: null },
      { id: 'p2', name: 'Me', user_id: 'u-me' },
    ];
    expect(initialQuickStartPlayerIds(players, 'u-me')).toEqual(['p2']);
  });

  test('initialQuickStartPlayerIds returns empty when no signed-in user player exists', () => {
    expect(initialQuickStartPlayerIds([{ id: 'p1', user_id: null }], 'u-me')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/components/__tests__/QuickStartCourses.test.js --runInBand
```

Expected: FAIL because `src/components/QuickStartCourses.js` does not exist.

- [ ] **Step 3: Implement the component and exported helpers**

Create `src/components/QuickStartCourses.js`:

```js
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';

function playerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function coursePar(course) {
  const holes = Array.isArray(course?.holes) ? course.holes : [];
  if (holes.length === 0) return null;
  return holes.reduce((sum, h) => sum + (Number(h.par) || 0), 0);
}

export function courseTeeCount(course) {
  return (course?.tees ?? []).filter((t) => String(t?.label ?? '').trim()).length;
}

export function quickStartCourseMeta(course) {
  const parts = [];
  const par = coursePar(course);
  const tees = courseTeeCount(course);
  if (par) parts.push(`Par ${par}`);
  if (tees) parts.push(`${tees} tee${tees === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function initialQuickStartPlayerIds(players, currentUserId) {
  const me = players.find((p) => p.user_id && p.user_id === currentUserId);
  return me ? [me.id] : [];
}

export default function QuickStartCourses({
  courses = [],
  players = [],
  currentUserId = null,
  loadingPlayers = false,
  playerError = '',
  starting = false,
  onRetryPlayers,
  onStart,
  onEditDetails,
  onManageFavorites,
}) {
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const s = makeStyles();

  const selectedPlayers = useMemo(
    () => players.filter((p) => selectedIds.includes(p.id)),
    [players, selectedIds],
  );

  useEffect(() => {
    if (!selectedCourse) return;
    setSelectedIds((prev) => {
      const available = new Set(players.map((p) => p.id));
      const kept = prev.filter((id) => available.has(id));
      if (kept.length > 0) return kept;
      return initialQuickStartPlayerIds(players, currentUserId);
    });
  }, [currentUserId, players, selectedCourse]);

  if (courses.length === 0) return null;

  function openCourse(course) {
    setSelectedCourse(course);
    setSelectedIds(initialQuickStartPlayerIds(players, currentUserId));
  }

  function closeSheet() {
    if (starting) return;
    setSelectedCourse(null);
    setSelectedIds([]);
  }

  function togglePlayer(playerId) {
    setSelectedIds((prev) => (
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    ));
  }

  return (
    <View style={s.wrap}>
      <View style={s.headingRow}>
        <Text style={s.sectionLabel}>QUICK START</Text>
        <TouchableOpacity onPress={onManageFavorites} activeOpacity={0.7}>
          <Text style={s.manageText}>Manage</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.rail}
      >
        {courses.map((course) => (
          <TouchableOpacity
            key={course.id}
            style={s.courseCard}
            activeOpacity={0.84}
            onPress={() => openCourse(course)}
            accessibilityRole="button"
            accessibilityLabel={`Quick start ${course.name}`}
          >
            <View style={s.courseTop}>
              <View style={{ flex: 1 }}>
                <Text style={s.courseName} numberOfLines={2}>{course.name}</Text>
                {!!quickStartCourseMeta(course) && (
                  <Text style={s.courseMeta} numberOfLines={1}>{quickStartCourseMeta(course)}</Text>
                )}
              </View>
              <FontAwesome name="star" size={14} color="#006747" />
            </View>
            <View style={s.startPill}>
              <Text style={s.startPillText}>Start</Text>
              <Feather name="chevron-right" size={13} color="#006747" />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal
        visible={!!selectedCourse}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <Pressable style={s.backdrop} onPress={closeSheet}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.handle} />
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>{selectedCourse?.name}</Text>
                <Text style={s.sheetSub}>Choose who is playing</Text>
              </View>
              <View style={s.courseSetPill}>
                <Text style={s.courseSetPillText}>Course set</Text>
              </View>
            </View>

            <View style={s.teeNote}>
              <Feather name="info" size={13} color="#006747" />
              <Text style={s.teeNoteText}>Tees are auto-assigned. Use Edit details to change them.</Text>
            </View>

            {loadingPlayers ? (
              <View style={s.loadingBox}>
                <ActivityIndicator color="#006747" />
                <Text style={s.loadingText}>Loading players…</Text>
              </View>
            ) : playerError ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{playerError}</Text>
                <TouchableOpacity onPress={onRetryPlayers} style={s.retryBtn} activeOpacity={0.75}>
                  <Feather name="refresh-cw" size={13} color="#006747" />
                  <Text style={s.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.playerGrid}>
                {players.map((player) => {
                  const selected = selectedIds.includes(player.id);
                  return (
                    <TouchableOpacity
                      key={player.id}
                      style={[s.playerCard, selected && s.playerCardSelected]}
                      activeOpacity={0.76}
                      onPress={() => togglePlayer(player.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={player.name}
                    >
                      <View style={s.avatar}>
                        <Text style={s.avatarText}>{playerInitials(player.name)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.playerName} numberOfLines={1}>{player.name}</Text>
                        <Text style={s.playerMeta} numberOfLines={1}>HCP {player.handicap}</Text>
                      </View>
                      {selected && <Feather name="check" size={15} color="#006747" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <View style={s.actions}>
              <TouchableOpacity
                style={[s.primaryBtn, (selectedPlayers.length === 0 || starting) && s.primaryBtnDisabled]}
                disabled={selectedPlayers.length === 0 || starting}
                onPress={() => onStart?.({ course: selectedCourse, players: selectedPlayers })}
                activeOpacity={0.82}
              >
                {starting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={s.primaryBtnText}>Start game</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.editBtn}
                disabled={!selectedCourse || starting}
                onPress={() => onEditDetails?.({ course: selectedCourse, players: selectedPlayers })}
                activeOpacity={0.75}
              >
                <Text style={s.editBtnText}>Edit details</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    wrap: { marginTop: 14 },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: '#747467',
      fontSize: 11,
      letterSpacing: 1.8,
    },
    manageText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#006747',
      fontSize: 12,
    },
    rail: { gap: 10, paddingRight: 20 },
    courseCard: {
      width: 174,
      minHeight: 112,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: '#ded8cd',
      backgroundColor: '#ffffff',
      padding: 12,
      justifyContent: 'space-between',
    },
    courseTop: { flexDirection: 'row', gap: 8 },
    courseName: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#1a1a1a',
      fontSize: 14,
      lineHeight: 18,
    },
    courseMeta: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: '#56616f',
      fontSize: 11,
      marginTop: 4,
    },
    startPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 999,
      backgroundColor: '#e6f0eb',
      paddingVertical: 6,
      paddingHorizontal: 9,
    },
    startPillText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#006747',
      fontSize: 11,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: '#ffffff',
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 16,
      paddingBottom: 24,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      backgroundColor: '#ded8cd',
      alignSelf: 'center',
      marginBottom: 14,
    },
    sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    sheetTitle: {
      fontFamily: 'PlayfairDisplay-Bold',
      color: '#1a1a1a',
      fontSize: 22,
    },
    sheetSub: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: '#56616f',
      fontSize: 12,
      marginTop: 2,
    },
    courseSetPill: {
      borderRadius: 999,
      backgroundColor: '#e6f0eb',
      paddingVertical: 7,
      paddingHorizontal: 10,
    },
    courseSetPillText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#006747',
      fontSize: 11,
    },
    teeNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: '#e6f0eb',
      borderRadius: 12,
      padding: 10,
      marginTop: 12,
    },
    teeNoteText: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: '#006747',
      fontSize: 11,
      lineHeight: 15,
    },
    loadingBox: { paddingVertical: 24, alignItems: 'center', gap: 8 },
    loadingText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: '#56616f',
      fontSize: 12,
    },
    errorBox: { paddingVertical: 18, gap: 10 },
    errorText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: '#ef4444',
      fontSize: 12,
      textAlign: 'center',
    },
    retryBtn: {
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: '#ded8cd',
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    retryText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#006747',
      fontSize: 12,
    },
    playerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    playerCard: {
      width: '48%',
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: '#ded8cd',
      backgroundColor: '#fbfaf7',
      padding: 9,
    },
    playerCardSelected: {
      borderColor: '#8cc5b0',
      backgroundColor: '#e6f0eb',
    },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: '#ece8e1',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#56616f',
      fontSize: 10,
    },
    playerName: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#1a1a1a',
      fontSize: 12,
    },
    playerMeta: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: '#56616f',
      fontSize: 10,
      marginTop: 1,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 14,
    },
    primaryBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 14,
      backgroundColor: '#006747',
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnDisabled: { opacity: 0.55 },
    primaryBtnText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: '#ffffff',
      fontSize: 13,
    },
    editBtn: { paddingHorizontal: 2, paddingVertical: 12 },
    editBtnText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#006747',
      fontSize: 12,
    },
  });
}
```

- [ ] **Step 4: Run component helper tests**

Run:

```bash
npm test -- src/components/__tests__/QuickStartCourses.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit component**

```bash
git add src/components/QuickStartCourses.js src/components/__tests__/QuickStartCourses.test.js
git commit -m "feat: add quick start course picker"
```

---

### Task 4: Wire Quick Start Into HomeScreen

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Add HomeScreen imports**

Modify the React Navigation import:

```js
import { CommonActions } from '@react-navigation/native';
```

Add component/store/helper imports near existing imports:

```js
import QuickStartCourses from '../components/QuickStartCourses';
import PostCreateInviteModal from '../components/PostCreateInviteModal';
import { useAuth } from '../context/AuthContext';
import { fetchMyPlayers, loadCourseLibrary } from '../store/libraryStore';
import {
  buildQuickStartRound,
  buildQuickStartTournamentDraft,
  resolveQuickStartPlayerTees,
} from '../lib/quickStartGame';
import { shouldOfferPostCreateEditorInvite } from './setupWizard';
```

Update the existing `tournamentStore` import list to include `lastTeeForPlayerOnCourse`.

- [ ] **Step 2: Add quick-start state to HomeScreen**

Inside `HomeScreen`, immediately after `const { theme } = useTheme();`, add:

```js
  const { user } = useAuth();
```

Inside `HomeScreen`, near other list-view state, add:

```js
  const [quickStartCourses, setQuickStartCourses] = useState([]);
  const [quickStartPlayers, setQuickStartPlayers] = useState([]);
  const [quickStartPlayersLoading, setQuickStartPlayersLoading] = useState(false);
  const [quickStartPlayerError, setQuickStartPlayerError] = useState('');
  const [quickStartStarting, setQuickStartStarting] = useState(false);
  const [quickStartInvite, setQuickStartInvite] = useState({
    visible: false,
    loading: false,
    link: '',
    error: '',
    tournament: null,
  });
```

- [ ] **Step 3: Add quick-start loaders**

After `onRefresh`, add:

```js
  const loadQuickStartCourses = useCallback(async () => {
    const library = await loadCourseLibrary();
    const favorites = library.favorites ?? new Set();
    const courses = (library.courses ?? []).filter((course) => favorites.has(course.id));
    setQuickStartCourses(courses);
  }, []);

  const loadQuickStartPlayers = useCallback(async () => {
    setQuickStartPlayersLoading(true);
    setQuickStartPlayerError('');
    try {
      setQuickStartPlayers(await fetchMyPlayers());
    } catch (err) {
      setQuickStartPlayerError(err?.message ?? 'Could not load players');
    } finally {
      setQuickStartPlayersLoading(false);
    }
  }, []);
```

Add a focus effect using `navigation.addListener`, near the unread notification effect:

```js
  useEffect(() => {
    const refreshQuickStart = () => {
      loadQuickStartCourses().catch(() => setQuickStartCourses([]));
      loadQuickStartPlayers();
    };
    refreshQuickStart();
    const unsubFocus = navigation.addListener('focus', refreshQuickStart);
    return unsubFocus;
  }, [loadQuickStartCourses, loadQuickStartPlayers, navigation]);
```

- [ ] **Step 4: Add tee-history resolver and navigation helpers**

Add this helper near `selectTournament`:

```js
  async function resolveQuickStartTees(course, players) {
    const entries = await Promise.all(players.map(async (player) => {
      try {
        const tee = await lastTeeForPlayerOnCourse(course.id, player.id);
        return [player.id, tee];
      } catch (_) {
        return [player.id, null];
      }
    }));
    return resolveQuickStartPlayerTees({
      course,
      players,
      currentUserId: user?.id ?? null,
      lastTeeByPlayer: Object.fromEntries(entries),
    });
  }

  function rootNavigation() {
    return navigation.getParent?.()?.getParent?.() ?? navigation.getParent?.() ?? navigation;
  }

  function navigateToQuickStartedGame() {
    const root = rootNavigation();
    root.dispatch((state) => {
      const mainRoute = state.routes.find((r) => r.name === 'Main') ?? { name: 'Main' };
      const routes = [
        mainRoute,
        { name: 'Tournament' },
        { name: 'Scorecard', params: { roundIndex: 0 } },
      ];
      return CommonActions.reset({ ...state, routes, index: routes.length - 1 });
    });
  }
```

- [ ] **Step 5: Add quick-start start and edit handlers**

Add near the previous helper:

```js
  function closeQuickStartInvite() {
    const created = quickStartInvite.tournament;
    setQuickStartInvite({
      visible: false,
      loading: false,
      link: '',
      error: '',
      tournament: null,
    });
    if (created) navigateToQuickStartedGame();
  }

  async function shareQuickStartInvite() {
    if (!quickStartInvite.link) return;
    try {
      const label = quickStartInvite.tournament?.name ?? 'my game';
      await Share.share({
        message: `Join "${label}" on Golf Partner:\n${quickStartInvite.link}`,
      });
    } catch (err) {
      const msg = err?.message ?? 'Could not share the invite link';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  async function handleQuickStart({ course, players }) {
    if (!course || players.length === 0) return;
    setQuickStartStarting(true);
    try {
      const playerTees = await resolveQuickStartTees(course, players);
      const created = buildQuickStartTournamentDraft({
        course,
        players,
        playerTees,
        settings: DEFAULT_SETTINGS,
        userId: user?.id ?? null,
      });
      await saveTournament(created);
      setTournament(created);
      setAllTournaments((prev) => [created, ...prev.filter((t) => t.id !== created.id)]);

      if (shouldOfferPostCreateEditorInvite('game', players, user?.id)) {
        setQuickStartInvite({ visible: true, loading: true, link: '', error: '', tournament: created });
        try {
          const { editorCode } = await generateInviteCode(created.id);
          const origin = Platform.OS === 'web' && typeof window !== 'undefined'
            ? window.location.origin
            : '';
          setQuickStartInvite({
            visible: true,
            loading: false,
            link: buildJoinLink(origin, editorCode),
            error: '',
            tournament: created,
          });
        } catch (inviteErr) {
          setQuickStartInvite({
            visible: true,
            loading: false,
            link: '',
            error: inviteErr?.message ?? 'Could not create the invite link right now.',
            tournament: created,
          });
        }
        return;
      }

      navigateToQuickStartedGame();
    } catch (err) {
      const msg = err?.message ?? 'Could not start game';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setQuickStartStarting(false);
    }
  }

  async function handleQuickStartEditDetails({ course, players }) {
    const selectedPlayers = players.length > 0
      ? players
      : quickStartPlayers.filter((p) => p.user_id && p.user_id === user?.id);
    const playerTees = await resolveQuickStartTees(course, selectedPlayers);
    const round = buildQuickStartRound({ course, players: selectedPlayers, playerTees });
    navigation.navigate('Setup', {
      kind: 'game',
      initialStep: 'tees',
      prefill: {
        players: selectedPlayers,
        rounds: [round],
        settings: DEFAULT_SETTINGS,
      },
    });
  }
```

- [ ] **Step 6: Render the quick-start section**

Inside the `showList` render, after the `Join with code` tile and before `reloadError`, add:

```jsx
        <QuickStartCourses
          courses={quickStartCourses}
          players={quickStartPlayers}
          currentUserId={user?.id ?? null}
          loadingPlayers={quickStartPlayersLoading}
          playerError={quickStartPlayerError}
          starting={quickStartStarting}
          onRetryPlayers={loadQuickStartPlayers}
          onStart={handleQuickStart}
          onEditDetails={handleQuickStartEditDetails}
          onManageFavorites={() => navigation.navigate('CoursesLibrary')}
        />
```

At the end of the list view, before `ConfirmModal`, render the post-create modal:

```jsx
        <PostCreateInviteModal
          visible={quickStartInvite.visible}
          loading={quickStartInvite.loading}
          link={quickStartInvite.link}
          error={quickStartInvite.error}
          onRequestClose={closeQuickStartInvite}
          onShare={shareQuickStartInvite}
        />
```

- [ ] **Step 7: Run focused tests and lint**

Run:

```bash
npm test -- src/lib/__tests__/quickStartGame.test.js src/components/__tests__/QuickStartCourses.test.js src/screens/__tests__/setupWizard.test.js --runInBand
npm run lint
```

Expected: all focused tests PASS and lint exits 0.

- [ ] **Step 8: Commit HomeScreen wiring**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: wire quick start into play screen"
```

---

### Task 5: Verify The Full Flow

**Files:**
- No code files unless verification finds a defect.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Start the web app**

Run:

```bash
npm run web
```

Expected: Expo starts the web dev server and prints a local URL, usually `http://localhost:8081`.

- [ ] **Step 4: Browser-check the Play screen**

Open the Expo web URL in the browser. Verify:

- When at least one course is favorited, the `Quick start` rail appears under `Join with code`.
- Favorite course cards show course name and `Par N · M tees` metadata.
- Tapping a course opens the bottom sheet.
- The signed-in user's player is preselected when available.
- The sheet has no tee controls.
- The read-only tee note says tee changes happen through `Edit details`.
- `Edit details` opens setup on the `TEES & HANDICAPS` step with the course and selected players already present.
- `Start game` creates a game and opens the scorecard.

- [ ] **Step 5: Commit any verification fixes**

If verification required changes, commit only those changes:

```bash
git add src/lib/quickStartGame.js src/lib/__tests__/quickStartGame.test.js src/screens/setupWizard.js src/screens/__tests__/setupWizard.test.js src/screens/SetupScreen.js src/components/QuickStartCourses.js src/components/__tests__/QuickStartCourses.test.js src/screens/HomeScreen.js
git commit -m "fix: polish quick start flow"
```

If no verification fixes were required, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: the plan covers favorite-course rail, sheet UX, read-only tee defaults, grouped tee fallback, game defaults, setup edit-details prefill, post-create invite behavior, empty states, and verification.
- No new database tables are planned.
- The only tee-changing surface remains `SetupScreen` through `Edit details`.
- Quick-start creation logic is isolated in `src/lib/quickStartGame.js`; `HomeScreen` owns only data loading, callbacks, and navigation.
