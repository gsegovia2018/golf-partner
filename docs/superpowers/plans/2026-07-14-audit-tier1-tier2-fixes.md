# Plan: Audit Tier 1 + Tier 2 Fixes

Derived from the 2026-07-14 six-domain codebase audit. Fixes the ship-blocker
(data-loss / security / silently-wrong-core) issues and the leaderboard/scoring
correctness issues.

## Product decisions (locked by user 2026-07-14)

- **Official live leaderboard → Net Stableford** (handicap-aware), matching the
  casual side. Also wire the currently-unused `format` param.
- **Out-of-range score input → clamp to `1..pickup`** (min 1, max the hole's
  pickup threshold `par + 2 + extra shots`). No user interruption.
- **Stroke-play leaderboard toggle → LEAVE AS-IS.** Do NOT change pickup-stroke
  handling there. (Audit item intentionally dropped.)
- **Odd roster in "Stableford with Partners" → auto-form one 3-player team** so
  nobody plays solo. No unwinnable singleton pairs.

## Global Constraints

- Stack: Expo SDK 54, React Native 0.81, React 19, `react-native-web` (web +
  Android from one codebase). Backend: Supabase (Postgres, Auth, Storage, Edge
  Functions). Local state in plain JS store modules under `src/store/`;
  AsyncStorage persistence; offline-first (writes queue + replay).
- Domain logic lives in `src/store/` and `src/lib/`, NOT in screens. Keep it
  that way — screens call store/lib functions.
- Every task follows TDD: write a failing test first, then implement. Tests use
  Jest (jest-expo). Put tests next to existing suites (`__tests__/`).
- Do NOT break existing tests (~1529 across 127 suites). Run the relevant suite
  after each task; if a pre-existing test now asserts wrong behavior BECAUSE of
  a fix, update the test and note why in the report.
- `npm run lint` (ESLint 9 flat config) is CI-blocking — no new lint errors.
- Stableford formula (do not change): `points = 2 + par - strokes + extra shots`;
  pickup threshold `strokes >= par + 2 + extra → 0 pts`. Scoring math in
  `src/store/scoring.js`.
- `currentRound` is a KNOWN-UNRELIABLE cross-device pointer (can lag at 0 while
  later rounds are fully scored). Never use it as source of truth for
  played/remaining state — derive from actual score data (mirror `isRoundPlayed`
  in `scoring.js:406`).
- Scramble team ball is stored only under the captain (`pair[0]`); scramble
  modes are excluded from personal stats.
- These tasks are ordered so that files touched by multiple tasks
  (`scoring.js`, `tournamentStore.js`) are edited sequentially. Do NOT reorder.

## Context: where these fit

The app tracks Stableford golf scores for weekend multi-round tournaments among
friends, offline-first with Supabase sync. Tier 1 = correctness/data-loss/
security in the sync + media + course + auth foundation. Tier 2 = the
leaderboard and scoring output that is the app's core purpose.

---

## Task 1: Serialize the sync queue + isolate per-tournament drain

**Files:** `src/store/syncQueue.js`, `src/store/syncWorker.js`

**Problem A (syncQueue.js:25-62):** `enqueue`, `drop`, `dropMany`,
`incrementAttempts` each do `readAll()` → mutate array → `writeAll()` with awaits
and no mutual exclusion. Two overlapping mutations both read the same array, both
push, and the second `writeAll` clobbers the first — the earlier write is
silently dropped from the queue and never syncs. A concurrent `drop` (during a
drain) and `enqueue` can resurrect a synced entry or lose a fresh one.

**Fix A:** Serialize ALL queue read-modify-write operations through a single
promise-chain mutex (each op awaits the previous). Every public mutator
(`enqueue`, `drop`, `dropMany`, `incrementAttempts`, and any other RMW) must run
inside the chain. Pure reads (`all`, `readAll`) may stay lock-free but must not
interleave a partial write.

**Problem B (syncWorker.js:264-266):** In `drainOnce`, the per-tournament loop
`for (const [tid, entries] of byTournament) await drainTournament(...)` is NOT
wrapped in try/catch (the library drain above it IS, lines 251-256). One
tournament whose mutation throws aborts the whole loop, starving every other
tournament for up to `RECOVERABLE_ATTEMPT_CAP` (8) cycles.

