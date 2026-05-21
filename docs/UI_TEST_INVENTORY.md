# Golf Partner — Feature Inventory for UI Testing

> Purpose: complete catalogue of every user-facing feature, screen, and flow,
> framed as testable scenarios. This is the source-of-truth for building the
> UI test suite. Generated 2026-05-21 from a full codebase investigation.

## 1. Testing context & key findings

| Fact | Detail |
|------|--------|
| Platforms | Web (`react-native-web`) + Android, one Expo SDK 54 codebase |
| Existing tests | ~435 Jest tests — almost all **logic/unit** (store/lib). Only `ScorecardScreen`, `roundTeeAssignments`, `cardGrid`, `TargetHandicapPicker` render components. |
| Test runner | `jest` + `jest-expo`; `@testing-library/react-native` v13 already installed |
| E2E tooling | **None.** No Detox, no Playwright, no `e2e/` dir |
| **`testID` props** | **0 across all of `src/`** — there are no stable test selectors today |
| `accessibilityLabel` | 78 (mostly Spanish, e.g. `"Add memory"`, `"Cerrar"`, `"Compartir"`) |
| `accessibilityRole` | 22 (tabs, buttons) |

### ⚠️ Blocker for UI testing
The app has **no `testID` anchors**. Any UI test suite must either (a) query by
visible text / accessibility role, which is brittle and partly Spanish, or
(b) add `testID` props to the controls listed in this document first. Adding
testIDs is the recommended first task — see §10.

### Recommended approach
- **Component/integration UI tests:** `@testing-library/react-native` (already
  present) — renders a screen, fires presses, asserts on output. Best fit for
  most flows since the stores can be mocked.
- **Full E2E:** the web build is the cheapest target — `npm run build:web` then
  Playwright against the static export. Native E2E would need Detox added.

---

## 2. Navigation & app shell

**Files:** `App.js`, `AuthContext.js`, `FloatingTabBar` (in `App.js`)

- Stack navigator wrapping a 3-tab bottom bar: **Feed**, **Home/Play**, **History**.
- 34 registered routes (full list in agent notes; key ones below).
- Custom `FloatingTabBar` — active tab expands to show a label; a red dot shows
  on the Play tab when a round is in progress.
- Portrait-locked except `Scorecard` (allows landscape grid view).
- Deep links: `/join-tournament/:code`, `/join/:token`, `?invite=<code>` (web).

**Testable scenarios**
- App boots to Home tab; tab bar renders 3 tabs.
- Switching tabs renders the right screen.
- Live-round red dot appears on Play tab when a tournament round is active.
- Deep link URL routes to the correct screen (logged-in vs logged-out paths).

---

## 3. Authentication

**Files:** `AuthScreen.js`, `AuthContext.js`, `oauth.js`, `JoinTournamentLinkScreen.js`

**Features**
- Email + password sign in / sign up (email regex, password ≥ 6 chars).
- Forgot-password reset email.
- Google OAuth, Apple OAuth (PKCE flow).
- Anonymous sign-in (for guest join-link flow).
- Auth gate: unauthenticated → `AuthScreen`; join-link → `JoinTournamentLinkScreen`.
- Sign out (from Profile).

**Testable scenarios**
- Invalid email / short password shows validation error, blocks submit.
- Toggling Sign In ↔ Sign Up changes the submit action.
- Join-link while logged out shows "Continue without an account" + "I have an account" choices.
- Sign out returns app to `AuthScreen`.

---

## 4. Home screen

**File:** `HomeScreen.js` (two modes: `list` and `tournament`)

### List view
- Header: hamburger menu (notification red dot), avatar button → Profile.
- "Start Playing": **New game** → `Setup{kind:'game'}`; **New tournament** → modal
  → Casual (`Setup{kind:'tournament'}`) or Official (`OfficialCreate`).
- "Join with code" tile → `JoinTournament`.
- Tournament list: GAMES + TOURNAMENTS sections; per-card status/role/offline badges;
  delete (owners); tap → casual `Tournament` view or `OfficialSetup`.
- Menu modal: Friends, Notifications (unread count), Statistics.
- Pull-to-refresh; offline banner; empty states.

### Tournament view
- Header: back, share/invite, gallery, toggle running scores, settings.
- Leaderboard card (Points ↔ Strokes toggle, medal ranks, clinch award).
- Round scores card: round tabs + swipeable pager, per-round 3-dot menu.
- Bottom action bar (owners): Scorecard / Edit Scores, Start Next Round.
- Invite modal: code box, QR, Editor/Viewer role toggle, share link.
- Settings modal: edit teams, reset/restore round, share leaderboard,
  add/remove player, Statistics, Members, Edit Tournament, finish/reopen, delete.

**Testable scenarios**
- New game / new casual / new official each navigate correctly.
- Tapping a tournament card opens the right detail screen.
- Leaderboard Points↔Strokes toggle changes displayed values.
- "Toggle running scores" replaces values with "—".
- Viewer role hides share / add-player / scorecard controls.
- Delete tournament shows confirm and removes the card.
- Empty / offline / all-finished states each render their copy + CTA.

