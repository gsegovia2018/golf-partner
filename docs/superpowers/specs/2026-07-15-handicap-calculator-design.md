# WHS Handicap Calculator + My Stats Selection Persistence — Design

**Date:** 2026-07-15
**Status:** Approved (pending spec review)

Two independent pieces of work, designed together because both live in My Stats:

1. A **WHS handicap index calculator** — a new "Handicap" tab in My Stats that
   computes the user's Handicap Index from their played rounds, previews course
   handicaps, and can write the index to the profile.
2. A **fix for round-selection persistence** — the "rounds counted" selector in
   My Stats must keep its selections across app restarts.

---

## 1. WHS Handicap Calculator

### Goal

Answer "what is my actual handicap index, based on the rounds I've really
played?" using World Handicap System (2020) math, and let the user adopt that
number as their profile handicap index (the one game setup defaults to).

### Data sources (all already present)

| Need | Source |
|---|---|
| My rounds, chronological | `collectMyRounds()` in `store/personalStats.js` (`MyRound[]`) |
| Gross hole scores | `myRound.round.scores[playerId]` |
| Hole par + stroke index | `myRound.round.holes` |
| Playing handicap for the round | `getPlayingHandicap(round, player)` (`store/scoring.js`) |
| Extra shots per hole (for net double bogey) | `calcExtraShots(handicap, strokeIndex)` |
| Tee slope + course rating | `resolveRoundTee(round, playerId)` — per-player tee snapshot with round-level fallback |
| Course handicap conversion | `calcPlayingHandicap(index, slope, rating, par)` |
| Course library (preview picker) | `store/libraryStore.js` courses with `tees[]` and `holes[]` |
| Profile handicap write | `upsertProfile({ handicap })` in `store/profileStore.js` |

### New module: `src/store/handicapIndex.js` (pure, no IO)

Follows the repo's store-first pattern; fully unit-testable. Consumed by the
new `HandicapTab` component (below).

**`roundDifferential(myRound)` → `{ key, differential, ags, slope, rating, courseName, date } | null`**

Eligibility — returns `null` unless all of:
- `myRound.isComplete` (every hole scored) and the round has 18 holes;
- not a scramble mode (`collectMyRounds` already excludes these);
- `resolveRoundTee` yields a numeric slope > 0 and a numeric course rating.

Computation:
- **Adjusted Gross Score (AGS):** per hole,
  `min(gross, par + 2 + calcExtraShots(playingHandicap, strokeIndex))`
  where `playingHandicap = getPlayingHandicap(round, player)` — the WHS net
  double bogey cap.
- **Differential:** `(113 / slope) × (AGS − rating)`, rounded to 1 decimal.
- PCC (playing conditions) is treated as 0 — the app has no weather/field data.

**`computeHandicapIndex(myRounds)` → result object**

- Filters to eligible differentials, takes the **last 20** in chronological
  order (the window WHS uses).
- Applies the official WHS small-sample table:

  | Differentials | Counting | Adjustment |
  |---|---|---|
  | 3 | lowest 1 | −2.0 |
  | 4 | lowest 1 | −1.0 |
  | 5 | lowest 1 | 0 |
  | 6 | avg lowest 2 | −1.0 |
  | 7–8 | avg lowest 2 | 0 |
  | 9–11 | avg lowest 3 | 0 |
  | 12–14 | avg lowest 4 | 0 |
  | 15–16 | avg lowest 5 | 0 |
  | 17–18 | avg lowest 6 | 0 |
  | 19 | avg lowest 7 | 0 |
  | 20 | avg lowest 8 | 0 |