**Fix B:** Wrap each `drainTournament` call in its own try/catch (mirror the
library-drain pattern). Record the failure so backoff still triggers, but let
sibling tournaments drain independently.

**Tests:** Add a suite that (1) fires two concurrent `enqueue` calls and asserts
BOTH entries persist; (2) asserts a `drainTournament` that throws for tournament
A still lets tournament B drain. Mock AsyncStorage/repo as the existing suites do.

**Verify:** `npm test -- syncQueue syncWorker` and any existing sync tests pass.

---

## Task 2: Serialize realtime local-blob writes + recover the channel

**File:** `src/store/realtimeSync.js`

**Problem A (realtimeSync.js:337-361, makeHandler):** Each handler does
`readLocal(id)` (clones cache) → `applyFn` on the clone → `await
pendingEntriesFor(id)` (real async gap) → `saveLocal(wholeBlob)`. Two row events
arriving close together each clone the SAME base cache, apply only their own
patch, and the second `saveLocal` overwrites the whole blob — losing the first
handler's patch. Same hazard vs a concurrent `_overlayAndSave`/`drainTournament`
reconcile.

**Fix A:** Serialize the read-modify-write per tournament (a per-tournament
promise-chain mutex), OR re-read the current cache immediately before
`saveLocal` and merge the patch onto the FRESH cache rather than the entry-time
clone. Whichever is chosen, two near-simultaneous row patches must both survive.

**Problem B (realtimeSync.js:401-403):** `channel.subscribe((status) => {...})`
handles only `SUBSCRIBED`. `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED` are ignored —
after a network blip the channel silently stops delivering `game_*` events with
no resubscribe (degrades to the 20s poll, no user signal).

**Fix B:** Handle `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` with a backoff rejoin.

**Problem C (realtimeSync.js:301-305, 402):** `_lastAuthor`/`_lastHole` are
module-global; on switching channel to a new tournament the `SUBSCRIBED`
callback tracks the PREVIOUS tournament's `_lastHole`, mis-gating conflict
surfacing.

**Fix C:** Reset `_lastHole`/`_lastAuthor` on channel-id change in
`ensureRealtimeForTournament` (or key presence state by tournament id).

**Tests:** Assert two concurrent handler invocations with different row patches
both persist to the local blob. Assert presence state resets on tournament
switch. Mock the supabase channel.

**Verify:** `npm test -- realtimeSync` passes.

---

## Task 3: Media upload reliability (stuck / false-fail / thumbnail-blocks)

**Files:** `src/lib/uploadWorker.js`, `src/lib/mediaUpload.js`,
`src/store/mediaStore.js`

**Problem A (uploadWorker.js:11-13,46-48):** `drain` early-returns when
`_running`; it iterates a `listQueue()` snapshot taken at loop start, so media
attached DURING a drain is never picked up and nothing re-kicks when the drain
finishes → the new upload sits `pending` forever on stable Wi-Fi.
**Fix A:** In `drain`'s `finally`, if the queue still has processable entries,
re-invoke `drain` (or set a dirty flag a running drain re-checks before exiting).

**Problem B (mediaUpload.js:123-131 + mediaStore.js:82-95):** If the app dies
after `insertMediaRow` succeeds but before `removeQueueEntry`, the re-run hits a
unique-violation (`23505`) which is thrown → the entry accrues attempts and
flips to `failed` even though the media fully uploaded.
**Fix B:** Treat `23505` from `insertMediaRow` as success (upsert/ignore-on-
conflict), so a re-run resolves cleanly and the queue entry is removed.

**Problem C (mediaUpload.js:121,74-95):** `makeThumbnail` is awaited before the
original uploads; any throw (unsupported codec, web `canvas.toBlob` null, etc.)
fails the whole `processUpload` → the photo/video that could have uploaded never
does, and after 5 attempts is lost.
**Fix C:** Wrap thumbnail generation in try/catch; on failure upload the
original with a null/placeholder thumb rather than failing the item.

**Problem D (uploadWorker.js:6,32,56-62):** Retries fire on every NetInfo change
and AppState `active` with no per-entry backoff gate — retry storms.
**Fix D:** Store `nextAttemptAt` per entry; in `drain` skip entries whose
backoff hasn't elapsed; drive retries off that timestamp.

