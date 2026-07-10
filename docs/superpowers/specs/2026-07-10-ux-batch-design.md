# UX batch — invites visibility, edit-correct-tournament, scoreboard, per-round handicap, bottom-sheets

Date: 2026-07-10
Status: approved (implement + merge to main)

Five mostly-independent changes requested together.

## 1. Roster account linking (fixes "Guille no ve el torneo")

**Root cause (confirmed):** the roster had two "Guille" entries and the one added had
no linked account (`user_id`), so nothing associated the tournament with his account.
For casual games, the DB trigger `20260529000001_participant_editor_invites.sql`
already auto-adds membership + an `added_to_game` notification when a roster player has
a linked `user_id`; the in-app notifications inbox already works on web. So the real gap
is making it obvious *which roster entries are linked to a real account* and easy to link
the right one.

**Approach A (chosen):** in the players editor (`PlayersScreen.js`, and the picker it uses),
- Visually mark each roster player as **linked** (has an account) vs **local** (typed name).
- Make it easy to attach a friend's account to an unlinked slot (pick from friends).
- No new "accept" flow, no new RPC — rely on the existing participant→member trigger and
  the existing notifications inbox.

Files: `src/screens/PlayersScreen.js`, `src/screens/PlayerPickerScreen.js` /
`src/screens/PlayerLibrary*`, friends store. No migration.

## 2. Edit the tournament you entered (not the active one)

**Bug:** `EditTournamentScreen` ignores navigation params and always resolves
`getActiveTournamentSnapshot()` / `loadTournament()` (the global active tournament).
The settings sheet navigates to it without params (`HomeScreen.js:~2095`).

**Fix:** `EditTournamentScreen` accepts `route` and resolves by
`route.params.tournamentId` via `getTournamentSnapshot(id)` / `getTournament(id)` /
saves the id-scoped object (mirror `PlayersScreen`). Settings sheet passes
`{ tournamentId: tournament.id, tournamentName: tournament.name }`.

Files: `src/screens/EditTournamentScreen.js`, `src/screens/HomeScreen.js`.

## 3. Scoreboard: strokes/points toggle, score shapes, orientation

`GridView.js` renders FRONT/BACK nine, two rows per player (strokes + `Pts`).

- **Toggle** (global, above the table): strokes-only vs points-only. Hides the other row.
- **Score shapes** over the strokes cell, relative to hole par, via a new helper
  `classifyHoleResult(par, strokes)` → `eagle | birdie | par | bogey | double`:
  - circle = birdie, double circle = eagle-or-better
  - square = bogey, double square = double-bogey-or-worse
  - par = no shape
- **Orientation:** vertical keeps 2 stacked blocks; landscape keeps the existing
  side-by-side nines (already triggered at `width >= 720`). Just make the switch clean.

Files: `src/components/scorecard/GridView.js`, `scoreModel.js` or `constants.js`
(new classify helper + test), `src/components/scorecard/styles.js`,
`src/screens/ScorecardScreen.js`.

## 4. Per-round handicap index override

Today the round editor (`RoundTeeAssignments.js`) shows the index read-only and only lets
you edit the playing handicap. Add an editable **per-round index override**:

- New per-round storage `round.playerIndexes[playerId]` + a mutation mirroring
  `handicap.set` (`index.set`) in `src/store/mutate.js`.
- Editing the round index recomputes the playing handicap via
  `deriveRoundPlayingHandicap(index, round, playerId)` unless the playing value is a
  manual override (`manualHandicaps`).
- Does **not** touch the player's global/tournament index — override is per round.
- Read path: scoring resolves the round index override when present, else the player index.

Files: `src/store/mutate.js`, `src/store/scoring.js`,
`src/components/RoundTeeAssignments.js`, tests in `src/store`.

## 5. Reusable BottomSheet (fix scrim sliding up)

All bottom sheets use `<Modal animationType="slide">` with the dark backdrop *inside* the
sliding container, so the scrim slides up with the sheet. Create a reusable
`src/components/BottomSheet.js`: static/fading full-screen backdrop (appears immediately) +
only the sheet slides up (`Animated.Value` translateY). Migrate the main sheets:
settings, invite, scoring-mode change, attach-media, capture menu.

Files: new `src/components/BottomSheet.js`; `src/screens/HomeScreen.js`,
`src/components/ScoringModeChangeSheet.js`, `AttachMediaSheet.js`, `CaptureMenuSheet.js`.

## Verification

- `npm test` (jest-expo) and `npm run lint` must pass (lint is CI-blocking).
- New unit tests for `classifyHoleResult` and the per-round index recompute.
- Manual/visual check of scoreboard toggle+shapes, sheet scrim, and edit-correct-tournament.
