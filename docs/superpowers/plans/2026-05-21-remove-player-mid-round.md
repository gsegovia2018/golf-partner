# Remove Player Mid-Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user remove one player at a time from an in-progress casual game, dropping that player's round data entirely, with an auto-fallback mode prompt when the smaller roster breaks the current scoring mode.

**Architecture:** A new store function `removePlayerRoundPatches` mirrors `addPlayerRoundPatches` — it resolves the post-removal scoring mode (override → current → fallback) and rebuilds per-round pairs via a `buildPairsForRemovedPlayer` helper keyed on `scoringModeUsesTeams`. A new `tournament.removePlayer` mutation drops the player and deletes their per-round `scores`/`shotDetails`/`playerHandicaps`, atomically applying any mode change. `HomeScreen` gains a "Remove Player" settings item that opens a new `PlayerRemoveSheet`; when removal breaks the mode it reuses the existing `ScoringModeChangeSheet`.

**Tech Stack:** Expo SDK 54, React Native 0.81, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-05-21-remove-player-mid-round-design.md`

**Branch:** `feature/remove-player-mid-round` (already created off master).

---

## File Structure

**Created:**
- `src/store/__tests__/removePlayerRoundPatches.test.js` — unit tests for the new store function.
- `src/components/PlayerRemoveSheet.js` — bottom-sheet modal listing removable players.

**Modified:**
- `src/store/tournamentStore.js` — add `removePlayerRoundPatches` export + internal `buildPairsForRemovedPlayer` helper, placed directly after `addPlayerRoundPatches` (ends at line 648).
- `src/store/mutate.js` — add `tournament.removePlayer` case to `metaPathFor` and `applyToTournament`.
- `src/store/__tests__/addPlayerMutation.test.js` — add a `describe('tournament.removePlayer mutation')` block.
- `src/screens/HomeScreen.js` — add the "Remove Player" settings item, `commitRemove` / `applyRemovePlayer` callbacks, and render `PlayerRemoveSheet` + a remove-side `ScoringModeChangeSheet`.

---

## Task 1: Store — `removePlayerRoundPatches` + `buildPairsForRemovedPlayer`

**Goal:** A new store function that produces per-round pair patches and a resolved scoring mode after a player is removed.

**Files:**
- Modify: `src/store/tournamentStore.js` (insert after line 648, the closing `}` of `addPlayerRoundPatches`)
- Create: `src/store/__tests__/removePlayerRoundPatches.test.js`

- [ ] **Step 1: Create the test file**

Create `src/store/__tests__/removePlayerRoundPatches.test.js`:

```js
import { removePlayerRoundPatches } from '../tournamentStore';

function makeTournament({ players, mode, rounds, currentRound = 0 }) {
  return {
    id: 't1',
    players,
    rounds,
    currentRound,
    settings: { scoringMode: mode, bestBallValue: 1, worstBallValue: 1 },
  };
}

function makeRound({ id = 'r1', revealed = false, pairs = [] } = {}) {
  return {
    id,
    holes: [],
    pairs,
    revealed,
    playerHandicaps: {},
    manualHandicaps: {},
    scores: {},
  };
}

const A = { id: 'a', name: 'A', handicap: 10 };
const B = { id: 'b', name: 'B', handicap: 12 };
const C = { id: 'c', name: 'C', handicap: 8 };
const D = { id: 'd', name: 'D', handicap: 4 };

describe('removePlayerRoundPatches mode resolution', () => {
  test('individual 4→3 keeps individual', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'individual',
      rounds: [makeRound({ pairs: [[A], [B], [C], [D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd');
    expect(nextScoringMode).toBe('individual');
  });

  test('bestball 4→3 with no override falls back to stableford', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd');
    expect(nextScoringMode).toBe('stableford');
  });

  test('bestball 4→3 honors a valid { mode } override', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd', { mode: 'sindicato' });
    expect(nextScoringMode).toBe('sindicato');
  });

  test('invalid override is ignored and auto-fallback applies', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    // bestball needs exactly 4 — invalid at 3 even as an override
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd', { mode: 'bestball' });
    expect(nextScoringMode).toBe('stableford');
  });

  test('sindicato 3→2 falls back to individual (stableford needs 3+)', () => {
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ pairs: [[A], [B], [C]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'c');
    expect(nextScoringMode).toBe('individual');
  });

  test('stableford 4→3 keeps stableford', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { nextScoringMode } = removePlayerRoundPatches(t, 'd');
    expect(nextScoringMode).toBe('stableford');
  });
});