**Tests:** (1) attach-during-drain gets uploaded; (2) `23505` on insert →
entry removed, not failed; (3) thumbnail throw → original still uploads;
(4) an entry with a future `nextAttemptAt` is skipped this pass.

**Verify:** `npm test -- upload media` passes.

---

## Task 4: Authenticate the send-push edge function

**File:** `supabase/functions/send-push/index.ts`

**Problem (index.ts:68-101):** The handler trusts `payload.record` (user_id,
type, data) with NO shared-secret/signature verification and uses the service-
role key to look up tokens and send. Anyone who can POST the URL delivers
arbitrary title/body pushes to any user's devices.

**Fix:** Require a shared secret before processing. Read an expected secret from
an env var (e.g. `PUSH_WEBHOOK_SECRET`); reject (401) any request whose
`Authorization`/`x-webhook-secret` header (match Supabase DB-webhook conventions)
doesn't equal it. Use a constant-time comparison. If the env var is unset, fail
closed (reject) rather than open. Keep the existing behavior for authenticated
requests unchanged.

**Also (index.ts:102-114):** the DeviceNotRegistered pruning only checks the
synchronous ticket, not receipts, and drops other error statuses; there's no
100-message chunking. If time permits within THIS task, add ≤100-message
chunking (low-risk). The receipts step is out of scope for this task (note it in
the report as a follow-up).

**Tests:** If the function has test infrastructure, assert a request without the
secret is rejected 401 and one with it proceeds. If no Deno test harness exists,
document the manual verification steps in the report and keep the logic in a
pure, unit-testable helper (`isAuthorized(headers, secret)`).

**Report:** Note that deployment requires setting `PUSH_WEBHOOK_SECRET` in the
Supabase function config AND adding the header to the DB webhook — this is a
manual ops step the user must do; call it out explicitly.

---

## Task 5: Enforce stroke-index + duplicate-tee validation on save

**Files:** `src/screens/CourseEditorScreen.js`,
`src/screens/CourseLibraryDetailScreen.js`, `src/components/TeesEditor.js` (read
only — reuse its existing `siIssues`/`dupes` computation pattern)

**Problem A (CourseEditorScreen.js:76-96,197-211):** `siIssues` is computed but
the "Done" handler calls `updateCourseFromEditor(...)` unconditionally —
`siIssues.length` is never checked. Duplicate/missing/zero stroke indexes save
silently and corrupt every Stableford/net computation on that course.
**Fix A:** Block save when `siIssues.length > 0` — disable the Done button and/or
show an alert listing the SI problems. Do not persist.

**Problem B (CourseLibraryDetailScreen.js:50-63):** `handleSave` validates only
`name.trim()` — NO stroke-index validation at all.
**Fix B:** Add the same `siIssues` check here and block save on failure.

**Problem C (TeesEditor.js:24-29,126-130 + CourseEditor/CourseLibraryDetail):**
Duplicate tee labels are warned but not blocked; tees are matched by label
(`tees.js:17-22`, `libraryStore.js:196-214`) so duplicates resolve to an
arbitrary row → nondeterministic rating/slope/course-handicap.
**Fix C:** Disable save while `dupes.length > 0` on both course-editing screens.

