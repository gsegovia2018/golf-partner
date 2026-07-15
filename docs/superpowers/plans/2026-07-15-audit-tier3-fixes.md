# Plan: Audit Tier 3 Fixes (validation / resilience)

Follows the Tier 1+2 work (merged @ e6b15f2). Fixes the Tier 3
validation/resilience findings from the 2026-07-14 six-domain audit.

## Product decisions (locked by user 2026-07-15)

- **Roster cap:** NO fixed cap for `kind === 'tournament'` (guard at a sane
  upper bound, e.g. 24). Casual games (`kind === 'game'`) stay capped at 4.
  Team-mode ROUNDS (bestball 2x2, scramble3v1, scramble4, pairsmatchplay) still
  require their exact player counts — the per-mode `isAllowed(count)` gate MUST
  keep enforcing that, and the UI must communicate when a chosen mode needs
  exactly 4. Individual Stableford and Stableford-with-Partners already scale to
  any count (partners handles odd rosters via the Tier 2 3-player-team work).
- **Password reset:** FULL fix — recovery deep link + a set-new-password screen
  driven by the `PASSWORD_RECOVERY` auth event, working on BOTH web and Android.
- **Migrations:** Allowed. New `supabase/migrations/*` may be added and applied
  (Management API token is in `.env`). Flag each schema change in the task
  report. Migrations must be idempotent and safe to re-run.

## Global Constraints

- Stack: Expo SDK 54, RN 0.81, React 19, react-native-web (web + Android from
  one codebase). Supabase (Postgres, Auth, Storage, Edge Functions). Local
  state in plain JS store modules under `src/store/`; AsyncStorage; offline-first
  (writes queue + replay via syncQueue/syncWorker/mutate/mutationWrites).
- Domain logic lives in `src/store/` and `src/lib/`, NOT screens. Keep it there.
- TDD every task: failing test first, then implement. Jest (jest-expo); tests in
  `__tests__/` next to existing suites. Baseline: 1666 tests / 135 suites green.
- `npm run lint` (ESLint 9 flat) is CI-blocking — 0 new errors.
- Auth: Google OAuth via expo-auth-session; session in `src/context/AuthContext.js`;
  there is ALSO an email/password path in `AuthScreen.js` (sign in / sign up /
  forgot password). Web redirect via `src/lib/oauth.js getWebRedirectTo()`
  (returns undefined off-web). Deep links configured in the navigation `linking`
  config (find it — likely `App.js`).
- Tournament kinds: `kind` is a user toggle; only `'game'` and `'tournament'`
  are valid (never `'casual'`). Scoring-mode gates live in
  `src/components/scoringModes.js` (`isAllowed`, `scoringModeUsesTeams`).
- Player-count / team-shape helpers: `randomPartnerTeams`, `buildTeamsForMode`,
  `teamShapeOf`, `pairsForNextRound` in `src/store/scoring.js` (extended in
  Tier 2 — read them). `MAX_PLAYERS` currently 4 in `SetupScreen.js` and
  `ClaimPlayerScreen.js`.
- Tasks that touch the same file are ordered to run sequentially. Do NOT reorder.
- Each migration task: write the migration, apply it via the Management API
  token, AND add/adjust the client code + tests. Report the applied migration.

## Context

Tier 1+2 fixed the data-loss/security/scoring-correctness core. Tier 3 closes
validation and resilience gaps: flows that silently drop data, dead-end on
error, or corrupt state under edge cases (odd/large rosters, mode mismatches,
concurrency, offline failures).

---

## Task 1: Stop duplicate tournament creation on Back (Official create)

**File:** `src/screens/OfficialCreateScreen.js` (~163-177, `handleCreate`).

**Problem:** On success `handleCreate` does `navigation.navigate('OfficialSetup', ...)`
(a push). The Review step stays in the stack, so Back → re-tap "Create
Tournament" inserts a SECOND tournament (new `uuidv4`), roster, and rounds. The
partial-failure branch (~177) has the same shape. `busy` only guards in-flight
double-taps, not re-entry.

**Fix:** Use `navigation.replace('OfficialSetup', ...)` (or reset the stack) so
the Review step is not returned to, AND track a `createdTournamentId` so a
re-invocation short-circuits instead of re-creating. Apply to both the success
and partial-failure branches.