describe('removePlayerRoundPatches pair construction', () => {
  test('non-team new mode: survivors each become their own group', () => {
    const t = makeTournament({
      players: [A, B, C],
      mode: 'sindicato',
      rounds: [makeRound({ revealed: true, pairs: [[A], [B], [C]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'c');
    expect(patches[0].pairs).toEqual([[A], [B]]);
  });

  test('team→team revealed: removed player dropped from their pair, others preserved', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches[0].pairs).toEqual([[A, B], [C]]);
  });

  test('team→team revealed: a pair emptied by removal is discarded', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C], [D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'c');
    expect(patches[0].pairs).toEqual([[A, B], [D]]);
  });

  test('team new mode but not-yet-revealed round: randomizes fresh', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: false, pairs: [] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    const flat = patches[0].pairs.flat();
    expect(flat).toHaveLength(3);
    expect(flat.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('bestball 4→3 fallback to stableford: existing pairs kept minus removed player', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'bestball',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches[0].pairs).toEqual([[A, B], [C]]);
  });
});

describe('removePlayerRoundPatches multi-round behavior', () => {
  test('rounds before currentRound are not patched', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      currentRound: 1,
      rounds: [
        makeRound({ id: 'r0', revealed: true, pairs: [[A, B], [C, D]] }),
        makeRound({ id: 'r1', revealed: true, pairs: [[A, C], [B, D]] }),
        makeRound({ id: 'r2', revealed: false, pairs: [] }),
      ],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(patches.map((p) => p.roundId)).toEqual(['r1', 'r2']);
  });

  test('each patch carries a pairs array', () => {
    const t = makeTournament({
      players: [A, B, C, D],
      mode: 'stableford',
      rounds: [makeRound({ revealed: true, pairs: [[A, B], [C, D]] })],
    });
    const { patches } = removePlayerRoundPatches(t, 'd');
    expect(Array.isArray(patches[0].pairs)).toBe(true);
    expect(patches[0].roundId).toBe('r1');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx jest src/store/__tests__/removePlayerRoundPatches.test.js`
Expected: FAIL — `removePlayerRoundPatches` is not exported (`TypeError: ... is not a function`).

- [ ] **Step 3: Implement the function**

In `src/store/tournamentStore.js`, insert the following directly after the closing `}` of `addPlayerRoundPatches` (after line 648, before the `// calcExtraShots ...` comment block):

```js

// Pair construction for a round after a player is removed. Mirror of
// buildPairsForAddedPlayer, keyed on scoringModeUsesTeams.
// - Non-team new mode → every survivor is their own group.
// - Team new mode AND old mode also used teams AND existing pairs were
//   revealed → keep the existing partnerships minus the removed player; a
//   pair emptied by the removal is discarded, a half-emptied pair becomes a
//   one-member group.
// - Otherwise → fresh randomPairs(survivors).
function buildPairsForRemovedPlayer({ survivors, newMode, oldMode, existingPairs, removedId, revealed }) {
  if (!scoringModeUsesTeams(newMode)) {
    return survivors.map((p) => [p]);
  }
  const oldWasTeams = scoringModeUsesTeams(oldMode, survivors.length + 1);
  if (oldWasTeams && existingPairs?.length && revealed) {
    return existingPairs
      .map((pr) => pr.filter((p) => p.id !== removedId))
      .filter((pr) => pr.length > 0);
  }
  return randomPairs(survivors);
}

// Build the per-round patches for removing the player `playerId` from an
// in-progress tournament. The player leaves `currentRound` and every later
// round; already-played earlier rounds are left untouched. Returns the
// patches plus the resolved scoring mode after the removal — equal to the
// current mode when it stays valid for the smaller roster, or the
// auto-fallback otherwise. Pass { mode } to override (used by the prompt UX).
// Each patch carries only the rebuilt `pairs`; deleting the removed player's
// per-round scores/shotDetails/handicap is the mutation's job.
export function removePlayerRoundPatches(tournament, playerId, { mode } = {}) {
  const oldMode = tournament?.settings?.scoringMode ?? 'stableford';
  const currentRound = tournament?.currentRound ?? 0;
  const survivors = (tournament?.players ?? []).filter((p) => p.id !== playerId);
  const newCount = survivors.length;
  const nextScoringMode =
    mode && isScoringModeAllowed(mode, newCount) ? mode
      : isScoringModeAllowed(oldMode, newCount) ? oldMode
      : fallbackScoringMode(newCount);
  const patches = [];
  (tournament?.rounds ?? []).forEach((round, idx) => {
    if (idx < currentRound) return; // already-played rounds untouched
    const pairs = buildPairsForRemovedPlayer({
      survivors,
      newMode: nextScoringMode,
      oldMode,
      existingPairs: round.pairs,
      removedId: playerId,
      revealed: Boolean(round.revealed),
    });
    patches.push({ roundId: round.id, pairs });
  });
  return { patches, nextScoringMode };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/store/__tests__/removePlayerRoundPatches.test.js`
Expected: all tests pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test -- --silent`
Expected: all tests pass (the count was 422 before this task; it grows by the new test file).

- [ ] **Step 6: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/removePlayerRoundPatches.test.js
git commit -m "feat(tournamentStore): removePlayerRoundPatches rebuilds pairs and resolves mode on roster shrink"
```

---

## Task 2: Mutation — `tournament.removePlayer`

**Goal:** A `tournament.removePlayer` mutation that drops the player from the roster, deletes their per-round data, sets new pairs, and atomically applies any mode change.

**Files:**
- Modify: `src/store/mutate.js`
- Modify: `src/store/__tests__/addPlayerMutation.test.js`

- [ ] **Step 1: Add failing tests**

Append to `src/store/__tests__/addPlayerMutation.test.js` (after the final `describe` block, before end of file):

```js
function fourPlayerTournament() {
  return {
    id: 't2',
    players: [
      { id: 'a', name: 'A', handicap: 10 },
      { id: 'b', name: 'B', handicap: 12 },
      { id: 'c', name: 'C', handicap: 8 },
      { id: 'd', name: 'D', handicap: 4 },
    ],
    rounds: [
      {
        id: 'r1',
        holes: [],
        pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]],
        revealed: true,
        playerHandicaps: { a: 10, b: 12, c: 8, d: 4 },
        scores: { a: { 1: 4 }, d: { 1: 5 } },
        shotDetails: { d: { 1: { putts: 2 } } },
      },
    ],
    currentRound: 0,
    settings: { scoringMode: 'bestball', bestBallValue: 1, worstBallValue: 1 },
  };
}

describe('tournament.removePlayer mutation', () => {
  test('removes the player from players', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] }],
      nextScoringMode: 'stableford',
    });
    expect(t.players.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('deletes the removed player scores, shotDetails, and playerHandicaps', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] }],
      nextScoringMode: 'stableford',
    });
    const round = t.rounds[0];
    expect(round.scores.d).toBeUndefined();
    expect(round.scores.a).toEqual({ 1: 4 });
    expect(round.shotDetails.d).toBeUndefined();
    expect(round.playerHandicaps.d).toBeUndefined();
    expect(round.playerHandicaps.a).toBe(10);
  });

  test('sets round pairs from the patch', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]] }],
      nextScoringMode: 'stableford',
    });
    expect(t.rounds[0].pairs).toEqual([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]);
  });

  test('applies nextScoringMode when provided', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [] }],
      nextScoringMode: 'stableford',
    });
    expect(t.settings.scoringMode).toBe('stableford');
  });

  test('leaves settings unchanged when nextScoringMode is absent', () => {
    const t = fourPlayerTournament();
    applyToTournament(t, {
      type: 'tournament.removePlayer',
      playerId: 'd',
      roundPatches: [{ roundId: 'r1', pairs: [] }],
    });
    expect(t.settings.scoringMode).toBe('bestball');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx jest src/store/__tests__/addPlayerMutation.test.js`
Expected: the five new tests fail — `applyToTournament` has no `tournament.removePlayer` case, so it hits the `default` branch and does nothing.

- [ ] **Step 3: Add the `metaPathFor` case**

In `src/store/mutate.js`, in the `metaPathFor` switch, add this case directly after the `tournament.addPlayer` case (after its closing `}` on line 34):

```js
    // Removing a player drops them from the roster and clears their per-round
    // scores / shot detail / handicap; like addPlayer it can also flip the
    // scoring mode, so this mutation bumps several paths at once.
    case 'tournament.removePlayer': {
      const paths = ['players'];
      for (const patch of (m.roundPatches ?? [])) {
        paths.push(`rounds.${patch.roundId}.playerHandicaps.${m.playerId}`);
        paths.push(`rounds.${patch.roundId}.scores.${m.playerId}`);
        paths.push(`rounds.${patch.roundId}.shotDetails.${m.playerId}`);
        paths.push(`rounds.${patch.roundId}.pairs`);
      }
      if (m.nextScoringMode) paths.push('settings.scoringMode');
      return paths;
    }
```

- [ ] **Step 4: Add the `applyToTournament` case**

In `src/store/mutate.js`, in the `applyToTournament` switch, add this case directly after the `tournament.addPlayer` case (after its closing `}` on line 111):

```js
    case 'tournament.removePlayer': {
      t.players = (t.players ?? []).filter((p) => p.id !== m.playerId);
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (!round) continue;
        const handicaps = { ...(round.playerHandicaps ?? {}) };
        delete handicaps[m.playerId];
        round.playerHandicaps = handicaps;
        const scores = { ...(round.scores ?? {}) };
        delete scores[m.playerId];
        round.scores = scores;
        const shotDetails = { ...(round.shotDetails ?? {}) };
        delete shotDetails[m.playerId];
        round.shotDetails = shotDetails;
        if (patch.pairs) round.pairs = patch.pairs;
      }
      if (m.nextScoringMode) {
        t.settings = { ...(t.settings ?? {}), scoringMode: m.nextScoringMode };
      }
      break;
    }
```

Note: `patch.pairs` may legitimately be an empty array `[]` for a not-yet-revealed round whose pairs were already empty. `if (patch.pairs)` is truthy for `[]`, so an empty array is still assigned — which is correct (it matches the round's prior empty state). The guard only skips assignment when `pairs` is `null`/`undefined`, which `removePlayerRoundPatches` never produces.

- [ ] **Step 5: Run the tests**

Run: `npx jest src/store/__tests__/addPlayerMutation.test.js`
Expected: all tests pass (the original 5 + the 5 new ones).

- [ ] **Step 6: Run the full suite**

Run: `npm test -- --silent`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/store/mutate.js src/store/__tests__/addPlayerMutation.test.js
git commit -m "feat(mutate): tournament.removePlayer drops player data and applies mode atomically"
```

---

## Task 3: `PlayerRemoveSheet` component

**Goal:** A bottom-sheet modal listing removable players; tapping a row selects that player for removal.

**Files:**
- Create: `src/components/PlayerRemoveSheet.js`

- [ ] **Step 1: Read the sibling component for the exact theme/style conventions**

Run: `cat src/components/ScoringModeChangeSheet.js`

`ScoringModeChangeSheet.js` is the closest sibling — it is a bottom-sheet modal built in the add-player feature. Note its exact theme import line, the `useTheme` destructure form, the theme token names (`theme.bg.*`, `theme.text.*`, `theme.accent.*`, `theme.border.*`), the font family names, and the `makeStyles(theme)` pattern. The new component MUST use the same conventions — do not invent token names.

- [ ] **Step 2: Create the component**

Create `src/components/PlayerRemoveSheet.js`. Use the theme import, `useTheme` destructure form, token names, and font names exactly as observed in `ScoringModeChangeSheet.js` in Step 1. The structure below is the contract; adjust only the theme/style specifics to match the sibling:

```js
// Bottom-sheet modal for picking a player to remove from an in-progress
// game. The parent supplies `players` already filtered (the meId player is
// excluded by the caller). Parent controls `visible`; selecting a row calls
// onSelect(playerId), dismissing calls onCancel().
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function PlayerRemoveSheet({ visible, players, onSelect, onCancel }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <SafeAreaView style={s.sheet}>
          <Text style={s.title}>Remove a player</Text>
          <Text style={s.subtitle}>
            Their scores for this round will be removed.
          </Text>
          <View style={s.list}>
            {(players ?? []).map((player) => (
              <TouchableOpacity
                key={player.id}
                style={s.row}
                onPress={() => onSelect(player.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${player.name}`}
              >
                <Feather name="user-x" size={20} color={theme.accent.primary} />
                <View style={s.rowText}>
                  <Text style={s.rowLabel}>{player.name}</Text>
                  <Text style={s.rowSubtitle}>Handicap {player.handicap ?? 0}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.text.muted} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: theme.bg.primary,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
    },
    title: { fontSize: 18, fontWeight: '600', color: theme.text.primary, marginBottom: 4 },
    subtitle: { fontSize: 13, color: theme.text.muted, marginBottom: 12 },
    list: { marginBottom: 16 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 8,
      marginBottom: 4,
    },
    rowText: { flex: 1, marginLeft: 12 },
    rowLabel: { fontSize: 15, fontWeight: '500', color: theme.text.primary },
    rowSubtitle: { fontSize: 12, color: theme.text.muted, marginTop: 2 },
    cancelBtn: {
      padding: 12, alignItems: 'center',
      borderRadius: 8, backgroundColor: theme.bg.secondary,
    },
    cancelText: { color: theme.text.primary, fontWeight: '500' },
  });
}
```

If `ScoringModeChangeSheet.js` applies font families (e.g. `fontFamily: 'PlusJakartaSans-SemiBold'`) on its text styles instead of `fontWeight`, mirror that exactly here. If its `theme.bg.secondary` token has a different name, use the observed name.

- [ ] **Step 3: Verify nothing broke**

Run: `npm test -- --silent`
Expected: all tests still pass (the file is not imported anywhere yet; this just confirms no syntax/import error breaks the Jest module graph).

- [ ] **Step 4: Commit**

```bash
git add src/components/PlayerRemoveSheet.js
git commit -m "feat(components): PlayerRemoveSheet for mid-round player removal"
```

---

## Task 4: HomeScreen wiring

**Goal:** A "Remove Player" settings item that opens `PlayerRemoveSheet`, with a two-pass flow that prompts for a new mode when removal breaks the current one, and a hard floor at 2 players.

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Read the current add-player wiring and imports**

Run:

```bash
grep -n "addPlayerRoundPatches\|ScoringModeChangeSheet\|modePrompt\|applyAddPlayers\|commitAdds\|Alert\|isScoringModeAllowed\|Add Player" src/screens/HomeScreen.js
```

Note: the line numbers of the imports, the `modePrompt` state, the `commitAdds` / `applyAddPlayers` callbacks, the rendered `<ScoringModeChangeSheet>`, and the "Add Player" `<TouchableOpacity>` in the settings sheet. Confirm whether `Alert` is already imported from `react-native` (if not, you will add it in Step 3).

- [ ] **Step 2: Add the store import**

In `src/screens/HomeScreen.js`, find the import of `addPlayerRoundPatches` from `'../store/tournamentStore'` (it is imported alongside `matchPlayRoundTally`). Add `removePlayerRoundPatches` to that same import list. For example, if the line reads:

```js
  matchPlayRoundTally, addPlayerRoundPatches,
```

change it to:

```js
  matchPlayRoundTally, addPlayerRoundPatches, removePlayerRoundPatches,
```

- [ ] **Step 3: Ensure `PlayerRemoveSheet` and `Alert` are imported**

Add the component import near the existing `ScoringModeChangeSheet` import:

```js
import PlayerRemoveSheet from '../components/PlayerRemoveSheet';
```

Confirm `Alert` is imported from `react-native`. If the `react-native` import block does not already include `Alert`, add it to that destructured import.

- [ ] **Step 4: Add state**

Near the existing `modePrompt` state declaration, add two more state hooks:

```js
const [removeSheetOpen, setRemoveSheetOpen] = useState(false);
const [removeModePrompt, setRemoveModePrompt] = useState(null);
// removeModePrompt: { playerId, newCount, defaultMode, prevMode } when prompting, null otherwise
```

- [ ] **Step 5: Add the `commitRemove` and `applyRemovePlayer` callbacks**

Directly after the existing `applyAddPlayers` `useCallback`, add:

```js
const commitRemove = useCallback(async (playerId, chosenMode) => {
  let t = await loadTournament();
  if (!t) return;
  const { patches: roundPatches, nextScoringMode } =
    removePlayerRoundPatches(t, playerId, { mode: chosenMode });
  const modeChanged = nextScoringMode !== (t.settings?.scoringMode ?? 'stableford');
  t = await mutate(t, {
    type: 'tournament.removePlayer',
    playerId,
    roundPatches,
    ...(modeChanged ? { nextScoringMode } : {}),
  });
  setTournament(t);
}, []);

const applyRemovePlayer = useCallback(async (playerId) => {
  const t = await loadTournament();
  if (!t) return;
  const newCount = (t.players ?? []).length - 1;
  if (newCount < 2) {
    Alert.alert('Cannot remove', 'A game needs at least 2 players.');
    return;
  }
  const currentMode = t.settings?.scoringMode ?? 'stableford';
  if (isScoringModeAllowed(currentMode, newCount)) {
    await commitRemove(playerId, undefined);
    return;
  }
  setRemoveModePrompt({
    playerId,
    newCount,
    defaultMode: fallbackScoringMode(newCount),
    prevMode: currentMode,
  });
}, [commitRemove]);
```

`isScoringModeAllowed`, `fallbackScoringMode`, and `getScoringMode` are already imported in `HomeScreen.js` (added during the add-player feature). Confirm via the Step 1 grep; if any is missing from the `'../components/scoringModes'` import, add it.

- [ ] **Step 6: Add the "Remove Player" settings item**

In the settings sheet JSX, find the "Add Player" `<TouchableOpacity>` block (its `<Text>` reads `Add Player`). Directly after that block's closing `)}`, add:

```jsx
          {!isViewer && tournament.players.length > 2 && (
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => {
                setShowSettings(false);
                setRemoveSheetOpen(true);
              }}
              activeOpacity={0.7}
            >
              <Feather name="user-x" size={18} color={theme.accent.primary} />
              <Text style={s.menuItemText}>Remove Player</Text>
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          )}
```

- [ ] **Step 7: Render `PlayerRemoveSheet` and the remove-side `ScoringModeChangeSheet`**

Find the rendered `<ScoringModeChangeSheet>` (the add-player prompt). Directly after it, add:

```jsx
<PlayerRemoveSheet
  visible={removeSheetOpen}
  players={(tournament?.players ?? []).filter((p) => p.id !== tournament?.meId)}
  onSelect={(playerId) => {
    setRemoveSheetOpen(false);
    applyRemovePlayer(playerId);
  }}
  onCancel={() => setRemoveSheetOpen(false)}
/>
<ScoringModeChangeSheet
  visible={!!removeModePrompt}
  playerCount={removeModePrompt?.newCount ?? 0}
  defaultMode={removeModePrompt?.defaultMode}
  title="Pick a new scoring mode"
  subtitle={
    removeModePrompt
      ? `Removing this player makes ${getScoringMode(removeModePrompt.prevMode).label} invalid (${getScoringMode(removeModePrompt.prevMode).requirement.toLowerCase()}). Pick a mode for ${removeModePrompt.newCount} players.`
      : undefined
  }
  onConfirm={async (chosenMode) => {
    const playerId = removeModePrompt.playerId;
    setRemoveModePrompt(null);
    await commitRemove(playerId, chosenMode);
  }}
  onCancel={() => setRemoveModePrompt(null)}
/>
```

- [ ] **Step 8: Run the full suite**

Run: `npm test -- --silent`
Expected: all tests pass.

- [ ] **Step 9: Smoke-test (if a browser can be launched)**

Run: `npm run web`

1. Create a casual 4-player bestball game.
2. Open settings → "Remove Player" appears → tap it.
3. `PlayerRemoveSheet` lists 3 players (the `meId` player is excluded). Tap one.
4. Because bestball is invalid at 3, the mode prompt appears: *"Removing this player makes Best Ball / Worst Ball invalid (requires exactly 4 players). Pick a mode for 3 players."* with `Stableford with Partners` pre-selected.
5. Tap Continue → player removed, mode is now stableford, scorecard shows 3 players, removed player's scores gone.
6. Repeat in a 3-player game and confirm "Remove Player" still shows; in a 2-player game confirm it does NOT show.

If `npm run web` cannot be launched headlessly, skip this step — Task 5 covers the manual smoke matrix.

- [ ] **Step 10: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat(HomeScreen): Remove Player settings item with mode-fallback prompt"
```

---

## Task 5: Final verification

**Goal:** Lint, full test suite, manual smoke matrix. No push — the user runs the smoke matrix first.

**Files:** None modified — verification only.

- [ ] **Step 1: Lint**

Run: `npm run lint`

The project has a pre-existing ESLint infrastructure error (`Cannot find module 'typescript'`). If that is the ONLY failure, lint is effectively green. If there are real ESLint rule violations on the files touched in this branch (`src/store/tournamentStore.js`, `src/store/mutate.js`, `src/components/PlayerRemoveSheet.js`, `src/screens/HomeScreen.js`, and the two test files), report and fix them.

- [ ] **Step 2: Full test suite**

Run: `npm test -- --silent`
Expected: all green.

- [ ] **Step 3: Manual smoke matrix**

Document this matrix for the user to run in `npm run web`:

| Start mode | Players | Action | Expected |
|---|---|---|---|
| bestball | 4 | Remove Player → pick one → prompt → stableford | Mode = stableford; 3-player layout; removed player's scores gone; banner shows |
| bestball | 4 | Remove Player → pick one → prompt → Cancel | No removal; mode stays bestball |
| sindicato | 3 | Remove Player → prompt (sindicato invalid at 2) → individual | Mode = individual; 2-player layout |
| stableford | 3 | Remove Player → prompt (stableford needs 3+) → individual | Mode = individual; 2-player layout |
| stableford | 4 | Remove Player → no prompt | Mode stays stableford; removed player dropped from their pair, other pair preserved |
| individual | 4 | Remove Player → no prompt | Mode stays individual; 3 solo players |
| any | 2 | Open settings | "Remove Player" item is NOT shown |
| any | 3+ | Open PlayerRemoveSheet | The `meId` player is not in the list |

- [ ] **Step 4: Report**

Report the lint result, the test count, the list of Task 1–4 commit SHAs with subjects, and a "ready for human smoke test" verdict. Do NOT push the branch.

---

## Self-review summary

Coverage map vs. the spec:

- `removePlayerRoundPatches` + mode resolution — Task 1.
- `buildPairsForRemovedPlayer` pair rules (non-team, team→team preserve, empty-pair discard, unrevealed randomize) — Task 1.
- Multi-round `currentRound` gate — Task 1.
- `tournament.removePlayer` mutation (drop player, delete scores/shotDetails/handicaps, set pairs, atomic mode) — Task 2.
- `metaPathFor` LWW paths — Task 2.
- `PlayerRemoveSheet` component — Task 3.
- "Remove Player" settings item with `> 2` gate — Task 4.
- Two-pass prompt + `< 2` hard floor — Task 4.
- `meId` excluded from the removable list — Task 4 (Step 7 filter).
- Banner on mode change — no task needed; the existing `ScorecardScreen` banner already fires on any `settings.scoringMode` change.