**Tests:** Unit-test the save-guard predicate (extract a pure
`canSaveCourse(holes, tees)` helper returning `{ok, siIssues, dupes}` if one
doesn't already exist) — assert it blocks on duplicate SI, missing SI, SI 0, and
duplicate tee labels, and passes a clean course.

**Verify:** `npm test -- course` and lint pass.

---

## Task 6: Hydrate the device author id before any score is authored

**Files:** `src/store/deviceId.js`, plus call sites that stamp author ids
(`src/screens/ScorecardScreen.js:550` `meId ?? getDeviceAuthorId()`, and any
other `getDeviceAuthorId` callers)

**Problem (deviceId.js:7-14):** `getDeviceAuthorId()` returns a freshly-generated
RANDOM id synchronously, then asynchronously overwrites `_cached` with the
persisted id. Scores authored before hydration are stamped with the throwaway id;
later scores use the persisted id. When `meId` is null (unclaimed device), the
same physical device produces two distinct author ids for the same player/hole →
`deriveCell` (`scoreEntries.js:19-51`) sees two authors and surfaces a spurious,
unresolvable "two phones recorded different scores" conflict.

**Fix:** Hydrate the persisted id BEFORE any score can be authored. Options:
(a) an async `initDeviceAuthorId()` awaited at app startup that populates
`_cached` from AsyncStorage (generating+persisting once if absent), with
`getDeviceAuthorId()` returning the stable cached value thereafter; and/or
(b) block/guard score authoring until `_cached` is confirmed. Never return a
provisional id that a later write won't match. Ensure the generated id is
persisted the first time so it is stable across sessions.

**Tests:** Assert that two `getDeviceAuthorId()` calls (before and after
hydration) return the SAME id once initialized; assert the id persists across a
simulated reload (same AsyncStorage). Mock AsyncStorage as existing suites do.

**Verify:** `npm test -- deviceId scoreEntries` passes.

---

## Task 7: Official leaderboard → Net Stableford (+ discrepancy handling)

**File:** `src/store/officialLeaderboard.js` (and its callers /
`officialScoring.js` if par/handicap must be threaded in)

**Problem A (officialLeaderboard.js:29-51):** `buildLeaderboard` ranks purely by
`a.gross - b.gross` — a player thru 3 holes (gross 12) outranks one thru 18
(gross 72). No par reference; the `format` param (line 26-29) is accepted but
UNUSED.
**Problem B (officialLeaderboard.js:14-22):** discrepancy/empty holes are
dropped from `gross` and `thru`, so an unresolved dispute lowers a player's gross
and (under gross-ascending sort) inflates their rank.

**Fix (per user decision — Net Stableford):** Rank by Stableford points computed
net of handicap, using each hole's par and stroke index (thread par/SI +
member handicap into the module; members already carry `handicap`). Reuse the
canonical Stableford + extra-shots math from `scoring.js`
(`calcStablefordPoints`/`calcExtraShots`) — do NOT reimplement it. Higher points
= better. Tiebreak by fewer strokes over resolved holes (mirror
`stablefordComparator`). Wire the `format` param so it actually selects the
ranking; keep gross available as a column/field if the UI shows it.

Treat discrepancy/empty holes as "not yet scored" for ranking (they contribute
0 points and are excluded from the strokes tiebreak), and expose a discrepancy
flag on the row so the UI can mark disputed players.

**Tests:** Assert a full-18 player outranks a fewer-holes player with lower gross;
assert net Stableford ordering with handicaps; assert a discrepancy hole doesn't
improve rank; assert the tiebreak.

**Verify:** `npm test -- official` passes.

---

## Task 8: Derive clinch / "wins" from scored state, not currentRound

**Files:** `src/store/scoring.js` (`tournamentSindicatoClinched` ~457-458;
`tournamentMatchPlayStandings` ~894-896), `src/store/tournamentStore.js`
(`tournamentPlayerClinched` ~1377)

**Problem:** All three compute `future = idx > (tournament.currentRound ?? 0)` to
decide whether to add a round's holes to `holesRemaining`. `currentRound` is the
known-unreliable pointer; when stale (0 while later rounds are fully scored),
already-scored rounds count as "future," inflating `holesRemaining` and
suppressing a legitimate "X wins"/clinch badge (`HomeScreen.js:1653`). A
mathematically-decided tournament never shows as won.

**Fix:** Replace the `currentRound`-based future/remaining determination with one
derived from actual scored state — mirror `isRoundPlayed` (`scoring.js:406`): a
round contributes to `holesRemaining` only if it is NOT yet played/scored.
Apply consistently to all three call sites.

**Tests:** Build a tournament fixture with `currentRound: 0` but all rounds fully
scored and a decided leader; assert clinch/wins is detected. Guard against
regressions in the existing scramble/pairsMatchplay tournament tests (those were
already adjusted on 2026-07-14 to expect scored-round aggregation).

**Verify:** `npm test -- scoring tournament clinch matchPlay sindicato` passes.

---

## Task 9: Clamp score input to 1..pickup

