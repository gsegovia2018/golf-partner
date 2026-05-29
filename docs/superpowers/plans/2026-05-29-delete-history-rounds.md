# Delete History Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to delete completed historical rounds inside multi-round tournaments while retaining whole finished game/tournament deletion directly from the archive.

**Architecture:** Keep destructive round removal in `EditTournamentScreen`, but extract small pure helpers so eligibility and confirmation copy are tested without rendering the large editor. The deletion itself continues to use `mutate(..., { type: 'round.remove' })`, preserving sync tombstones.

**Tech Stack:** Expo SDK 54, React Native, Jest, existing store mutation layer.

---

## File Map

- Modify: `src/screens/EditTournamentScreen.js` exposes finished-round deletion and delegates delete-state logic to pure helpers.
- Modify: `src/screens/HistoryScreen.js` exposes owner delete buttons on finished archive cards.
- Create: `src/screens/editTournamentRoundDeletion.js` holds delete eligibility and confirmation-copy helpers.
- Create: `src/screens/__tests__/editTournamentRoundDeletion.test.js` covers helper behavior.
- Create: `src/store/__tests__/roundRemoveMutation.test.js` adds coverage that `round.remove` stamps the deletion tombstone.
- Create: `src/screens/__tests__/HistoryScreen.test.js` covers the archive delete affordance for single-round games.

---

### Task 1: Add Tested Round Deletion Helpers

**Files:**
- Create: `src/screens/editTournamentRoundDeletion.js`
- Create: `src/screens/__tests__/editTournamentRoundDeletion.test.js`

- [ ] **Step 1: Write the failing helper tests**

Create `src/screens/__tests__/editTournamentRoundDeletion.test.js`:

```javascript
import {
  canRemoveRoundFromEditor,
  roundRemovalConfirmation,
} from '../editTournamentRoundDeletion';

const players = [{ id: 'p1' }, { id: 'p2' }];
const holes = [{ number: 1 }, { number: 2 }];

function completeRound(id = 'r1') {
  return {
    id,
    holes,
    scores: {
      p1: { 1: 4, 2: 5 },
      p2: { 1: 5, 2: 6 },
    },
  };
}

test('allows deleting a completed round when another round remains', () => {
  const tournament = { players, rounds: [completeRound('r1'), completeRound('r2')] };
  expect(canRemoveRoundFromEditor(tournament, 0)).toBe(true);
});

test('blocks deleting the only round individually', () => {
  const tournament = { players, rounds: [completeRound('r1')] };
  expect(canRemoveRoundFromEditor(tournament, 0)).toBe(false);
});

test('uses history-round confirmation copy for completed rounds', () => {
  const round = completeRound('r1');
  expect(roundRemovalConfirmation({ round, roundIndex: 0, players, tournament: { rounds: [round, completeRound('r2')] } }))
    .toEqual({
      title: 'Delete history round',
      message: 'Delete Round 1 from history? This permanently removes its scores and stats.',
      confirmLabel: 'Delete history round',
    });
});

test('uses history-round confirmation copy for archived rounds', () => {
  const round = { id: 'r1', holes, scores: {} };
  expect(roundRemovalConfirmation({ round, roundIndex: 0, players, tournament: { finishedAt: 123, rounds: [round, completeRound('r2')] } }).confirmLabel)
    .toBe('Delete history round');
});

test('keeps entered-score warning for partial rounds', () => {
  const round = { id: 'r1', holes, scores: { p1: { 1: 4 } } };
  expect(roundRemovalConfirmation({ round, roundIndex: 0, players, tournament: { rounds: [round, completeRound('r2')] } }))
    .toEqual({
      title: 'Remove round',
      message: 'Round 1 has scores entered for 1 hole. Removing it will permanently delete those scores.',
      confirmLabel: 'Delete round & scores',
    });
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `npx jest src/screens/__tests__/editTournamentRoundDeletion.test.js --runInBand`

Expected: FAIL because `../editTournamentRoundDeletion` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/screens/editTournamentRoundDeletion.js`:

