# Score Conflict & Sync Overhaul (sync v2.1)

**Date:** 2026-07-13
**Status:** Design — approved for planning
**Supersedes:** the conflict approach in
`2026-05-21-scorecard-conflict-resolution-design.md`.
**Scope:** Workstream A of a two-part effort. This spec covers multi-player
scorecard sync and score-disagreement resolution. The per-round / global
leaderboard rework (workstream B) is a separate spec built afterward.

---

## 1. Problem

Multiple players in the same round each enter scores on their own device
(everyone tracks the whole foursome). Today:

- Score **values** do converge — each `(tournament, round, player, hole)` cell
  is written to `game_scores` via **server-clock last-write-wins**, propagated
  by realtime + a 20s poll. So stored numbers end up identical. ✅
- But the **conflict prompt** is broken (`mutationWrites.js:94-109`). It fires
  on the writing device when a prior value existed, differed, **and** the
  server's timestamp on that value is newer than the local edit's
  **device-clock** enqueue time. This means:
  - It compares a **device clock to the server clock** → clock skew produces
    false conflicts.
  - It is **asymmetric**: only the "stomping" device records a marker; peers
    silently lose their value and are never told. Markers are **never synced**
    (`mutate.js:437-456`).
  - A **hard Finish gate** (`ScorecardScreen.js:1243-1246`) blocks finishing the
    round while any local marker exists — so one player is walled off by a
    conflict the others don't even see.
  - A **blank** entry from one scorer can read as a disagreement against another
    scorer's number.

**Goal:** scores sync silently and converge to identical data for everyone;
genuine disagreements (two different, non-blank, committed values) are surfaced
**once, at the right moment**, showing **who entered what**, and are resolvable
by anyone with the result synced to all devices.

## 2. Decisions (from brainstorming)

1. **Prompt only for real disagreements** — two *different, non-blank* values
   genuinely coexisting. Drop the device-vs-server clock test. Blank ≠
   disagreement (a missing entry just fills in).
2. **Attribution** — the resolve UI shows who entered which value
   ("Marco: 4 · Claudia: 5"), and who left it blank.
3. **Synced, symmetric markers** — everyone derives the same conflict; anyone
   can resolve; the resolution propagates to all devices.
4. **Surfacing timing = "everyone off the hole", debounced + finish review** —
   a hole's disagreement is not shown while players may still be entering it;
   it surfaces once **all active scorers have advanced past that hole** (early
   enough that players still remember the hole), and any still-unresolved
   disagreements are re-presented as a review step at round finish.
5. **Data model = per-author score entries (Approach 1).** A submissions layer
   records each author's value per cell; conflict state is *derived*, not
   detected one-sidedly.

## 3. Data model

### New table `game_score_entries`

The submission layer. One row per `(cell, author)`.

| Column          | Type        | Notes                                             |
|-----------------|-------------|---------------------------------------------------|
| `tournament_id` | uuid/text   | FK to `tournaments` (part of every key, per v2)   |
| `round_id`      | text        | round id (unique only within a tournament)        |
| `player_id`     | text        | the player being scored                           |
| `hole`          | int         | hole number                                       |
| `author_id`     | text        | **who operated the device** (the current user)    |
| `strokes`       | int NULL    | that author's value; `NULL` = blank (not scored)  |
| `updated_at`    | timestamptz | server clock, set on upsert                       |

- **PK** `(tournament_id, round_id, player_id, hole, author_id)`.
- **RLS** delegates to the parent `tournaments` row, matching the other
  `game_*` tables (`migration:139-180`).
- A blank is represented by **absence of a row** (or a `NULL` strokes row). It
  never contributes a candidate.

### `game_scores` (unchanged shape, new role)

Remains the **effective / resolved** value for the cell — the fast read path
that `get_game_tournament` and every current reader already use. It is now a
*derived* projection of `game_score_entries` plus any resolution (see §4).
Keeping it means no reader changes and full back-compat.

### Effective-value derivation (pure function, `store/scoreEntries.js`)

Given the set of author rows for a cell:

```
distinct = unique non-null strokes across authors
if a resolution exists           -> effective = resolved value ; status = resolved
else if distinct.size <= 1       -> effective = that value (or blank) ; status = agreed
else (distinct.size >= 2)        -> effective = <most-recent author value> ; status = conflict
                                    candidates = [{ authorId, value }] for each distinct value
```

- **Self-correction** falls out naturally: if an author edits their own value to
  match, `distinct` shrinks to 1 and the conflict clears for everyone.
- Derivation is a **pure function** — unit-testable in isolation.

## 4. Resolution

- A **resolution** records `{ value, resolved_by, resolved_at }` for a cell.
  Store it either as a `resolved_*` triplet of columns on `game_scores` or a
  small `game_score_resolutions` table — implementation detail for the plan; the
  contract is: a resolution supersedes derivation, sets the effective value, and
  clears `conflict` status for everyone.