**Files:** `src/screens/ScorecardScreen.js` (text-entry path ~1073), and the
setter in `src/store/` (`setScore` / `mutate.js`) — put the clamp in the store so
it protects ALL entry paths, not just the text field.

**Problem (ScorecardScreen.js:1073):** the text path does
`parseInt(value, 10) || undefined` with no bound — "44" (meant 4) stores
verbatim; "-1" stores negative strokes. Stableford floors at 0 and hides it, but
every gross/stroke consumer (stroke-play alt board `HomeScreen.js:973`,
`chaosHoles`, `blowup`, `avgStrokes`, `warmupVsClosing`) is silently corrupted.
`stepScore` already clamps to `Math.max(1, …)`; the text path does not.

**Fix (per user decision — clamp to 1..pickup):** Clamp any entered strokes to
`[1, pickupStrokes(par, extra)]` where the pickup threshold is
`par + 2 + extra shots` (the existing pickup constant in `scoring.js:281-284`).
Implement the clamp in the store setter so keypad, stepper, and any sync-replay
path share it. Non-positive → clamp to 1 (or clear, matching existing
"undefined" semantics for an empty field — preserve the ability to CLEAR a score;
only clamp actual numeric entries).

**Tests:** Assert entering 44 on a par-4 (0 extra) clamps to the pickup max;
assert -1 → 1; assert clearing still yields empty; assert a normal 4 is unchanged.

**Verify:** `npm test -- scoring scorecard setScore` passes.

---

## Task 10: Tie-aware leaderboard placement ("T1")

**File:** `src/screens/HomeScreen.js` (rank render ~1639-1666)

**Problem:** `rank = array index i`; two players equal on points AND strokes get
distinct ranks 1 and 2 and distinct medal colors (gold vs silver, ~1640-1642),
implying an order that doesn't exist. `stablefordComparator` (`scoring.js:768-773`)
correctly returns 0 on a full tie — the UI just ignores it.

**Fix:** Compute tie-aware placement: players who compare equal (comparator === 0)
to the player above them share that player's rank number, displayed as "T{n}",
and share the medal color. Standard competition ranking (1,2,2,4). Keep it a
pure helper so it's testable and reusable by other boards that have the same
pattern.

**Tests:** Assert [A,B tie, C] → ranks T1, T1, 3 with A and B sharing medal
color; assert no-tie case is unchanged (1,2,3).

**Verify:** `npm test -- leaderboard HomeScreen` and lint pass.

---

## Task 11: Consistent tiebreak for best-ball/scramble boards + fix scramble strokes double-count

**Files:** `src/store/tournamentStore.js` (best-ball board ~1291),
`src/store/scoring.js` (scramble board ~740; mixed-mode Stableford aggregation
~789-796)

**Problem A (tournamentStore.js:1291, scoring.js:740):** best-ball and scramble
tournament boards `sort((a,b) => b.points - a.points)` with NO stroke tiebreak,
while individual/Stableford boards use `stablefordComparator` (fewer strokes
breaks ties). Inconsistent, arbitrary tie order.
**Fix A:** Apply the shared `stablefordComparator` (or an explicit documented
tiebreak) to these boards too.

**Problem B (scoring.js:789-796):** in `tournamentStablefordLeaderboard`'s
mixed-mode aggregation, BOTH scramble teammates get `cur.strokes += row.strokes`
— each member is credited the WHOLE team ball's strokes, so scramble-heavy
tournaments double/quadruple-count strokes, corrupting the strokes tiebreak and
the "N str" column (`HomeScreen.js:1661-1663`).
**Fix B:** Do not attribute the full team strokes to each individual for the
Stableford board's strokes field — leave 0 (or exclude scramble rounds from the
strokes tiebreak). Points attribution stays per-player as-is.

**Tests:** Assert best-ball/scramble boards break a points tie by fewer strokes;
assert a scramble round does NOT credit each teammate the full team strokes in
the overall board.

**Verify:** `npm test -- scoring tournament scramble bestBall leaderboard` passes.

---

## Task 12: Auto-form a 3-player team for odd rosters in partners mode

**Files:** `src/components/scoringModes.js` (~39, `stablefordpairs` allow rule),
`src/store/scoring.js` (`randomPairs` ~308-316), `src/store/tournamentStore.js`
(`roundPairLeaderboard` ~1082-1095)

