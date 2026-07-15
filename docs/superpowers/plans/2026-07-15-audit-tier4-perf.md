# Plan: Audit Tier 4 Fixes (performance)

Follows Tier 1+2 (merged @ e6b15f2) and Tier 3 (merged @ 14a8f23). Fixes the
Tier 4 performance findings from the 2026-07-14 six-domain audit. These are
mostly BEHAVIOR-PRESERVING optimizations — the output must not change, only the
cost. Where a change alters what's shown (feed pagination), it's called out.

## Defaults (chosen; not blocking questions)

- **Feed pagination:** infinite scroll via `onEndReached`, page size 30 (matches
  the existing cache `limit: 30`). "Load more" on demand, not all-at-once.
- **Media cap:** keep the existing 100 MB cap constant; just enforce it
  consistently (web + camera), don't change the number.

## Global Constraints

- Stack: Expo SDK 54, RN 0.81, React 19, react-native-web (web + Android from
  one codebase). Supabase. Domain logic in `src/store`/`src/lib`, not screens.
- TDD where the logic is testable (pure selectors, helpers, pagination math,
  URL-revocation). Pure-UI memoization that can't be unit-tested: verify by
  reading + a render/behaviour test if the harness supports it, and state so.
- Baseline: 1779 tests / 153 suites green (after Tier 3). `npm run lint` 0 new
  errors. Do NOT change any computed VALUE — outputs (stat numbers, feed items,
  leaderboards) must be identical; only recomputation frequency / transfer size
  changes. Add a test that locks the value where feasible.
- `StatsScreen.js` is a 4270-line monolith; `ShotsTab` already memoizes
  correctly — use it as the template. Do NOT refactor structure beyond what the
  perf fix needs.
- Concurrent session may share the checkout — only touch the files each task
  names.

## Context

Tiers 1-3 fixed correctness/resilience. Tier 4 removes the performance cliffs:
StatsScreen recomputing heavy aggregates on every render/sheet-open, Report Card
double-computing the season bundle, the feed loading unbounded history with
client-side counting, and web media leaks. None should change what the user
SEES — only how fast/cheap it is.

---

## Task 1: Memoize StatsScreen OverviewTab aggregates

**File:** `src/screens/StatsScreen.js` (OverviewTab ~445-456).

**Problem:** `tournamentHighlights`, `tournamentMomentum`, `clutchOnHardest`,
`playerConsistency`, `courseDNA`, `skinsLeaderboard`, `playingToHandicap`,
`hotStretch`, `strokeIndexAccuracy` are called directly in the render body — each
O(players×rounds×holes), and `tournamentHighlights` fans out further per player.
The tab holds local `sheet` state, so tapping any highlight card to open a detail
sheet re-runs ALL nine passes on the JS thread. Metric/round-scope changes do too.

**Fix:** Wrap each of the nine aggregates in `useMemo` keyed on the inputs that
actually affect it — `[tournament, metric, roundIndex]` (use the exact scope
vars the tab reads; do NOT include `sheet` state). `ShotsTab` (~2893) is the
correct template — match its memo pattern. The computed values must be identical;
only sheet-open/unrelated re-renders stop recomputing.

**Tests:** If a render/perf test is feasible, assert opening a sheet does not
re-invoke the aggregate functions (spy). At minimum add/keep a value test that
the aggregates produce the same output as before (import the underlying pure
functions and assert on a fixture). Do NOT break existing StatsScreen tests.

**Verify:** `npm test -- Stats` and lint pass. Report how you verified no value change.

---

## Task 2: Memoize PlayersTab / HolesTab / ShameTab aggregates

**File:** `src/screens/StatsScreen.js` (PlayersTab ~1261, HolesTab ~1733,
ShameTab ~3252).

