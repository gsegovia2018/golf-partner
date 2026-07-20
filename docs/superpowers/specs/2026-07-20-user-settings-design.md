# Per-User App Settings — Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Let every player tailor the app to how they play: GPS on/off (with a tee-distance
map mode), configurable stat tracking with clear "what you lose" messaging, plus
units, haptics, theme, keep-awake, no-spoilers, auto-advance, and notification
preferences. Settings follow the user across devices.

## Decisions made during brainstorming

- **Sync scope:** per-user, synced via Supabase profile (theme stays device-local).
- **Stat config granularity:** five group toggles, not per-stat or presets.
- **V1 scope:** GPS toggle, stat groups, units (m/yd), haptics, system theme,
  keep screen awake, notification preferences, no-spoilers mode, auto-advance hole.
  Default scoring mode was considered and cut.
- **UI placement:** dedicated Settings screen reached from ProfileScreen.
- **Storage:** `settings jsonb` column on `profiles` (Approach A) — not a
  dedicated table, not local-only.

## 1. Architecture & storage

- Migration: `alter table profiles add column settings jsonb not null default '{}'`.
  Existing RLS already restricts writes to the owner; no new policies.
- New `src/store/settingsStore.js` — single source of truth.
  - `DEFAULT_SETTINGS` lives in code. Effective settings =
    `{ ...DEFAULT_SETTINGS, ...profile.settings }` (shallow merge per top-level
    key; nested objects like `statGroups` merge key-wise). Missing keys always
    fall back to defaults, so adding a future setting is a code-only change and
    old app versions never break.
  - **Load:** AsyncStorage mirror (`@golf_settings`) read at startup for instant
    availability; the profile fetch then overwrites it (server wins on load).
  - **Save:** write-through — update in-memory + AsyncStorage immediately, then
    upsert the `settings` column via `profileStore.upsertProfile`. If the upsert
    fails (offline), a dirty flag re-pushes on next launch. No conflict
    machinery: settings are single-owner and low-stakes.
- `useSettings()` hook (React context wrapping the store) for reactive access
  in screens/components.
- **Legacy pref migration:** on first load, import
  `@scorecard_show_running_score` into the settings object, then treat the new
  store as canonical. `@scorecard_shot_detail_collapsed` stays as ephemeral UI
  state in `prefs.js` (not a synced setting).
- **Theme:** stays in `ThemeContext` / `@golf_theme_mode` (device-local by
  design — a shared device shouldn't inherit another player's theme), but gains
  a `system` option and is displayed inside the Settings screen.

## 2. Settings catalog (v1)

| Key | Type | Default | Section |
|---|---|---|---|
| `gpsEnabled` | bool | `true` | Round |
| `keepAwake` | bool | `true` | Round |
| `autoAdvanceHole` | bool | `false` | Round |
| `haptics` | bool | `true` | Round |
| `noSpoilers` | bool | `false` | Round |
| `showRunningScore` | bool | `true` (migrated) | Round |
| `statGroups.putting` | bool | `true` | Stats tracking |
| `statGroups.teeShot` | bool | `true` | Stats tracking |
| `statGroups.approach` | bool | `true` | Stats tracking |
| `statGroups.shortGame` | bool | `true` | Stats tracking |
| `statGroups.penalties` | bool | `true` | Stats tracking |
| `units` | `'meters' \| 'yards'` | `'meters'` | Display |
| theme (`light/dark/system`) | device-local | `system` | Display |
| `notifications.scores` | bool | `true` | Notifications |
| `notifications.invites` | bool | `true` | Notifications |
| `notifications.media` | bool | `true` | Notifications |

## 3. GPS off → tee-distance mode

When `gpsEnabled` is `false`:

- `useGpsDistances` never calls `requestForegroundPermissionsAsync` and starts
  no position watcher. It returns distances computed from the hole's tee point
  with a `source: 'tee'` field (vs `'gps'`).
- `HoleDistanceBlock` renders a "FROM TEE" variant — same center/front/back +
  hazards layout, labeled so the player knows it is not their position.