**Problem:** "Stableford with Partners" allows `count >= 3` with no parity check;
`randomPairs` emits a singleton for the leftover; `roundPairLeaderboard` ranks
that one player's points directly against two-player combined totals —
structurally unwinnable.

**Fix (per user decision — auto-form a 3-player team):** For an odd roster in
partners mode, form teams so the leftover player joins an existing pair to make
ONE 3-player team (the rest stay as 2-player teams). Update `randomPairs` (or the
partners-mode team builder) to produce this shape, and update
`roundPairLeaderboard` to score a 3-player team correctly (sum/agreed rule
consistent with how 2-player pairs are summed — combined Stableford points of the
team's members). Ensure the reuse path (`pairsForNextRound`) and `teamShapeOf`
tolerate a 3-player team in this mode.

**Tests:** Assert a 5-player partners round yields teams [2,3] (no singleton);
assert the 3-player team's board total is its members' combined points; assert an
even roster still yields all 2-player pairs.

**Verify:** `npm test -- scoring scoringModes tournament pairs` passes.

---

## Task 13: Validate stroke-index on the round-holes persist paths (setup/edit)

Added during execution — surfaced by the Task 5 review. Task 5 gated the two
course-editing screens, but the SAME stroke-index corruption can still be
persisted when editing a ROUND's holes during tournament setup/edit, through a
different write path that has no validation.

**Files:** `src/screens/EditTournamentScreen.js` (debounced autosave effect
~172-261 that issues `round.upsert` writing `holes`/`tees`),
`src/screens/SetupScreen.js` (`createTournament` ~444, and the round-holes
callback path — CourseEditorScreen is opened WITHOUT a `courseId` from
`SetupScreen.js:664` and `EditTournamentScreen.js:460`, so the shared
`updateCourseFromEditor` guard added in Task 5 does NOT apply). Reuse the
`canSaveCourse`/`computeSiIssues` helper created in Task 5 (`src/lib/courseLibrary.js`).

**Problem:** `ROUND_UPSERT_OWNED_FIELDS` includes `holes`/`tees`
(`mutationWrites.js`), so a round whose holes carry duplicate/missing/zero stroke
indexes is written straight to Supabase with zero validation — the exact
handicap/Stableford corruption Task 5 exists to prevent, via the most common
SI-entry path (editing a round during setup).

**Fix:** Prevent invalid stroke-index holes from being persisted to a round.
Because the EditTournament autosave is debounced-on-keystroke, do NOT alert-spam;
instead:
- Guard the round-holes commit so a round whose `computeSiIssues(holes).length > 0`
  (or duplicate tee labels) is NOT written to Supabase while invalid — hold the
  bad `holes`/`tees` out of the `round.upsert` payload (persist the round's other
  fields), and surface the existing inline SI warning (CourseEditor already
  renders `siIssues`) so the user sees why. When SI becomes valid, the normal
  autosave persists it.
- For `SetupScreen.createTournament`, block creation (or the round-holes step)
  when any round's SI is invalid, mirroring Task 5's alert pattern (this is a
  discrete user action, not a keystroke autosave, so an alert is appropriate).
- Keep the guard in shared/pure logic; do not duplicate the SI rules.

**Tests:** Unit-test the persist-guard predicate (a round with invalid SI is
excluded from the upsert payload / blocks create; a valid round persists). If the
autosave gating is best expressed as a pure helper (e.g.
`roundHolesArePersistable(round)`), extract and test it. Do not break existing
EditTournament/Setup tests.

**Verify:** `npm test -- course EditTournament Setup` (and affected suites) plus
`npm run lint` pass.

---

## Out of scope (deferred — later tiers)

Tier 3 (validation/resilience: duplicate-tournament-on-Back, fixed-teams shape
mismatch, roster-cap-4 for tournaments, password reset, handicap comma parsing,
error/retry states, NextRound error handling, removed-player scoreEntries,
friend/roster races), Tier 4 (StatsScreen memoization, feed pagination, web
media leaks), Tier 5 (stat small-sample/partial-round math, dead code). These are
tracked in the audit and are NOT part of this plan.
