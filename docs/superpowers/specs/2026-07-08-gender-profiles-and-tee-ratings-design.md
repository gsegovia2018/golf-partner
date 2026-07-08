# Gender on profiles/players + gendered tee ratings

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan

## Problem

Under the WHS/RFEG, every physical tee set has two rating/slope pairs — one
rated for men, one for women. The imported course library models this as
duplicate `course_tees` rows ("Amarillas" + "Amarillas (Damas)", identical
yardages, different rating/slope). That doubles the tee picker and relies on
players knowing to pick the "(Damas)" row. The app has no notion of player
gender, so it cannot pick the correct rating pair automatically.

## Decision summary

1. Add `gender` to **profiles** (accounts) and **players** (including guests
   without accounts), backfilled: everyone is `male` except profile
   `escribano.clau` and guest player "Claudia Escribano" (both are Claudia).
2. Collapse the duplicated tee rows: each `course_tees` row gains
   `rating_women` / `slope_women`; "(Damas)" rows are merged into their base
   row and deleted. One row per physical tee.
3. The app resolves a player's effective rating/slope from their gender at
   the moment a tee snapshot is created. Scoring is untouched — it already
   consumes per-player `{label, slope, rating}` snapshots stored on rounds.

## Schema changes (new migration in `supabase/migrations/`)

```sql
ALTER TABLE public.profiles ADD COLUMN gender text
  CHECK (gender IN ('male','female'));          -- nullable: signup trigger
ALTER TABLE public.players  ADD COLUMN gender text
  CHECK (gender IN ('male','female'));
ALTER TABLE public.course_tees
  ADD COLUMN rating_women numeric,
  ADD COLUMN slope_women  integer;
```

- **Backfill profiles:** `gender='male'` for all rows, then `'female'` where
  `display_name = 'escribano.clau'`.
- **Backfill players:** `gender='male'` for all rows, then `'female'` where
  `trim(name) = 'Claudia Escribano'`.
- **Sync trigger:** extend `sync_player_from_profile()` to carry `gender`
  (add to INSERT columns and `DO UPDATE SET`), and add `gender` to the
  trigger's `UPDATE OF` column list, so account gender flows to the linked
  player row.
- **Tee merge (data migration, same file):** for each row whose label matches
  `(Damas)` at the end (case-insensitive), find the sibling row on the same
  course whose label equals the base label (trimmed, case-insensitive). If
  found: copy the Damas row's `rating`/`slope` into the base row's
  `rating_women`/`slope_women` and delete the Damas row. If no base sibling
  exists, keep the row unchanged (a women-only tee remains a normal tee).
- The migration must be committed to the repo **and** applied to the live DB
  via the Management API (repo migrations and live schema are kept in sync
  manually — see CLAUDE.md / schema-drift note).

DB-level `NOT NULL` on gender is deliberately not used: the signup trigger
creates bare profile rows. The UI enforces population (below).

## App changes

### Store layer

- `store/tees.js`: new pure helper
  `resolveTeeForPlayer(tee, gender)` → `{label, rating, slope}`.
  Female + `ratingWomen`/`slopeWomen` present → women's values; otherwise the
  base values. Missing/unknown gender behaves as male. `blankTee()` gains
  `ratingWomen: null, slopeWomen: null`.
- `store/libraryStore.js`: `normalizeCourse` maps
  `rating_women → ratingWomen`, `slope_women → slopeWomen`;
  `saveCourseTees` writes both new columns.
- `store/profileStore.js`: `loadProfile`/`upsertProfile` carry `gender`.
- Player CRUD (players store / PlayersScreen save path) carries `gender`.
- Tournament player snapshots (`tournament.players[]`) include `gender` when
  built from the players library, so rounds can resolve tees offline.

### Snapshot creation sites (all resolve via `resolveTeeForPlayer`)

- `screens/setupWizard.js` — initial per-player tee assignment.
- `components/RoundTeeAssignments.js` — manual tee changes.
- `lib/quickStartGame.js` — quick-start defaults.
- `store/tournamentStore.js` — `reTeeRound` (needs the round's players'
  genders; pass a `playerId → gender` lookup from `tournament.players`) and
  `lastTeeForPlayer` prefill.

Historical rounds keep their stored snapshots. After the merge, old
snapshots labeled "… (Damas)" no longer re-match by label on course edits;
they simply keep their stored (correct) values — same behavior as any
manually-adjusted tee today.

### UI

- **ProfileScreen:** required Male/Female selector, saved with the profile.
- **Home banner:** while the signed-in user's profile has `gender = null`,
  show a dismissable-per-session banner linking to ProfileScreen. This is
  the "make sure it's filled" mechanism for future signups.
- **PlayersScreen:** guest player creation/edit gets a Male/Female toggle
  defaulting to Male — the field is always populated at creation.
- **CourseEditorScreen:** optional "Rating (women)" / "Slope (women)" inputs
  per tee row.
- Tee pickers need no structural change — after the merge there is one row
  per physical tee.

## Out of scope

- Non-binary/unspecified gender options (WHS ratings are published as
  men's/women's pairs; the field drives handicap math only).
- Re-rating of already-played rounds.
- Any scoring/stats engine changes.

## Testing

- `tees.test`: `resolveTeeForPlayer` — female with women's columns, female
  without (fallback), male, null gender, null tee.
- Snapshot-path tests: setup wizard and `reTeeRound` produce women's
  rating/slope for female players, men's otherwise.
- Migration pairing logic validated against live data before applying
  (dry-run SELECT of merge pairs; expect ~1:1 base/Damas pairs on imported
  courses, zero orphan deletions).
- Full Jest suite + ESLint green before commit.