- The flyover uses the existing tee-anchor path in `flyoverModel.anchorFor()`
  and draws no player dot.

**Unified source resolution** (shared with the pending "player far from
course" feature, spec `2026-07-20-scorecard-tee-distance-fallback-design.md`):

1. GPS disabled by setting → `tee`
2. GPS unavailable / permission denied → `tee` (if geometry exists)
3. GPS live but > 1 km from the hole → `tee`
4. Otherwise → `gps`

One rendering path (`source` field) covers both features.

## 4. Stat group toggles

| Group off | Hidden inputs (`DEFAULT_SHOT` keys) | Lost downstream stats |
|---|---|---|
| Putting | `putts`, `firstPuttBucket` | Putting averages, 3-putt rate, **GIR** (derived from putts), SG Putting |
| Tee shot | `teeClub`, `drive`, `driveLie`, `driveDistBucket` | Fairways hit, driving distance, SG Off-the-Tee |
| Approach | `approachBucket`, `approachResult`, `approachLie` | Approach breakdown, SG Approach |
| Short game | `sandShots`, `recoveryOutcome` | Sand saves, up-and-downs, SG Around-Green |
| Penalties | `teePenalties`, `otherPenalties` | Penalty count, SG Penalties |

- `ShotDetailPanel` hides the rows of disabled groups. With all five groups
  off, the panel and its collapse toggle disappear entirely.
- The stroke-budget cap operates over whichever counters remain visible.
- `statsEngine` needs no correctness changes — it already gates on data
  presence (`hasAnyDetail`, per-field guards). Stats/SG screens show
  "not tracked" empty states for missing categories, and the SG total labels
  itself partial when categories are absent.
- Each switch row in Settings shows its "you'll lose …" line (from the table
  above) as the subtitle.

## 5. Settings screen

- New `SettingsScreen` registered in the stack, opened from a gear row at the
  top of ProfileScreen.
- Four sections: **Round & GPS**, **Stats tracking**, **Display**,
  **Notifications**. Switch rows with subtitles; theme as the existing tile
  picker extended to light/dark/system; units as a two-segment control.
- The theme tiles and running-points switch move here from ProfileScreen.
  ProfileScreen keeps identity concerns only (name, handicap, avatar, friends,
  sign out).

## 6. Wiring per setting

- **Haptics:** the `haptic()` helper in `ScorecardScreen` checks the setting;
  off = no-op.
- **Keep awake:** `expo-keep-awake` `useKeepAwake()` gated by the setting,
  active only while `ScorecardScreen` is mounted.
- **Auto-advance hole:** when the last empty score on the current hole is
  filled, the pager advances after a short delay (with haptic if enabled).
  Default off — current behavior preserved.
- **No-spoilers:** hides running-points chips and mid-round leaderboard views
  while the player's round is unfinished; standings reveal on completion.
  Overrides `showRunningScore` while active.
- **Units:** display-only conversion — all storage stays meters forever.
  `formatDistance(meters, units)` in `src/lib/units.js`, used by
  `HoleDistanceBlock`, flyover HUD, shot-detail bucket labels, and
  driving-distance stat displays. Bucket boundaries remain meter-defined;
  labels show converted values.
- **Notifications:** category rides on the push payload; the `send-push` edge
  function reads the recipient's `profiles.settings` and skips muted
  categories — muted pushes are never delivered, not merely hidden client-side.

## 7. Testing

- `settingsStore`: defaults, merge with partial server blobs, legacy
  running-score key migration, offline dirty-flag re-push.
- `useGpsDistances`: source resolution matrix (disabled / denied / far / live).
- `ShotDetailPanel`: group hiding, all-off panel removal, stroke budget with
  hidden counters.
- `formatDistance`: meters/yards formatting and rounding.
- `send-push`: category filtering against settings blobs (present, missing,
  malformed).
- Runtime verification via the Expo web app (`verify` skill): Settings screen
  round-trip, GPS-off scorecard showing FROM TEE, stat-group hiding in the
  shot panel.
