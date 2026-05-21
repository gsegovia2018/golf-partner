# Unified "Players" entry in the round gear menu

**Date:** 2026-05-21
**Status:** Approved — ready for implementation planning

## Problem

In the round view (`HomeScreen` — where the leaderboard lives), the gear-icon
settings sheet exposes player management as three separate items, and a fourth
related concern lives elsewhere entirely:

- **Add Player** — navigates to `PlayerPicker`
- **Remove Player** — opens `PlayerRemoveSheet`
- **Members** — navigates to `MembersScreen` (roles, invites, leave)
- **Handicaps** — buried inside **Edit Tournament** → `EditTournamentScreen`
  (base handicap index + per-round tee assignments / playing handicaps)

Everything player-related should live behind one gear-menu entry named
**Players**, opening a single unified screen.

## Goal

Replace the three gear-menu items and the handicap editing in Edit Tournament
with a single **Players** menu item that opens one purpose-built screen
covering: the roster, add/remove players, base + per-round handicaps, and
member access control (roles, invites, leave).

## Build approach

Create a new `src/screens/PlayersScreen.js`; delete `MembersScreen.js`.

`MembersScreen` iterates the *members* list (`tournament_members`), but the
unified screen must be roster-major — it iterates `tournament.players`.
Retrofitting `MembersScreen` would invert its core loop, so a purpose-built
screen is cleaner. Reusable logic (member-row role/release actions, invite,
leave) is lifted across rather than rewritten.

`MembersScreen.js` and `PlayerRemoveSheet.js` (the latter replaced by per-row
delete buttons) become dead code and are removed.

## Domain note: roster vs members

The app distinguishes two lists:

- **Roster** — `tournament.players`: who is playing. Carries names and base
  handicaps. May be plain names or linked to app users.
- **Members** — `tournament_members`: app users with an access role
  (`owner` / `editor` / `viewer`), invites, and the ability to leave.

A member may *claim* a roster slot (`findClaimedSlot(players, userId)`). The
unified screen lists the **roster** as its primary list; member-specific
controls (role badge, promote/demote, release slot) appear inline on a row
**only when that slot is a claimed member**. This keeps casual games clean
(rows are just avatar / name / handicap / delete) while shared tournaments
get the full member tooling.

The two removal concepts are kept distinct and unchanged in behavior:

- **Remove player** (roster) — `applyRemovePlayer` → `tournament.removePlayer`
  mutation; removes the slot and the player's scores. Per-row delete button,
  gated `!isViewer && players.length > 2`.
- **Release slot** (member) — `releaseTournamentPlayer`; unclaims a slot so it
  can be re-claimed. Owner-only inline action on claimed-member rows.
- **Remove member** (access) — `removeTournamentMember`; revokes access.
  Owner-only inline action on claimed-member rows.

## 1. Gear menu changes — `HomeScreen.js`

- **Remove** the Add Player, Remove Player, and Members menu items.
- **Add** a single **Players** item:
  - Icon: `users` (Feather).
  - Always visible (viewers included — `MembersScreen` was always visible).
  - `onPress`: close the sheet, then
    `navigation.navigate('Players', { tournamentId: tournament.id, tournamentName: tournament.name })`.
  - Positioned where Members was — after **Statistics**, before
    **Edit Tournament**.
- **Relocate from `HomeScreen` to `PlayersScreen`:**
  - `commitAdds`, `applyAddPlayers`, `commitRemove`, `applyRemovePlayer`.
  - The `modePrompt` and `removeModePrompt` state.
  - Both add/remove `ScoringModeChangeSheet` instances.
  - The `PlayerRemoveSheet` instance (then deleted — see §4).
  - The `navigation.addListener('focus', ...)` effect that consumes
    `consumePendingPlayers()` after returning from `PlayerPicker`.
- `HomeScreen` reflects roster/handicap changes through its existing
  `subscribeTournamentChanges` subscription and focus-`reload` listener — no
  new wiring needed. This is a net reduction of the `HomeScreen` monolith.

## 2. New screen — `src/screens/PlayersScreen.js`

Registered as route `Players` in `App.js`. Route params:
`{ tournamentId, tournamentName }`.

A `ScrollView` screen with a header (back, title "Players", tournament-name
subtitle) and an auto-save status pill, matching `EditTournamentScreen`.

### Sections

1. **Roster**
   - Top row: "{n} players" label + **[+ Add]** button, gated
     `!isViewer && players.length < 4`. Navigates to `PlayerPicker` with
     `alreadySelectedIds: tournament.players.map(p => p.id)`.
   - One row per `tournament.players` entry:
     - Avatar (initials via `playerInitials`).
     - Player name.
     - **Base handicap index** — numeric `TextInput` for editors/owners;
       read-only text (`HCP n`) for viewers.
     - **Role badge** (`OWNER` / `EDITOR` / `VIEWER`) — only when the slot is
       a claimed member.
     - **Owner-only member actions** — promote/demote role
       (`updateMemberRole`), release slot (`releaseTournamentPlayer`) — only on
       claimed-member rows, for non-self non-owner members.
     - **Delete player** button — confirm dialog → `applyRemovePlayer`. Gated
       `!isViewer && players.length > 2`.