---

## 5. Tournament / round core gameplay

### 5a. Setup wizard
**Files:** `SetupScreen.js`, `setupWizard.js`, `components/setup/*`

- Steps: game = `course → players → tees → [scoring] → review`;
  tournament = `rounds → players → tees → [scoring] → review`.
- Player picker (search, inline create, 4-player cap).
- Course picker (search, new course, favorites, club→layout).
- Tee + playing-handicap assignment per player (auto vs manual override).
- Scoring mode picker — Stableford, Match Play, Sindicato, Stableford-with-Partners, Best Ball (with best/worst ball point inputs).
- Review screen: editable name, tap-to-edit rows, Start button gated by validation.

**Testable scenarios**
- Wizard advances only when a step is valid (≥1 player, all rounds have a course).
- Scoring step is skipped for solo games.
- Disabled scoring modes show requirement pill ("3+ players").
- Start game → `Scorecard`; start tournament → `Tournament` view.

### 5b. Scorecard
**File:** `ScorecardScreen.js`

- Hole view (pager, ± steppers, tap-to-type, celebration animations) and
  Grid view (all holes, landscape).
- Per-mode behaviour: Stableford points, Match Play hole winner, Sindicato splits, Best Ball best/worst.
- Shot-detail recording (casual, "me" only): putts, drive direction, penalties, sand, recovery, distance buckets.
- Round + per-hole notes (debounced autosave).
- Running-score visibility toggle; camera/media menu; finish-round overlay.
- Official mode: read-only other players, discrepancy sheets, attest card.

**Testable scenarios**
- Entering a score updates points/strokes totals.
- ± stepper first-tap heuristic (+→par, −→birdie).
- Eagle-or-better triggers celebration overlay.
- Hole view ↔ Grid view toggle.
- Each scoring mode shows its mode-specific per-hole display.
- Finishing the last hole prompts round summary / tournament archive.

### 5c. Mid-round actions
- **Add player** mid-round (≤4) — store path `tournament.addPlayer`.
- **Remove player** mid-round — `PlayerRemoveSheet`, `tournament.removePlayer`.
- **Edit teams** — `EditTeamsScreen` (tap-swap two pairs, Save Teams).
- **Change scoring mode** — `ScoringModeChangeSheet` / `ScoringModeChangeBanner`
  (auto-prompted when player count invalidates current mode).

**Testable scenarios**
- Add/remove player updates roster and re-validates scoring mode.
- Removing a player past mode minimum opens the mode-change sheet.
- Edit teams swap persists after Save.

### 5d. Round completion & history
**Files:** `RoundSummaryScreen.js`, `RoundReportCard.js`, `NextRoundScreen.js`, `FinishedScreen.js`, `HistoryScreen.js`, `PartyBoardScreen.js`

- Finish round → celebration → report card (casual) or round summary (official).
- Next Round: reveal countdown, pair cards, re-shuffle, Start Round N.
- Round summary: leaderboard, scorecard grid, photos, notes.
- Finished screen: reopen / delete finished tournaments.
- History: "Your Record" stats grid + tournament/game cards.

**Testable scenarios**
- Next Round countdown reveals pairs; re-shuffle changes pairs.
- Reopen moves a tournament from Finished back to active.
- History record grid computes from finished tournaments.

---

## 6. Official tournaments

**Files:** `Official{Create,Setup,Admin}Screen.js`, `JoinOfficialScreen.js`, `JoinTournamentScreen.js`, `MembersScreen.js`, `EditTournamentScreen.js`, `PartyBoardScreen.js`, `DiscrepancySheet.js`, `useOfficialRound.js`

**Features**
- 4-step create wizard: roster → rounds → format (gross_net/stableford/pairs/match) → review.
- Setup: local rules, roster (show link/QR, regenerate token, withdraw/reinstate), rounds.
- Party board: manual / auto-by-handicap / random pairing, marker assignment (round-robin + override), start round.
- Admin monitor: discrepancy force-resolve, withdraw player, force-finalize party, notifications feed.
- Join via magic token (`JoinOfficialScreen`) or join code (`JoinTournamentScreen` → role-based routing → `ClaimPlayer`).
- Shared leaderboard (polls every 20s); two-source scoring (self + marker); discrepancy resolution.
- Members: role badges (owner/editor/viewer), invite, change role, remove, leave.

**Testable scenarios**
- Create wizard gates "Create Tournament" on roster + all rounds having courses.
- Show-link reveals QR + copies link; regenerate issues a new token.
- Party board auto/random fill assigns all players; start blocks on empty/unassigned.
- Discrepancy sheet: editable side steppers; auto-closes when scores agree.
- Admin force-resolve writes agreed strokes; withdraw re-links marker chain.
- Join by code routes viewer → back, editor → `ClaimPlayer` or `Tournament`.
- Members: owner can change role / remove; non-owner sees "Leave".

---

## 7. Course & player libraries

**Files:** `CoursesLibraryScreen.js`, `CourseLibraryDetailScreen.js`, `CourseEditorScreen.js`, `PlayersLibraryScreen.js`, `FriendsScreen.js`, `TeesEditor.js`

