# Official Tournament Creation via Setup Wizard — Delta Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move official-tournament *creation* out of the standalone `OfficialSetupScreen` and into the shared `SetupScreen` wizard as a third `kind` (`'official'`), and repurpose `OfficialSetupScreen` as the post-creation management screen.

**Why:** Official tournaments should be created through the same flow as games/tournaments (the spec's "shared engine" intent). `OfficialSetupScreen` from the original Task 11 sidestepped the wizard.

**Context:** Amends the Official Tournament Core feature (spec `docs/superpowers/specs/2026-05-17-official-tournament-core-design.md`, "Admin flow" section, updated 2026-05-18). The data layer (`officialAdmin.js`, `officialScoring.js`), the `PartyBoard`/`OfficialAdmin`/`JoinOfficial` screens, and the scorecard official mode are already built and unchanged by this delta.

**Wizard today:** `SetupScreen` is a stepped wizard; `route.params.kind` is `'game'` | `'tournament'`. `setupWizard.js` exports `wizardSteps(kind, playerCount)` and `isStepValid(stepKey, state)`. Casual steps: `Players → Course|Rounds → [Scoring] → Review`. Creation is `createTournament` + `saveTournament` (casual blob).

---

## Task W1: Official step model in `setupWizard.js`

**Files:**
- Modify: `src/screens/setupWizard.js`
- Test: `src/screens/__tests__/setupWizard.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/screens/__tests__/setupWizard.test.js` a describe block covering official:

```js
import { wizardSteps, isStepValid } from '../setupWizard';

describe('official kind', () => {
  test('official steps are roster, rounds, format, review', () => {
    expect(wizardSteps('official', 0)).toEqual(['roster', 'rounds', 'format', 'review']);
    // player count does not change official steps (format always applies)
    expect(wizardSteps('official', 8)).toEqual(['roster', 'rounds', 'format', 'review']);
  });

  test('roster step needs at least one roster entry', () => {
    expect(isStepValid('roster', { roster: [], rounds: [] })).toBe(false);
    expect(isStepValid('roster', { roster: [{ displayName: 'Ann' }], rounds: [] })).toBe(true);
  });

  test('a roster entry with a blank name is invalid', () => {
    expect(isStepValid('roster', { roster: [{ displayName: '  ' }], rounds: [] })).toBe(false);
  });

  test('format step is always valid', () => {
    expect(isStepValid('format', { roster: [], rounds: [] })).toBe(true);
  });
});
```

(If the test file already imports `wizardSteps`/`isStepValid` at the top, merge — do not add a duplicate import.)

- [ ] **Step 2: Run, confirm fail**

Run: `npx jest src/screens/__tests__/setupWizard.test.js -t "official kind"`
Expected: FAIL (`wizardSteps('official', ...)` returns the wrong shape).

- [ ] **Step 3: Implement**

In `src/screens/setupWizard.js`:
- Extend `wizardSteps` so `kind === 'official'` returns `['roster', 'rounds', 'format', 'review']` (independent of `playerCount`). Leave the `'game'`/`'tournament'` branches exactly as they are.
- Extend `isStepValid` with a `case 'roster':` returning true when `roster` is a non-empty array AND every entry has a non-empty trimmed `displayName`; and a `case 'format':` returning `true`. Read `roster` from the state arg (add it to the destructure: `{ players, rounds, roster }`). Keep existing cases unchanged.
- Update the JSDoc to mention `'official'` and the `roster` state field.

- [ ] **Step 4: Run, confirm pass**

Run: `npx jest src/screens/__tests__/setupWizard.test.js`
Expected: PASS (existing tests + the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/screens/setupWizard.js src/screens/__tests__/setupWizard.test.js
git commit -m "feat: official kind in setup-wizard step model"
```

---

## Task W2: Official mode in `SetupScreen.js`

**Files:**
- Modify: `src/screens/SetupScreen.js`

`SetupScreen` is a large wizard component. Read it fully first — the `kind`
derivation, `step` state, the per-step render switch, `players`/`rounds`/
`settings` state, `handleStart()`, and how `WizardProgress`/`WizardNav` and
`wizardSteps`/`isStepValid` are used. The official branch is ADDITIVE — the
`game`/`tournament` paths must stay byte-for-byte behaviourally unchanged.

- [ ] **Step 1: Accept the official kind**

The current line is `const kind = route?.params?.kind === 'game' ? 'game' : 'tournament';`. Change it so `kind` can also be `'official'`: `'game'` and `'official'` pass through, anything else is `'tournament'`. Add an `isOfficial` boolean derived from it for readability.

- [ ] **Step 2: Add roster state**

Add `const [roster, setRoster] = useState([]);` — an array of `{ displayName, handicap }`. Pass `roster` into the `isStepValid(...)` call's state object so the roster step gates correctly. `wizardSteps(kind, players.length)` already returns the official step list from Task W1.

- [ ] **Step 3: Render the Roster step (official only)**

Add a `case 'roster':` to the step render switch. It is an INLINE editor (no navigation out, unlike the casual Players step):
- A list of current roster rows — each shows `displayName` + `handicap` with a remove (✕) control.
- An "Add player" sub-form: a name `TextInput` + a numeric handicap `TextInput` + an Add button that appends `{ displayName: name.trim(), handicap: Number(hcp) || 0 }` to `roster` and clears the inputs.
- Use the wizard's existing serif step-prompt styling (match the casual Players step's header treatment). Keep it within `SetupScreen`'s existing `makeStyles`.

- [ ] **Step 4: Render the Format step (official only)**

Add a `case 'format':` to the step render switch — a simple single-select of the four official round formats with labels:
- `gross_net` → "Stroke play (gross & net)"
- `stableford` → "Stableford"
- `pairs` → "Pairs (Best Ball / Sindicato)"
- `match` → "Match play"
Store the choice in a new `const [officialFormat, setOfficialFormat] = useState('stableford');`. Render as tappable option rows consistent with the wizard's style. (Do NOT reuse `ScoringModePicker` — its value set is the casual scoring modes, not these four.)

- [ ] **Step 5: Reuse the Rounds step for official**

The official step list includes `'rounds'`. The existing `'rounds'` case (course-per-round picker) is reused as-is for official — an official tournament has one or more rounds each with a course. No change needed beyond confirming the existing `rounds` case renders for `kind === 'official'` (it keys off the step, not the kind).

- [ ] **Step 6: Official creation on Review/Start**

In `handleStart()` (or the Review step's start action), branch on `isOfficial`:
- Casual path: unchanged (`createTournament` + `saveTournament`).
- Official path: import the data layer — `import { createOfficialTournament, addRosterPlayer, createRound } from '../store/officialAdmin';`. Then:
  1. `const tournamentId = await createOfficialTournament({ name: tournamentName });`
  2. For each `roster` entry: `await addRosterPlayer(tournamentId, { displayName, handicap });`
  3. For each round in `rounds` (index `i`): `await createRound(tournamentId, { roundIndex: i, course: <holes for that round>, format: officialFormat });` — pass the round's course holes as the `course` jsonb (use whatever shape the casual rounds state already holds for a round's course/holes; `tournament_rounds.course` is a free-form jsonb the scorecard reads via `officialHolesFromCourse`).
  4. `navigation.navigate('OfficialSetup', { tournamentId });`
- Guard with a busy flag (disable the Start button while creating) and surface errors, consistent with the screen's existing patterns.

- [ ] **Step 7: Verify**

Run: `npx jest src/screens/__tests__/` — all pass. `npx jest --listTests` exits 0. (`npm run lint` is broken repo-wide — skip.) Cannot run the app.

- [ ] **Step 8: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "feat: official-tournament creation in the setup wizard"
```

---

## Task W3: Repurpose `OfficialSetupScreen` as the management screen

**Files:**
- Modify: `src/screens/OfficialSetupScreen.js`

`OfficialSetupScreen` currently CREATES an official tournament (name field +
Create button) and then shows roster/rules/rounds. After this delta the wizard
creates it; this screen becomes the post-creation MANAGEMENT screen for an
existing official tournament. Read the current file first.

- [ ] **Step 1: Take a `tournamentId` param instead of creating**

- Read `route.params.tournamentId`. On mount, load the tournament (its `name` and `data` blob) and its roster (`listRoster(tournamentId)`).
- Remove the name `TextInput` + "Create" button and the `createOfficialTournament` call. The screen now always operates on an existing tournament id from the param. Show a loading state while the initial load runs and an error state if `tournamentId` is missing or the load fails.

- [ ] **Step 2: Keep roster + rounds + rules management**

Keep, unchanged, everything that manages an existing tournament:
- Roster list with each player's invite link (copy + QR), "Regenerate link" (`regenerateToken`), "Withdraw"/"Reinstate" (`withdrawPlayer`).
- The "Add player" form — `addRosterPlayer(tournamentId, ...)` — so a late entrant can still be added after creation.
- "Local rules & notes" editor — `saveTournamentData(tournamentId, data, { rules })`.
- The Rounds section: list existing rounds (load from `tournament_rounds` for the tournament) and keep "Add round" (`createRound`) → navigate to `PartyBoard` with `{ tournamentId, roundId }`. Also allow opening an existing round's `PartyBoard`.
- Keep the `mountedRef` / in-flight-guard patterns already in the file.

- [ ] **Step 3: Verify**

Run: `npx jest src/store/__tests__/` — all pass. `npx jest --listTests` exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/screens/OfficialSetupScreen.js
git commit -m "refactor: OfficialSetupScreen becomes the official-tournament management screen"
```

---

## Task W4: Wire the entry point and route param

**Files:**
- Modify: `src/screens/HomeScreen.js`
- Modify: `App.js` (only if a clarifying comment helps — likely no code change)

- [ ] **Step 1: Point the Home entry at the wizard**

In `src/screens/HomeScreen.js`, the play-menu "Official Tournament" item currently does `navigation.navigate('OfficialSetup')`. Change it to `navigation.navigate('Setup', { kind: 'official' })` so creating an official tournament starts the shared wizard.

- [ ] **Step 2: Confirm the `OfficialSetup` route**

`App.js` keeps `<Stack.Screen name="OfficialSetup" component={OfficialSetupScreen} />` — the route is unchanged; it is now reached with a `{ tournamentId }` param (from the wizard's Step W2.6 navigation). No code change unless a clarifying comment helps. Do not remove the route.

- [ ] **Step 3: Verify**

Run: `npx jest --listTests` exits 0. `npx jest` — full suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js App.js
git commit -m "feat: route official-tournament creation through the setup wizard"
```

---

## Out of scope (follow-ups)

- Reaching an existing official tournament's management screen from the Home
  tournament list (browsing past official tournaments). The wizard → management
  navigation works; list-based re-entry is a later enhancement.
- Per-round (rather than per-tournament) format selection — Core uses one
  `officialFormat` for all rounds, written to each `tournament_rounds.format`.

## Self-review notes

- W1 is pure + TDD. W2/W3 are UI; verification is jest import-graph + existing
  suites (the app cannot be run here; `npm run lint` is broken repo-wide).
- Casual `game`/`tournament` wizard paths must stay unchanged — W2 is strictly
  additive behind `kind === 'official'` / `isOfficial`.
- Data-layer functions used (`createOfficialTournament`, `addRosterPlayer`,
  `createRound`, `listRoster`, `regenerateToken`, `withdrawPlayer`,
  `saveTournamentData`) all already exist in `src/store/officialAdmin.js`.