- Raw `game_score_entries` are **kept** after resolution (audit / "who had
  what"); resolution only picks the winner.
- **Anyone in the round can resolve.** The pick syncs via realtime and clears
  the prompt on all devices.
- Editing a cell after resolution (a genuinely new value that re-splits the
  distinct set) re-opens a conflict — resolution is per current value set, not a
  permanent mute.

## 5. Surfacing gate ("everyone off the hole")

Entries always sync live; only the **prompt/dot** is gated.

- Each device broadcasts its `currentHole` via **realtime presence** on the
  existing `game-${id}` channel.
- **Active scorers** = authors who have submitted ≥1 entry this round (and/or
  are present on the channel).
- A hole-N conflict is **surfaceable** once **every active scorer's
  `currentHole` > N**. Fallback proxy when presence is thin: treat an author as
  "past N" once they have entered a score for any hole > N
  (`max(hole with a non-null entry)` per author).
- **Finish backstop:** on finish, re-check **all** holes regardless of the gate;
  unresolved genuine conflicts go to the finish-review sheet, and finish stays
  gated until they are resolved — but resolvable by anyone and synced.

The gate is **event-based** ("all off the hole"), not a timer.

## 6. UI

Reuse the existing sheets, upgraded for attribution:

- **`ScoreConflictSheet`** (inline, mid-round; wired at `HoleView.js:469-489`)
  and **`FinishConflictSheet`** (at finish; `ScorecardScreen.js:1732`) both list
  candidates **with author names** — "Marco: 4 · Claudia: 5" — and show who left
  the cell blank. Tapping a value resolves it.
- The mid-round conflict **dot** on a hole appears only for surfaceable
  conflicts (per §5).

## 7. Sync layer & realtime

- **`submit_game_score(tournament, round, player, hole, author, strokes)`** RPC:
  upserts the author's entry, recomputes the effective value into `game_scores`,
  returns the derived conflict state. Replaces `set_game_score` on the write
  path; `set_game_score`'s clock-based conflict read is removed.
- **`resolve_game_score(tournament, round, player, hole, value, resolver)`** RPC:
  records the resolution, updates the effective value.
- **`store/mutate.js`**: `score.set` mutations carry `authorId` (current user).
  Local optimistic model shows the author's own value immediately; conflict
  state is derived once peer entries arrive.
- **`store/mutationWrites.js`**: route `score.set` through `submit_game_score`;
  **remove** the one-sided clock-based detection at `:94-109`.
- **`store/realtimeSync.js`**: subscribe to `game_score_entries` in addition to
  the existing tables; `applyEntryRow` updates local entries and re-derives
  conflict state. Presence tracking added on the same channel.
- Retire the unsynced local-only `scoreConflicts` markers
  (`mutate.js:437-488`); conflicts are now derived from synced entries. Fix the
  stale `merge.js` reference comment at `scoring.js:853`.

## 8. Migration & back-compat

- Migration **backfills `game_score_entries`** from existing `game_scores` — one
  legacy entry per cell (`author_id = 'legacy'`), so historical rounds show **no
  false conflicts**.
- `get_game_tournament` keeps returning effective values → **no reader change**;
  old clients keep working. Everyone in this group is on the web app (updates
  immediately), so mixed-version risk is minimal.

## 9. Components & boundaries

- **`store/scoreEntries.js`** (new): pure derivation (effective value, conflict
  status, candidates) + the surfacing-gate predicate. No I/O.
- **`store/mutate.js` / `mutationWrites.js`**: carry `authorId`, call the new
  RPCs, drop the old detector.
- **`store/realtimeSync.js`**: entries subscription + presence.
- **Screens/components** (`ScorecardScreen`, `HoleView`, `ScoreConflictSheet`,
  `FinishConflictSheet`): consume derived conflict state; no domain logic added.
- SQL: one new migration (table + RPCs + backfill + RLS).

## 10. Testing (TDD, RED first)

**Unit (`store/scoreEntries.js`):**
- Agreement: all authors equal → agreed, no conflict.
- Blank-safe: one author blank + one non-null → agreed, fills in, no conflict.
- 2-, 3-, 4-way distinct values → conflict with correct candidates + authors.
- Self-correction: author edits own value to match → conflict clears.
- Resolution supersedes; post-resolution new value re-opens conflict.
- Surfacing gate: not surfaceable until all active scorers past the hole;
  finish backstop surfaces all.

**Sync / integration:**
- Two devices, differing values → both derive the same conflict; either
  resolves; result propagates.
- Offline edit then reconnect → converges; blank from one device never
  conflicts with a number from another.
- Realtime entry propagation updates conflict state on peers.

## 11. Out of scope

- Per-round / global leaderboard rework and strokes tiebreak (workstream B —
  separate spec).
- Official-tournament leaderboard (separate system).
- Non-score state conflicts (players array, `pairs`/teams) — remain coarse LWW
  as today; unchanged here.
- Tournament-level finish behavior (multi-round finishing) — unchanged.