**Tests:** Assert `handleCreate` invoked twice creates only ONE tournament
(second call short-circuits / no second insert). Mock the store/nav as existing
screen tests do.

**Verify:** `npm test -- Official` and lint pass.

---

## Task 2: Fixed-teams save must not overwrite mismatched later rounds

**File:** `src/screens/EditTeamsScreen.js` (~123-133, `onSave`).

**Problem:** With `fixedTeams` on, `onSave` loops `rounds.slice(roundIdx+1)` and
writes the just-edited pairs into EVERY later round unconditionally. Later rounds
can have per-round `scoringMode` overrides with different team shapes (e.g. edit
a `bestball` 2x2 round, round+1 is `scramble3v1` expecting `[3,1]`). The reuse
path `pairsForNextRound` guards on `teamShapeOf` mismatch; this save path does
not.

**Fix:** In the propagation loop, for each later round compute
`teamShapeOf(roundScoringMode(round, tournament))`; only overwrite pairs when the
shape MATCHES the edited round's shape. For a mismatched round, either leave its
existing pairs OR rebuild via `buildTeamsForMode` for that round's mode — pick
the option consistent with `pairsForNextRound` and document it. Reuse the
existing shape helpers; do not invent a new shape check.

**Tests:** Assert editing a round's fixed teams does NOT clobber a later round
whose mode has a different shape; assert same-shape later rounds still receive
the fixed teams.

**Verify:** `npm test -- editTeams teams scoring` and lint pass.

---

## Task 3: Lift roster cap for tournaments (keep team-mode count gates)

**Files:** `src/screens/SetupScreen.js` (`MAX_PLAYERS`/slot rendering ~146,182,530),
`src/screens/ClaimPlayerScreen.js` (`MAX_PLAYERS` ~19), and any other `>= 4`
roster guard in the setup/join flow (grep for `MAX_PLAYERS` and `>= 4`).

**Problem:** Roster is hard-capped at 4 for ALL kinds, so no real multi-flight
tournament can be built in the wizard.

**Fix (per decision — no fixed cap for tournaments):**
- Make the roster cap kind-aware: `kind === 'game'` → 4 (unchanged);
  `kind === 'tournament'` → a high guard (e.g. 24) rather than 4. Extract the
  cap into a small helper (e.g. `rosterCap(kind)`) so all call sites agree.
- The players step must render/allow more than 4 slots for a tournament (don't
  hardcode `4 - players.length` empty slots — derive from the cap).
- CRITICAL: keep per-round team-mode validation intact. A round whose
  `scoringMode` is a team mode (bestball/scramble3v1/scramble4/pairsmatchplay)
  still needs exactly 4 players via `scoringModes.js isAllowed(count)`. When the
  roster exceeds what a chosen mode allows, surface the existing fallback/notice
  (individual or partners-stableford scale to any count). Do NOT weaken
  `isAllowed`.
- Trace downstream: partner selection (`randomPairs`/`randomPartnerTeams` already
  handle >4 for stableford/partners), scorecard rendering, and the leaderboard
  must all handle a >4 roster. Verify individual + partners-stableford render
  correctly with, say, 6 and 8 players.

**Tests:** Assert `rosterCap('game') === 4` and `rosterCap('tournament')` is the
higher bound; assert the players step admits a 5th+ player for a tournament but
not a game; assert a team-mode round with !=4 players is still gated/flagged.

**Verify:** `npm test -- Setup ClaimPlayer scoringModes scoring` and lint pass.
Note in the report which downstream consumers you verified handle >4 players.

---

## Task 4: Full password-reset flow (web + Android)

**Files:** `src/screens/AuthScreen.js` (~131-147 `handleForgotPassword`), a NEW
set-new-password screen, the navigation `linking`/deep-link config (find it),
`src/lib/oauth.js` (redirect helper), `src/context/AuthContext.js` (handle the
`PASSWORD_RECOVERY` auth event).

**Problem:** `handleForgotPassword` calls `resetPasswordForEmail` with
`redirectTo = getWebRedirectTo()` which is `undefined` off-web, so Android reset
links can't return to the app. There is NO `PASSWORD_RECOVERY` handler and NO
`updateUser({ password })` UI anywhere — even on web, after the recovery link
exchanges a session the user can never actually set a new password.