**Features**
- Course library: search (diacritic-insensitive), add, favorite toggle, edit, delete.
- Course detail / editor: name/city/province, holes (par 3/4/5, stroke index), tees (label/rating/slope), SI validation, par presets, auto-number SI.
- Players library: add / edit / delete guest players (name + handicap).
- Friends: username search (debounced, 2-char min), send / accept / decline / cancel requests, remove friend, friend profile modal (head-to-head + recent rounds).

**Testable scenarios**
- Course search filters list; clear button resets.
- Add course → navigates to detail to complete it.
- SI validation box appears for duplicate/missing/out-of-range stroke indexes.
- TeesEditor shows duplicate-label warning.
- Player add/edit/delete updates the list; delete confirms first.
- Friend request lifecycle: none → requested → friends; each state shows the right button.
- Friend profile modal loads head-to-head record.

---

## 8. Feed, media & memories

**Files:** `FeedScreen.js`, `GalleryScreen.js`, `CommentsSheet.js`, `Capture*/Attach*/Batch*Sheet.js`, `MediaLightbox.js`, `Memories*` components

**Features**
- Feed: All / Mine / Friends filter chips, round cards + photo carousels, emoji reactions (👏🔥⛳😂 + custom), comments, pull-to-refresh.
- Card tap: round card → `RoundSummary`, photo card → `Gallery`.
- Media capture: camera photo / video (≤20s) / library multi-select.
- Attach sheets: single (`AttachMediaSheet`) and batch (`BatchAttachSheet`) with round/hole/caption/uploader.
- Gallery: round carousel, hole strip, kind chips, masonry grid, lightbox, Instagram-style stories viewer.
- Sharing: `ShareableCard` leaderboard image (web canvas / native view-shot); lightbox per-item share.

**Testable scenarios**
- Feed filter chips switch the visible item set.
- Empty / error / partial / loading states each render correctly.
- Emoji reaction is optimistic and reverts on failure.
- Comments sheet: add, delete own comment, error state.
- Capture menu → attach sheet → save enqueues media.
- Gallery filters (hole + kind) narrow the grid; lightbox opens at tapped item.
- Stories viewer auto-advances photos, plays videos, swipe-down dismisses.

---

## 9. Stats, profile, notifications & sync

**Files:** `StatsScreen.js`, `MyStatsScreen.js`, `ProfileScreen.js`, `NotificationsScreen.js`, `components/mystats/*`, `SyncStatusSheet.js`

**Features**
- **Stats** (tournament): 6 tabs (Overview, Players, Holes, Pairs, My Shots, Shame), Strokes↔Points toggle, round-scope chips, drill-down detail sheets, share highlight cards.
- **My Stats** (personal): round selector modal, 5 tabs (Report Card, Overview, Form, Breakdown, Shots), strokes-gained, target-handicap picker.
- **Profile**: avatar upload, username/display name/handicap/target handicap, avatar color, light/dark, "show running points" toggle, personal stats grid, Friends link, sign out, unsaved-changes guard.
- **Notifications**: inbox list, auto-mark-read on open, tap routes to linked screen, push registration.
- **Offline sync**: queue + worker, LWW merge, `SyncStatusSheet` status (idle/syncing/pending/error), conflict log, retry.

**Testable scenarios**
- Stats tab visibility depends on scoring mode / shot data (Pairs, My Shots conditional).
- Strokes↔Points toggle and round-scope chips change displayed metrics.
- My Stats round selector check/uncheck updates "X of Y rounds".
- Profile: invalid username blocks save; unsaved-changes back triggers confirm.
- Profile save persists; "username taken" alert on conflict.
- Notifications: opening clears unread badge; tap routes to Friends/Home/RoundSummary.
- SyncStatusSheet shows pending count + conflict log; retry button on error/pending.

---

## 10. Recommended test-build sequence

1. **Add `testID`s** to the controls named in this document — start with
   primary actions (nav buttons, submit/save buttons, list cards, score
   steppers, tab buttons). This unblocks every later test.
2. **Smoke tests** — each of the 34 screens renders without crashing
   (mock stores/Supabase). Cheap, catches the most regressions.
3. **Critical-path integration tests** (highest value):
   - Setup wizard → start game → enter scores → finish round.
   - Add / remove player mid-round + scoring-mode fallback.
   - Official: create → party board → join → score → resolve discrepancy.
   - Auth gate + join-link routing.
4. **Feature-area tests** — sections 4–9 above, scenario by scenario.
5. **Web E2E** — `npm run build:web` + Playwright for true end-to-end on the
   highest-traffic flows once testIDs exist.

## 11. Coverage gaps & risks to target
- `ScorecardScreen` and `HomeScreen` are large monoliths with heavy
  mode-branching — highest regression risk, prioritise their UI tests.
- Mixed-language UI strings (Spanish in media/sync, English elsewhere) make
  text-based selectors unreliable — another reason to add `testID`s.
- Offline sync / merge conflict paths are logic-tested but have no UI test.
- Official-mode discrepancy and marker-chain flows are complex and untested at the UI level.
