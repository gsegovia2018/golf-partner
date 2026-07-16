# Rename Tournament/Game After Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename a casual tournament or single-round game at any time — including after it's finished — via a name field on the Edit Tournament screen.

**Architecture:** Pure UI change. The Edit Tournament screen gains a name `TextInput` at the top that rides the screen's existing debounced autosave: the name joins the `tournament.updateProfile` mutation patch already emitted for settings. The store/sync layer (`mutate.js` → sync queue → `patch_game_tournament` RPC) already fully supports name patches and imposes no `finishedAt` restriction, so no store, sync, or schema changes are needed.

**Tech Stack:** React Native (Expo SDK 54), Jest via jest-expo + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-07-16-rename-tournament-design.md`

## Global Constraints

- Never emit an empty/whitespace-only name: `mutate.js:395` and the server treat a null name as "skip, never clear", but an **empty string would be written verbatim** — the UI must trim and skip empties.
- Dedup against the last-emitted value (same policy as round notes' `lastEmittedNotesRef`) so unrelated edits don't re-push an unchanged name each autosave.
- Officials (`kind: 'official'`) are out of scope; so is a per-round name field (a round's label is its `courseName`, already editable on this screen).
- `npm run lint` must pass (CI-blocking).
- Known flake: jest-expo screen tests can hit 5s render timeouts under load — re-run the file in isolation before treating a timeout as a regression.

---

### Task 1: Name field on EditTournamentScreen with guarded autosave

**Files:**
- Modify: `src/screens/EditTournamentScreen.js`
- Test (create): `src/screens/__tests__/EditTournamentScreen.rename.test.js`

**Interfaces:**
- Consumes: `mutate(tournament, { type: 'tournament.updateProfile', patch })` from `src/store/mutate.js` (already exists — applies locally, queues sync); `tournamentNounCapitalized(tournament)` from `src/store/tournamentStore.js` (returns `'Game'` for `kind: 'game'`, `'Tournament'` otherwise).
- Produces: nothing consumed by later tasks (single-task plan).

- [ ] **Step 1: Write the failing tests**

Create `src/screens/__tests__/EditTournamentScreen.rename.test.js`. Mirrors the mocking pattern of the existing `EditTournamentScreen.test.js`, plus a mutable `tournamentOverrides` so one test can load a finished tournament:

```js
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import EditTournamentScreen from '../EditTournamentScreen';

// Spec: docs/superpowers/specs/2026-07-16-rename-tournament-design.md
// The tournament/game name is editable on this screen at any time —
// including after finish — and rides the existing debounced
// tournament.updateProfile autosave. Two guards: never emit an
// empty/whitespace name (name is never-clearable server-side; an empty
// string would be written verbatim), and dedup against the last-emitted
// value so unrelated edits don't re-push an unchanged name.

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

// Per-test tournament overrides (e.g. finishedAt) — reset in beforeEach.
let tournamentOverrides = {};

function mockMakeTournament() {
  return {
    id: 't1',
    name: 'Weekend Match',
    kind: 'game',
    settings: {
      scoringMode: 'stableford', bestBallValue: 1, worstBallValue: 1, fixedTeams: false, manualTeams: false,
    },
    players: [
      { id: 'p1', name: 'Marcos', handicap: 10 },
      { id: 'p2', name: 'Pablo', handicap: 12 },
    ],
    rounds: [{
      id: 'r1',
      courseName: 'La Moraleja',
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
      tees: [],
      playerTees: {},
      playerHandicaps: { p1: 10, p2: 12 },
      manualHandicaps: {},
      pairs: [[{ id: 'p1' }, { id: 'p2' }]],
      scores: {},
      notes: { round: '', hole: {} },
    }],
    ...tournamentOverrides,
  };
}