**Problem:** Same pattern as Task 1 — these tabs run their aggregates
(`hallOfShame`, `par3Heartbreak`, `pickupChampion`, `anchor` (runs full
`pairHoleWins`), `zeroHero`, `nemesisEncore` in ShameTab; `bestWorstHoles`,
`playerNemesisAndCrushed`, `chaosHoles`, `collectiveExtremes` in HolesTab; and
PlayersTab's set) unmemoized on every render including each sheet open.

**Fix:** `useMemo` each aggregate keyed on `[tournament, metric, roundScope]`
(the actual scope vars each tab reads), so local sheet state doesn't invalidate
them. Match `ShotsTab`. Values must be identical.

**Tests:** As Task 1 — spy that sheet-open doesn't recompute if feasible; keep
value equivalence. Do NOT break existing tests.

**Verify:** `npm test -- Stats` and lint pass.

---

## Task 3: Report Card baseline-only compute path (no double season bundle)

**Files:** `src/store/roundReportCard.js` (~201-202), `src/store/statsEngine.js`
(`computeMyStats`).

**Problem:** `baseStats = computeMyStats(history)` runs the full ~30-aggregate
pipeline — including `buildCoachInsights`, `actionPlan`, `sgSeason`,
`computeFormSeries` — purely to read `distribution`/`shots`/`parType`/
`difficulty`/`warmupClosing` baselines. All the coach/form/action work is
discarded. `computeMyStats` for `thisStats` also builds coach insights for a
single round.

**Fix:** Add a lightweight options flag to `computeMyStats` (e.g.
`computeMyStats(rounds, { baselineOnly: true })` or a separate exported
`computeBaselineStats`) that SKIPS coach/action/form/SG-season when the caller
only needs the split aggregates. `roundReportCard` uses the baseline-only path
for `baseStats` (and for `thisStats` where coach isn't needed). The returned
baseline fields must be byte-identical to what the full path produced for those
fields.

**Tests:** Assert the baseline-only path returns the SAME
`distribution`/`shots`/`parType`/`difficulty`/`warmupClosing` values as the full
`computeMyStats` for a fixture (value equivalence), and that it does NOT invoke
`buildCoachInsights`/`actionPlan`/`sgSeason`/`computeFormSeries` (spy). Do NOT
change the report card's output.

**Verify:** `npm test -- reportCard computeMyStats statsEngine` and lint pass.

---

## Task 4: Feed remote pagination + debounced rebuild

**Files:** `src/screens/FeedScreen.js` (~277-305), `src/store/feedStore.js`
(`buildFeed` ~282-288,432; friend-tournament/activity fetching ~243).

**Problem:** The remote `buildFeed` call passes NO `limit`, so it flattens every
round of every tournament (self + all friends) into one list and the FlatList
renders all of it. No `onEndReached`/windowing. `buildFeed` also does N
per-friend-tournament RPCs + chunked activity RPCs on every build, re-run on
every focus AND on every tournament change (`subscribeTournamentChanges(() =>
load(false))`) with no debounce.

**Fix (per defaults — infinite scroll, page 30):**
- Pass a real `limit` (30) to the remote `buildFeed` and add incremental
  pagination: an `onEndReached` that fetches the next page (offset/cursor). Keep
  the newest-first ordering identical to today for the first page.
- Debounce/coalesce the `subscribeTournamentChanges` reload so rapid score edits
  don't trigger repeated full rebuilds (e.g. trailing debounce ~500-1000ms), OR
  apply a lightweight local patch instead of a full remote rebuild.
- Cache the friend-tournament list / activity results between focuses so a
  refocus doesn't re-run all N RPCs unless data changed.
- The feed CONTENT for a given scroll position must match today (same items,
  same order) — pagination only bounds how much loads at once.

**Tests:** Assert `buildFeed` is called with the page limit; assert `onEndReached`
requests the next page and appends (no duplicates, stable keys); assert the
tournament-change reload is debounced (rapid calls → one rebuild). Mock the RPCs.

**Verify:** `npm test -- feed Feed` and lint pass. Note any behavior change.

---

## Task 5: Feed reaction/comment counts — server-side aggregate (no HTTP 414)

**Files:** `src/store/feedStore.js` (`loadCommentCounts` ~511-537, `loadReactions`
~577-597), `src/screens/FeedScreen.js` (~242-254). Possibly a new Supabase
RPC/migration for aggregate counts (migrations allowed — apply via Management API
token in `.env`, idempotent, report it).

**Problem:** `loadCommentCounts`/`loadReactions` do `.in('item_key', keys)` where
`keys` is EVERY visible feed item key (unbounded), then fetch full rows and
aggregate in JS. At scale this transfers all reaction/comment rows and risks a
PostgREST URL-length limit (HTTP 414) on the `in(...)` list.

**Fix:** Use server-side aggregate counts (a Postgres RPC returning
`item_key → count`, or PostgREST `count`), and bound the key set to the paginated
page from Task 4 (not the whole history). Reactions likewise — return per-item
aggregated counts (and the current user's own reaction) rather than all rows.
If a migration/RPC is added, make it idempotent and report the exact SQL applied.

**Tests:** Assert counts are fetched for only the current page's keys (bounded),
and the displayed counts equal what the old full-row aggregation produced for a
fixture. Mock the RPC/PostgREST.

**Verify:** `npm test -- feed reaction comment` and lint pass. Report any migration.

---

## Task 6: Web media leaks — revoke object URLs + enforce size cap everywhere

**Files:** `src/lib/videoThumbWeb.js` (~9-45), `src/lib/mediaCapture.js`
(~30-34,64), `src/lib/mediaUpload.js` (~21-28 web blob path).

**Problem A (videoThumbWeb.js):** creates a `<video>` element +
`URL.createObjectURL(blob)` and returns the object URL; the `<video>` is never
removed and neither the video `src` nor the returned blob URL is ever
`revokeObjectURL`'d — every web video attach leaks a detached `<video>` + a blob.

**Problem B (mediaCapture.js):** `assertGalleryVideoSize` only runs for
`source === 'library'` and only when `asset.fileSize` is a number. Web pickers
often omit `fileSize`, so oversized web videos pass; on web the upload path does
`fetch(blob:).blob()` loading the whole file into memory. Camera-recorded videos
are never size-checked (only `videoMaxDuration: 20`).

**Fix A:** In `videoThumbWeb.js`, `video.remove()` / clear `src` in a `finally`,
and revoke the source object URL; ensure the returned thumbnail object URL is
revoked after `uploadFile` consumes it in `processUpload` (thread a cleanup, or
convert the thumb to a data URI / uploaded blob and revoke promptly). No dangling
`<video>` or un-revoked blob URL after an attach.
**Fix B:** Enforce the byte cap for ALL sources (library + camera + web). On web,
derive size from the Blob (`blob.size`) before upload and reject early with a
user-visible message if over the cap. Keep the existing 100 MB constant.

**Tests:** Assert `videoThumbWeb` revokes the object URL(s) and removes the video
element (mock URL.createObjectURL/revokeObjectURL + a fake video). Assert an
oversized web/camera video is rejected by the size guard (mock blob.size). Do NOT
break existing media tests.

**Verify:** `npm test -- media upload videoThumb` and lint pass.

---

## Out of scope (later)

Tier 5 (stat small-sample/partial-round math: report-card baseline dilution,
season SG headline denominators, coach "Penalties" mislabel, difficulty-band /
warmup-closing 18-hole assumptions, 1-round/1-point trends, up-and-down
denominator, dead `_appendConflicts` UI). Plus the Tier 2/3 cross-cutting
fast-follows tracked in memory `audit-tier1-tier2-branch`.