2. **Invite people** — button, owner only. Reuses `generateInviteCode` +
   `buildJoinLink` + share/clipboard (lifted from `MembersScreen.handleInvite`).
3. **Tees & playing handicaps** — gated `!isViewer` (viewers never saw tee
   assignments). Per round: a "Round N — {courseName}" header followed by the
   existing `RoundTeeAssignments` component, reused unchanged (props: `round`,
   `players`, `theme`, `onChange`; host passes the documented `key`).
4. **Leave tournament** — button at the bottom, shown for non-owner members.
   Reuses `removeTournamentMember(tournamentId, user.id)`.

### Data and persistence

- `loadTournament()` provides the roster and rounds (the active tournament —
  same source `EditTournamentScreen` uses).
- `loadTournamentMembers(tournamentId)` provides member rows; each is mapped to
  a roster slot via `findClaimedSlot`.
- **Auto-save** for handicaps: the debounced save block is lifted from
  `EditTournamentScreen` (lines ~108–165) — base handicaps written as
  `players[].handicap`, per-round playing-handicap changes emitted as
  per-cell `handicap.set` mutations, the rest via `saveTournament`. The
  `subscribeTournamentChanges` merge-load guard (`skipNextSaveRef`) is carried
  over so external writes don't clobber in-flight edits.
- **Add/remove roster:** `applyAddPlayers` / `commitAdds` / `applyRemovePlayer`
  / `commitRemove` and the `ScoringModeChangeSheet` revalidation flow are
  lifted from `HomeScreen` unchanged. The `consumePendingPlayers()` focus
  listener moves here, since `PlayerPicker` is now launched from and returns to
  `PlayersScreen`.
- **Member actions** (`updateMemberRole`, `removeTournamentMember`,
  `releaseTournamentPlayer`) call the store/Supabase directly and reload the
  member list, as `MembersScreen` does today.

### Viewer behavior

Viewers open the screen and see the roster with read-only handicaps (no Add,
no delete, no role actions, no Invite). The "Tees & playing handicaps" section
is hidden for viewers — matching today, where `EditTournamentScreen` (the only
place tee assignments are editable) is entirely `!isViewer`. The "Leave
tournament" button still shows, since viewers are members.

## 3. `EditTournamentScreen.js` changes

- Remove the **Handicap Index** section (the base-index `playerCard` list).
- Remove the `RoundTeeAssignments` block from each round card. Round cards
  keep: course name input, notes, **Edit Holes & Tees**, and add/remove round.
- Save logic simplifies: drop the per-cell `handicap.set` mutation loop. The
  `players` state becomes read-only — still loaded, but used only to seed
  `addRound`'s `playerHandicaps` and to compute `roundEnteredCount`. The screen
  no longer writes `players`; it continues to save rounds and settings.
- The **Scoring Mode** section is left untouched here. The separate
  `2026-05-21-scoring-mode-gear-menu-design.md` spec owns relocating it; the
  two changes are independent and coexist.

## 4. Cleanup

- Delete `src/screens/MembersScreen.js`; remove its `import` and
  `Stack.Screen name="Members"` from `App.js`.
- Delete `src/components/PlayerRemoveSheet.js`; remove its `import` and usage
  from `HomeScreen.js` (replaced by per-row delete buttons in `PlayersScreen`).
- Register the new `Stack.Screen name="Players"` in `App.js`.

## Interactions and constraints

- **Scoring-mode-gear-menu spec** (`2026-05-21-scoring-mode-gear-menu-design.md`,
  approved, not yet implemented): also edits the gear menu and shrinks
  `EditTournamentScreen`. The changes are independent — this spec places the
  "Players" item and removes handicap UI; that spec places a "Scoring Mode"
  item and removes the Scoring Mode section. Whichever lands second rebases its
  gear-menu edit around the other's item.
- The branch `fix/mode-change-rebuilds-pairs` has uncommitted changes in
  `SetupScreen.js` and `tournamentStore.js` from prior work — left untouched.

## Testing

- No screen-level Jest tests exist for `HomeScreen`, `EditTournamentScreen`,
  `MembersScreen`, `PlayerPicker`, or `PlayerRemoveSheet`; the suite is
  store/lib-focused. The `tournament.addPlayer`, `tournament.removePlayer`, and
  `handicap.set` mutations keep their existing store-level coverage — no
  behavior change there.
- Verify the full Jest suite (`npm test`) and `npm run lint` stay green after
  the screen moves and deletions.
- Manual verification on the new `PlayersScreen`:
  - Add a player (incl. the scoring-mode revalidation prompt when the new
    count invalidates the current mode).
  - Remove a player (incl. revalidation prompt; the `players > 2` floor).
  - Edit a base handicap index and confirm the save pill cycles
    saving → saved.
  - Edit a per-round tee / playing handicap.
  - Owner: promote/demote a member, release a slot, invite, remove a member.
  - Non-owner member: leave tournament.
  - Viewer: roster read-only, no edit affordances, tees section hidden.