**Fix (per decision — full fix, web + Android):**
- Provide a working `redirectTo` for BOTH platforms: web URL for web; an
  app deep link (scheme/universal link) for Android — wire it into the
  navigation `linking` config so the recovery URL opens the app.
- Add a set-new-password screen: on the `PASSWORD_RECOVERY` auth event (Supabase
  emits it after the recovery link exchanges a session), route the user there and
  call `supabase.auth.updateUser({ password })`. Validate the new password
  (non-empty, min length, confirm match) with inline errors; on success sign the
  user in / route home.
- Keep the existing sign-in/sign-up email-password behavior unchanged.

**Tests:** Unit-test the password-validation helper (empty, too short, mismatch,
valid) and the redirect-selection logic (web vs native returns the right target).
Screen-render test for the set-password screen if feasible. Do not require a live
Supabase session in tests.

**Verify:** `npm test -- Auth password oauth` and lint pass. In the report,
document the deep-link/redirect URLs and any Supabase Auth config (allowed
redirect URLs) the user must set — this is an ops step.

---

## Task 5: Handicap input — accept comma decimals, no silent 0

**Files:** `src/lib/handicap.js` (`parseHandicapIndex` ~8,
`normalizeHandicapInput` ~18-20), `src/store/libraryStore.js` (`upsertPlayer`
~70-77), `src/screens/PlayerPickerScreen.js` (~103-104),
`src/screens/PlayersLibraryScreen.js` (~75-76), `src/screens/PlayersScreen.js`
(~130-138,252-255).

**Problem:** `parseHandicapIndex` accepts only `^\d+(\.\d)?$` (period, one
decimal). On comma-locale devices `decimal-pad` yields "12,5" → parse fails →
handicap silently saved as **0** (`parsed.ok ? parsed.value : 0`). Only
ProfileScreen normalizes commas. A 0 handicap badly skews net scoring.

**Fix:** Normalize comma→period at every handicap entry point (reuse/centralize
`normalizeHandicapInput`), and on a genuinely invalid entry surface an inline
validation error instead of coercing to 0 (do NOT save 0 for unparseable input —
either block save or keep the prior value). Support values with a comma or period
and reasonable range (0..54). Centralize the parse/normalize so the 4+ call sites
share one implementation.

**Tests:** Assert "12,5" → 12.5 (not 0); "12.5" → 12.5; ">54"/garbage → error,
not a silent 0; empty handled. Assert each call site surfaces the error rather
than persisting 0.

**Verify:** `npm test -- handicap players libraryStore` and lint pass.

---

## Task 6: Error/retry states on list screens + PlayersScreen timer cleanup

**Files:** `src/screens/CourseLibraryDetailScreen.js` (load IIFE ~31-44),
`src/screens/CoursesLibraryScreen.js` (`load` ~48-61),
`src/screens/PlayersLibraryScreen.js` (`load` ~38-46), `src/screens/PlayersScreen.js`
(autosave timer ~245-311).

**Problem:** These loaders have no `catch` — a failed fetch leaves an infinite
spinner (`CourseLibraryDetail`) or a misleading empty "success" state
(`CoursesLibrary`/`PlayersLibrary`), plus an unhandled rejection, and no retry.
`PlayersScreen`'s debounced autosave `setTimeout` is never cleared on unmount →
`setState`/alert after unmount.

**Fix:** Wrap each loader in try/catch/finally; add a `loadError` state + a retry
affordance (mirror the pattern already in `CoursePickerScreen`/`PlayerPickerScreen`);
keep any offline-cache fallback. In `PlayersScreen`, add an effect cleanup that
`clearTimeout`s the autosave timer and guard `setState` with a mounted ref.

**Tests:** Where the screens have testable data hooks, assert the error state is
set on a rejected fetch and cleared on retry. For the timer, assert cleanup
clears it (extract the debounce into a testable hook/helper if needed).

**Verify:** `npm test -- Course Players Library` and lint pass.

---

## Task 7: NextRound confirm/reshuffle error handling

**File:** `src/screens/NextRoundScreen.js` (~259-282, `handleConfirm`/`reshuffle`).

