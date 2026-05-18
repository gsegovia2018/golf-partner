# Official Tournament — Dedicated Setup Screen — Delta Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Official-tournament creation gets its own dedicated screen (`OfficialCreateScreen`), reached by a Casual/Official choice after tapping **New Tournament**. Remove the official mode that was folded into the `SetupScreen` wizard (the toggle, roster/format steps, official `handleStart`). `SetupScreen` returns to pure casual New Game / New Tournament.

**Why:** Earlier iterations put official creation inside the casual wizard (as a `kind` then a toggle). The desired UX is a dedicated screen, entered via a choice after New Tournament — not a slider inside the casual flow.

**Keep:** `setupWizard.js`'s `'official'` support (`wizardSteps`/`isStepValid` — the new screen reuses them), `WizardProgress`/`WizardNav` components, the whole official data layer + management screen (`OfficialSetupScreen`, post-repurpose) + `PartyBoard`/`OfficialAdmin`/`JoinOfficial`/scorecard official mode — all unchanged.

---

## Task X1: Dedicated `OfficialCreateScreen`

**Files:**
- Create: `src/screens/OfficialCreateScreen.js`
- Modify: `App.js` (register route `OfficialCreate`)

- [ ] **Step 1: Build the screen**

Create `src/screens/OfficialCreateScreen.js` — a self-contained stepped wizard for creating an official tournament. It reuses the wizard chrome: `WizardProgress` and `WizardNav` from `src/components/setup/`, and `wizardSteps('official', 0)` / `isStepValid` from `src/screens/setupWizard.js` (these already return `['roster','rounds','format','review']` and gate the `roster`/`format` steps). Use `ScreenContainer`, `useTheme()` + `makeStyles(theme)`, and the `mountedRef` / in-flight-guard patterns used by `OfficialSetupScreen.js` and `PartyBoardScreen.js`.

Reference: `src/screens/SetupScreen.js` currently contains an official mode (a roster step, a format step, an official `handleStart` branch, an `officialCourseFor` helper, an `OFFICIAL_FORMATS` constant). That code is the basis for this screen — extract/adapt it here. Task X2 then removes it from `SetupScreen`.

Steps:
- **Roster** — inline editor: a `tournamentName` text field at the top; a list of roster rows (`{ id, displayName, handicap }`) each with a remove (✕); an "Add player" sub-form (name + numeric handicap + Add). Same behaviour as the roster step `SetupScreen` currently has in official mode.
- **Rounds** — add one or more rounds, each with a course. Reuse the established course-selection pattern: navigate to `CoursePicker` and consume the result via `consumePendingCourses()` from `src/lib/selectionBridge` (this is exactly how `SetupScreen` handles courses — read that for the round/course state shape and the `useFocusEffect` consume logic). Because picking a course pushes `CoursePicker` on top, this screen stays mounted and its `step` state survives the round-trip.
- **Format** — single-select of the four official formats: `gross_net` "Stroke play (gross & net)", `stableford` "Stableford", `pairs` "Pairs (Best Ball / Sindicato)", `match` "Match play". Default `stableford`.
- **Review** — summary of roster count, rounds, format; a Start/Create action.

On Create (busy-guarded, errors surfaced): import `{ createOfficialTournament, addRosterPlayer, createRound }` from `../store/officialAdmin`. Do:
1. `const tournamentId = await createOfficialTournament({ name: tournamentName });`
2. for each roster entry → `await addRosterPlayer(tournamentId, { displayName, handicap });`
3. for each round `i` → `await createRound(tournamentId, { roundIndex: i, course: officialCourseFor(round), format: officialFormat });` where `officialCourseFor` projects a round to `{ name, holes, slope, courseRating }` (the same helper SetupScreen currently has — copy it in).
4. `navigation.navigate('OfficialSetup', { tournamentId });`

Partial-failure handling: declare `let tournamentId = null;` before the try; if a later step throws after the tournament row exists, still `navigation.navigate('OfficialSetup', { tournamentId })` with a message that some setup did not finish (so the admin completes it in the management screen) — never strand them where a retry double-creates. If `createOfficialTournament` itself failed, show an error and stay.

- [ ] **Step 2: Register the route**