```javascript
import { isRoundComplete, roundEnteredCount } from '../store/tournamentStore';

export function canRemoveRoundFromEditor(tournament, roundIndex) {
  const rounds = tournament?.rounds ?? [];
  return roundIndex >= 0 && roundIndex < rounds.length && rounds.length > 1;
}

export function roundRemovalConfirmation({ round, roundIndex, players, tournament }) {
  const entered = round ? roundEnteredCount(round, players) : 0;
  const isHistoryRound = !!tournament?.finishedAt || isRoundComplete(round, players);
  const label = `Round ${roundIndex + 1}`;

  if (isHistoryRound) {
    return {
      title: 'Delete history round',
      message: `Delete ${label} from history? This permanently removes its scores and stats.`,
      confirmLabel: 'Delete history round',
    };
  }

  if (entered > 0) {
    return {
      title: 'Remove round',
      message: `${label} has scores entered for ${entered} hole${entered !== 1 ? 's' : ''}. Removing it will permanently delete those scores.`,
      confirmLabel: 'Delete round & scores',
    };
  }

  return {
    title: 'Remove round',
    message: `Remove ${label}?`,
    confirmLabel: 'Remove',
  };
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `npx jest src/screens/__tests__/editTournamentRoundDeletion.test.js --runInBand`

Expected: PASS.

---

### Task 2: Wire Helpers Into EditTournamentScreen

**Files:**
- Modify: `src/screens/EditTournamentScreen.js`

- [ ] **Step 1: Update imports**

Add:

```javascript
import {
  canRemoveRoundFromEditor,
  roundRemovalConfirmation,
} from './editTournamentRoundDeletion';
```

Remove `roundEnteredCount` and `isRoundComplete` from the `../store/tournamentStore` import if they become unused.

- [ ] **Step 2: Update `removeRound` confirmation**

Replace the inline `entered` and `confirmDialog` setup in `removeRound(index)` with:

```javascript
    const confirmation = roundRemovalConfirmation({
      round: target,
      roundIndex: index,
      players,
      tournament: tournamentRef.current,
    });
    const ok = await confirmDialog(
      confirmation.title,
      confirmation.message,
      confirmation.confirmLabel,
    );
```

- [ ] **Step 3: Update round remove visibility**

Inside the round map, replace the `finished` variable and remove-button condition with:

```javascript
          const canRemove = canRemoveRoundFromEditor(tournament, ri);
```

and:

```javascript
              {canRemove && (
                <TouchableOpacity onPress={() => removeRound(ri)} style={s.removeBtn}>
```

- [ ] **Step 4: Run targeted lint**

Run: `npx eslint src/screens/EditTournamentScreen.js src/screens/editTournamentRoundDeletion.js`

Expected: exit code 0.

---

### Task 3: Cover Sync Tombstone Behavior

**Files:**
- Modify: `src/store/__tests__/tournamentStore.test.js`

- [ ] **Step 1: Write failing mutation test**

Append to `src/store/__tests__/tournamentStore.test.js`:

```javascript
describe('round.remove mutation', () => {
  test('removes the round and stamps the deletion tombstone path', async () => {
    jest.resetModules();
    jest.doMock('../../lib/connectivity', () => ({ isOnline: () => false }));
    jest.doMock('../syncWorker', () => ({ scheduleSync: jest.fn() }));
    const { mutate } = require('../mutate');

    const tournament = {
      id: 't1',
      name: 'Cup',
      createdAt: '2026-05-29T10:00:00Z',
      rounds: [{ id: 'r1' }, { id: 'r2' }],
      players: [],
    };

    const updated = await mutate(tournament, {
      type: 'round.remove',
      roundId: 'r1',
      ts: 99,
    });

    expect(updated.rounds.map((r) => r.id)).toEqual(['r2']);
    expect(updated._meta['rounds.r1._deleted']).toBe(99);
  });
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `npx jest src/store/__tests__/tournamentStore.test.js --runInBand`

Expected: PASS if the existing mutation layer already stamps tombstones; if it fails, fix `src/store/mutate.js` so `metaPathFor({ type: 'round.remove' })` returns `rounds.<roundId>._deleted`.

---

### Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run targeted tests**

Run: `npx jest src/screens/__tests__/editTournamentRoundDeletion.test.js src/store/__tests__/tournamentStore.test.js --runInBand`

Expected: PASS.

- [ ] **Step 2: Run targeted lint**

Run: `npx eslint src/screens/EditTournamentScreen.js src/screens/editTournamentRoundDeletion.js src/screens/__tests__/editTournamentRoundDeletion.test.js src/store/__tests__/tournamentStore.test.js`

Expected: exit code 0.

- [ ] **Step 3: Check worktree diff**

Run: `git diff -- src/screens/EditTournamentScreen.js src/screens/editTournamentRoundDeletion.js src/screens/__tests__/editTournamentRoundDeletion.test.js src/store/__tests__/tournamentStore.test.js docs/superpowers/specs/2026-05-29-delete-history-rounds-design.md docs/superpowers/plans/2026-05-29-delete-history-rounds.md`

Expected: diff only contains this feature.