**Problem:** `handleConfirm` awaits `round.reveal` then `tournament.advanceRound`;
`reshuffle` awaits `round.reveal` — with no try/catch. A rejected mutation →
unhandled rejection, `navigation.replace('Home')` never runs, button appears
dead with no feedback.

**Fix:** Wrap both in try/catch; on failure surface an alert / retry (mirror
`SetupScreen.handleStart`). Keep the success path unchanged.

**Tests:** Assert a rejected `reveal`/`advanceRound` shows an error and does NOT
navigate; success still navigates. Mock the mutations.

**Verify:** `npm test -- NextRound` and lint pass.

---

## Task 8: Delete removed player's scoreEntries (kill phantom conflicts)

**Files:** `src/store/mutate.js` (`tournament.removePlayer` apply branch ~277-305),
and the server-side row cleanup (`game_score_entries`) via
`mutationWrites.js`/`tournamentRepo.js` (trace how removePlayer drains).

**Problem:** `removePlayer` deletes `scores`, `shotDetails`, `playerHandicaps`,
`scoreResolutions` for the player but NOT `scoreEntries`. Because
`preserveLocalConflictState`/`unionScoreEntries` re-merge local `scoreEntries` on
every reconcile/realtime patch, the removed player's per-author entries persist
forever, and `listRoundConflicts`/`surfaceableConflicts` derive a phantom,
unresolvable conflict (subjectName renders '—').

**Fix:** Delete `round.scoreEntries[playerId]` in the `removePlayer` apply branch,
and drop the corresponding `game_score_entries` rows server-side (add to the
removePlayer write path). Ensure the union-merge does not resurrect them.

**Tests:** Assert `removePlayer` clears `round.scoreEntries[playerId]` locally and
that a subsequent conflict-derivation yields no phantom conflict for the removed
player; assert the server write path drops the rows (mock repo).

**Verify:** `npm test -- mutate removePlayer scoreEntries conflict` and lint pass.

---

## Task 9: Fix friend/roster check-then-write races (migration + client)

**Files:** `src/store/friendStore.js` (`sendRequest` ~151-181),
`src/screens/ClaimPlayerScreen.js` (`addNewPlayer` ~96-134), NEW
`supabase/migrations/*` for unique constraints.

**Problem A (friendStore.sendRequest):** check-then-insert with no DB uniqueness
→ two simultaneous "Add" taps both insert → duplicate/mirror friendship rows;
`listFriends`/`listPendingRequests` show duplicates or a stuck "Requested".

**Problem B (ClaimPlayer.addNewPlayer):** gates only on locally-observed
`players.length >= cap` then `mutate(tournament.addPlayer)`; two joiners each see
room and both add → roster exceeds the cap. (`claimExisting` already uses an
atomic race-safe RPC; `addNewPlayer` does not.)

**Fix (per decision — migrations allowed):**
- Add a Supabase migration with a UNIQUE constraint on the unordered friendship
  pair (e.g. a canonical `least(user_a,user_b), greatest(user_a,user_b)` unique
  index) so duplicate inserts fail; make the client upsert/ignore-on-conflict and
  handle the conflict gracefully (treat as already-requested).
- For roster: enforce the cap server-side (extend the addPlayer RPC/mutation to
  reject beyond `rosterCap(kind)` atomically, OR re-fetch-and-recheck inside the
  write) so concurrent adds can't overflow. Reuse `rosterCap` from Task 3.
- Migrations must be idempotent (`if not exists`) and applied via the Management
  API token; report exactly what was applied.

**Tests:** Assert `sendRequest` treats a unique-violation as "already requested"
(no duplicate, no throw to the user); assert the roster add is rejected past the
cap even when the local count looks OK (mock the server rejection). Migration
correctness verified by applying + a follow-up query.

**Verify:** `npm test -- friend ClaimPlayer roster` and lint pass. Report the
applied migrations.

---

## Out of scope (later)

Tier 4 (perf: StatsScreen memoization, feed pagination, web media leaks) and
Tier 5 (stat small-sample/partial-round math, dead code) remain deferred, plus
the Tier 2 cross-cutting follow-ups (stroke-play alt scramble strokes,
computeSiIssues([]) guard, realtimeSync cross-module race, statsEngine
pair-chemistry for 3-player teams). Tracked in memory `audit-tier1-tier2-branch`.