In `App.js`, add `import OfficialCreateScreen from './src/screens/OfficialCreateScreen';` with the other screen imports and `<Stack.Screen name="OfficialCreate" component={OfficialCreateScreen} />` near `OfficialSetup`.

- [ ] **Step 3: Verify**

`npx jest` — full suite passes. `npx jest --listTests` exits 0. (`npm run lint` broken repo-wide — skip.) Cannot run the app.

- [ ] **Step 4: Commit**

```bash
git add src/screens/OfficialCreateScreen.js App.js
git commit -m "feat: dedicated official-tournament setup screen"
```

---

## Task X2: Remove official mode from `SetupScreen.js`

**Files:**
- Modify: `src/screens/SetupScreen.js`

`SetupScreen` must return to a pure casual New Game / New Tournament wizard. Read the file; remove everything that was added for official mode in the earlier iterations:

- The "Official tournament" toggle (the `Switch` row / `officialToggle*` styles) and the `official`/`setOfficial` state.
- The `roster` / `officialFormat` (and any `rosterName`/`rosterHcp`/`busy`-for-official) state, `newRosterId`/`_rosterIdSeq`, `handleAddRosterEntry`.
- The `renderRosterStep` and `renderFormatStep` functions and their `case 'roster'` / `case 'format'` entries in the step render switch.
- The `OFFICIAL_FORMATS` constant and the `officialCourseFor` helper.
- The official branch in `handleStart` and the official-aware ternaries in the Review step — restore them to their pre-official casual form.
- The `createOfficialTournament` / `addRosterPlayer` / `createRound` import.
- The `kind` derivation returns to casual only: `const kind = route?.params?.kind === 'game' ? 'game' : 'tournament';` — drop `baseKind`/`isOfficial`/`official`.

After removal, `SetupScreen` should be byte-for-byte behaviourally what it was before the official work — a pure `game`/`tournament` wizard. Use `git log`/`git show` on the official-related commits (`feat: official-tournament creation in the setup wizard`, `fix: official wizard partial-failure recovery...`, `feat: official-tournament toggle on the wizard's first step`) to see exactly what to undo. Do NOT remove anything that predates the official work.

`setupWizard.js` is NOT changed — its `'official'` support stays for `OfficialCreateScreen`.

- [ ] **Step 1: Remove the official code** as above.

- [ ] **Step 2: Verify**

`npx jest` — full suite passes (the `setupWizard.test.js` 'official kind' tests still pass because `setupWizard.js` is untouched). `npx jest --listTests` exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "refactor: remove official mode from SetupScreen — now its own screen"
```

---

## Task X3: Casual/Official choice after "New Tournament"

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Add the choice**

In `src/screens/HomeScreen.js`, the play menu has "New Tournament" item(s) that currently `navigation.navigate('Setup', { kind: 'tournament' })` (there are two such locations — around lines 717 and 965). Change tapping "New Tournament" so it first presents a small **Casual / Official** choice (a modal sheet or action menu consistent with the screen's existing modal/menu patterns — e.g. the `showListMenu` modal style):
- "Casual tournament" → `navigation.navigate('Setup', { kind: 'tournament' })`.
- "Official tournament" → `navigation.navigate('OfficialCreate')`.

Implement it with a single shared piece of state (e.g. `showTournamentKindChoice`) and one modal, so both "New Tournament" entry points open the same choice. Do NOT change the "New Game" items — they still go straight to `Setup { kind: 'game' }`.

Confirm the standalone "Official Tournament" overflow item is already gone (it was removed in a prior commit) — if any official entry point other than this choice remains, remove it.

- [ ] **Step 2: Verify**

`npx jest` — full suite passes. `npx jest --listTests` exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: New Tournament offers a Casual / Official choice"
```

---

## Self-review notes

- `setupWizard.js`, `WizardProgress`, `WizardNav`, the official data layer, the
  management screen, and all other official screens are unchanged.
- After X2, `SetupScreen` is pure casual; after X1+X3 official creation is a
  dedicated screen reached via the New Tournament choice.
- The legacy `Setup` route param `kind:'official'` is no longer produced by any
  caller; harmless if left, but X2 drops its handling.