- Result: `{ index, usedCount, windowCount, eligibleCount, totalCount,
  differentials }` where `differentials` is the last-20 list, each entry
  flagged `counting: true/false`. `index` is rounded to 1 decimal and capped
  at 54.0. With fewer than 3 eligible differentials, `index` is `null` and the
  result explains via counts (UI renders an empty state saying how many
  qualifying rounds are still needed and why rounds don't qualify).
- **Selection-independent:** operates on ALL of the user's rounds, not the
  stats selector's subset. WHS always uses the last 20 — the explainer states
  this explicitly so the number never silently shifts with the stats filter.

Out of scope (documented in the explainer, not implemented): soft/hard caps
(need Low Handicap Index history), PCC, exceptional score reduction,
9-hole differentials.

### UI: new "Handicap" tab in My Stats

Sixth entry in `ALL_TABS` in `src/screens/MyStatsScreen.js`
(`{ key: 'handicap', label: 'Handicap' }`), rendered as `HandicapTab` in
`src/components/mystats/tabs/HandicapTab.js`, matching the structure of the
existing tab components:

1. **Index hero** — the calculated index, big; subtitle "Best X of last Y
   differentials". Info button → `StatDetailSheet` explainer (added to
   `statExplainers`) describing the WHS method and its limits.
2. **Differentials list** — the last-20 rounds with course name, date, AGS,
   and differential; counting rounds visually highlighted. Ineligible recent
   rounds are not listed (the explainer covers eligibility rules).
3. Course handicap preview: built, then removed by user decision 2026-07-15 —
   read as per-course calculation and duplicated game setup's automatic
   conversion.
4. **"Set as my handicap" button** — writes the calculated index to the
   profile via `upsertProfile({ handicap })`, with a confirmation state
   showing the current profile value next to the calculated one. Explicit
   only — never automatic. The profile validates handicap to 0–54
   (`lib/handicap.js`), so a plus (negative) calculated index is displayed
   as-is but clamped to 0 on apply, with a note in the UI.

Empty state (fewer than 3 eligible rounds): explains eligibility (complete
18-hole, non-scramble, tee with slope+rating) and how many more are needed.

### Testing

- Unit tests for `handicapIndex.js`: AGS capping (including plus-handicap
  extra-shot giving), differential math against hand-computed values, every
  row of the small-sample table, <3 rounds → null, 54.0 cap, eligibility
  exclusions (partial round, missing slope/rating).
- Component test for `HandicapTab`: renders hero from a stats fixture, empty
  state, apply-button calls `upsertProfile`.

---

## 2. My Stats round-selection persistence fix

### Symptom

User deselects rounds in the "rounds counted" sheet; on next app start the
selection is back to defaults.

### Current mechanism

`MyStatsScreen` stores the override map in AsyncStorage under
`@mystats_round_selection:<userId>` and restores it on load, pruning keys for
rounds that no longer exist.

### Investigation-first (systematic debugging)

Write a failing reproduction before fixing. Prime suspects, in order:

1. **No user id → no persistence.** `storageKey` is `null` unless
   `user?.id` is set; a signed-out/guest session saves nothing.
2. **Destructive pruning on partial loads.** On load, overrides whose round
   key isn't in the freshly loaded tournament list are dropped. If
   `loadAllTournamentsWithFallback` ever returns a partial list (offline,
   transient error), the in-memory map is silently pruned, and the next
   toggle persists the pruned map — permanent loss.
3. **Key instability** — round keys are `${tournamentId}:${roundIndex}`;
   verify ids/indices are stable across sync.

### Fix (as confirmed by investigation)

- Fall back to a device-scoped key (`@mystats_round_selection:local`) when
  there is no signed-in user, and migrate it into the user-scoped key on
  sign-in.
- Make pruning non-destructive: prune only for rendering/resolution, never
  persist a pruned map unless the user actually changed a selection.
- Regression test: deselect → simulate remount/reload → selection restored;
  plus a partial-load test proving overrides survive.

Acceptance criterion: deselect rounds, kill and reopen the app, the same
rounds are still deselected.

---

## Non-goals

- Course-level "always exclude this course" defaults (may follow later; this
  design keeps the existing per-round override model).
- Automatic handicap updates after each round.
- 9-hole differentials, caps, PCC, exceptional score reduction.