jest.mock('../../store/tournamentStore', () => {
  const actual = jest.requireActual('../../store/tournamentStore');
  return {
    ...actual,
    getTournamentSnapshot: jest.fn(() => mockMakeTournament()),
    getActiveTournamentSnapshot: jest.fn(() => mockMakeTournament()),
    getTournament: jest.fn(() => Promise.resolve(mockMakeTournament())),
    loadTournament: jest.fn(() => Promise.resolve(mockMakeTournament())),
    subscribeTournamentChanges: jest.fn(() => () => {}),
  };
});

jest.mock('../../store/mutate', () => ({
  mutate: jest.fn((current) => Promise.resolve(current)),
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() };
const route = { params: { tournamentId: 't1' } };
const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const updateProfileCalls = (mutate) =>
  mutate.mock.calls.filter(([, m]) => m.type === 'tournament.updateProfile');

describe('EditTournamentScreen rename', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tournamentOverrides = {};
  });

  test('editing the name emits tournament.updateProfile with the trimmed name', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    mutate.mockClear();
    fireEvent.changeText(nameInput, '  Ryder Cup 2026  ');

    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) =>
        m.type === 'tournament.updateProfile' && m.patch?.name === 'Ryder Cup 2026')).toBe(true);
    }, { timeout: 2000 });
  });

  test('clearing the name to whitespace never emits a name patch (settings still save)', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    mutate.mockClear();
    fireEvent.changeText(nameInput, '   ');

    await waitFor(() => {
      expect(updateProfileCalls(mutate).length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    expect(updateProfileCalls(mutate).every(([, m]) => !('name' in (m.patch ?? {})))).toBe(true);
  });

  test('an unrelated edit after the name is saved does not re-emit the name (dedup)', async () => {
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    mutate.mockClear();
    fireEvent.changeText(nameInput, 'Ryder Cup 2026');
    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) =>
        m.type === 'tournament.updateProfile' && m.patch?.name === 'Ryder Cup 2026')).toBe(true);
    }, { timeout: 2000 });

    // Unrelated edit: course name. Autosave fires (round.upsert +
    // updateProfile-with-settings) but must NOT carry the unchanged name.
    mutate.mockClear();
    const courseInput = await findByPlaceholderText('Course name');
    fireEvent.changeText(courseInput, 'Nuevo Course');
    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) => m.type === 'round.upsert' && m.roundId === 'r1')).toBe(true);
    }, { timeout: 2000 });

    expect(updateProfileCalls(mutate).every(([, m]) => !('name' in (m.patch ?? {})))).toBe(true);
  });

  test('a finished tournament still shows the name pre-filled and saves a rename', async () => {
    tournamentOverrides = { finishedAt: '2026-07-01T10:00:00.000Z' };
    const { mutate } = require('../../store/mutate');
    const { findByPlaceholderText, getByDisplayValue } = render(wrap(
      <EditTournamentScreen navigation={navigation} route={route} />,
    ));

    const nameInput = await findByPlaceholderText('Game name');
    expect(getByDisplayValue('Weekend Match')).toBeTruthy();

    mutate.mockClear();
    fireEvent.changeText(nameInput, 'The 2026 Classic');
    await waitFor(() => {
      expect(mutate.mock.calls.some(([, m]) =>
        m.type === 'tournament.updateProfile' && m.patch?.name === 'The 2026 Classic')).toBe(true);
    }, { timeout: 2000 });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- src/screens/__tests__/EditTournamentScreen.rename.test.js`
Expected: all 4 tests FAIL with `Unable to find an element with placeholder: Game name` (the field doesn't exist yet).

- [ ] **Step 3: Implement the name field in EditTournamentScreen.js**

Four edits, all in `src/screens/EditTournamentScreen.js`:

**3a — import `tournamentNounCapitalized`.** In the `tournamentStore` import block (lines 10–14), add it:

```js
import {
  loadTournament, subscribeTournamentChanges, DEFAULT_SETTINGS, buildTeamsForMode,
  normalizeRoundHandicaps, isRoundComplete, tournamentNounCapitalized,
  getActiveTournamentSnapshot, getTournamentSnapshot, getTournament,
} from '../store/tournamentStore';
```

**3b — state + dedup ref.** After the `settings` state (line 103) add:

```js
const [name, setName] = useState(() => initialTournament?.name ?? '');
```

Next to `lastEmittedNotesRef` (line 111) add:

```js
// Last tournament name EMITTED (or seeded from a load) — same dedup policy
// as lastEmittedNotesRef above, so unrelated edits don't re-push an
// unchanged name on every autosave.
const lastEmittedNameRef = useRef(initialTournament?.name ?? '');
```

**3c — seed on load.** In `initialLoad`, right after the `lastEmittedNotesRef.current = emittedNotesSeed(t);` line, add:

```js
lastEmittedNameRef.current = t?.name ?? '';
setName(t?.name ?? '');
```

In `mergeLoad`, right after its `lastEmittedNotesRef.current = emittedNotesSeed(t);` line, add (baseline only — mergeLoad never overwrites in-flight edits, matching the notes policy):

```js
lastEmittedNameRef.current = t?.name ?? '';
```

**3d — emit in the debounced save.** In the save effect, change the deps array from `[rounds, settings]` to `[rounds, settings, name]`, and replace the final `tournament.updateProfile` call (lines 243–252) with:

```js
// The tournament name rides the same updateProfile patch, but only when
// the trimmed value is non-empty (name is never-clearable: mutate.js and
// the server both skip a null, and an empty string would be written
// verbatim) AND differs from the last emitted/seeded value.
const trimmedName = name.trim();
const includeName = !!trimmedName && trimmedName !== lastEmittedNameRef.current;
await mutate(current, {
  type: 'tournament.updateProfile',
  patch: {
    ...(includeName ? { name: trimmedName } : {}),
    settings: {
      ...settings,
      bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
      worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
    },
  },
});
if (includeName) lastEmittedNameRef.current = trimmedName;
```

**3e — the field itself.** In the JSX, immediately after `<ScrollView ...>` opens (line 412, before `{rounds.map(...)}`), add:

```jsx
{/* Tournament / game name — editable at any time, including finished. */}
<View style={s.roundHeader}>
  <Text style={s.sectionTitle}>{`${tournamentNounCapitalized(tournament)} Name`}</Text>
</View>
<View style={s.roundCard}>
  <TextInput
    style={s.input}
    placeholder={`${tournamentNounCapitalized(tournament)} name`}
    placeholderTextColor={theme.text.muted}
    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
    selectionColor={theme.accent.primary}
    value={name}
    onChangeText={setName}
  />
</View>
```

(`s.roundHeader`, `s.sectionTitle`, `s.roundCard`, `s.input` all already exist in this screen's `makeStyles` — no style additions needed. For `kind: 'game'` the label reads "Game Name" / placeholder "Game name"; for tournaments, "Tournament Name" / "Tournament name".)

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npm test -- src/screens/__tests__/EditTournamentScreen.rename.test.js`
Expected: 4 passed.

- [ ] **Step 5: Run the pre-existing screen tests to verify no regression**

Run: `npm test -- src/screens/__tests__/EditTournamentScreen.test.js`
Expected: 4 passed (round-notes suite). If a test times out at 5s, re-run the file in isolation once before investigating — known jest-expo flake under load.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: exit 0, no new warnings/errors for the two touched files.

- [ ] **Step 7: Commit**

```bash
git add src/screens/EditTournamentScreen.js src/screens/__tests__/EditTournamentScreen.rename.test.js
git commit -m "feat(edit): rename tournament/game from Edit screen, even when finished"
```

(Do NOT `git add -A` — the working tree has unrelated in-flight changes from parallel sessions: `package-lock.json`, `src/screens/__tests__/scorecardScores.test.js`, `src/screens/__tests__/ScorecardScreen.clearShot.test.js`.)
