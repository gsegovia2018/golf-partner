# New-User Onboarding — Design

**Date:** 2026-07-22
**Status:** Approved (mockups: claude.ai artifact "Onboarding — two directions", Option B chosen)

## Summary

Expand the existing first-run gate into a three-part onboarding:

1. **Required-info screen** (blocking, extends `OnboardingScreen`): username, display
   name, gender.
2. **Coach-marks tour, chapter 1** — four spotlight stops on Home, first landing.
3. **Coach-marks tour, chapter 2** — four spotlight stops on the scorecard, first
   time one opens.

No concept teaching (Stableford theory, pairing rules) anywhere — the tour points
at real controls only; new users learn the game from the group. No settings are
asked during onboarding; defaults stay exactly as defined today.

## 1. Required-info gate

Same gate as today (`App.js` renders `OnboardingScreen` while `profile.username`
is missing; anonymous invite-link guests skip it). Changes to
`src/screens/OnboardingScreen.js`:

- **Username** — keep the pre-fill from the email local-part. Replace the
  save-time availability alert with a **live inline check**: debounced call to
  `isUsernameAvailable` (`src/store/profileStore.js:45`) once the input is
  format-valid; hint line shows "✓ Available — friends find you as @…" (accent
  green) or "That username is taken" (destructive). The 23505 race backstop on
  save stays.
- **Display name** — new field between username and gender, pre-filled with
  `profile.displayName` (the DB trigger already writes the email local-part).
  Required, non-empty after trim, max 40 chars. Hint: "How you appear on
  scorecards and leaderboards." (Display name is the profile→player join key.)
- **Gender** — unchanged (Male/Female pills, tee-rating hint, required).
- One **Continue** button saves all three via `upsertProfile`, then `onDone()`.
- Subtitle copy becomes "Three quick things before you tee off."

## 2. Coach-marks tour

### Interaction pattern (both chapters)

- Dimmed scrim over the real screen; the target element is highlighted by a
  gold ring (`semantic.winner`) cut out of the scrim.
- An explainer card sits near the target: overline "TOUR · N OF 4", bold title,
  one sentence of body copy, footer row with **Skip tour** (left, muted) and
  **Next** (right, accent button; "Done" on the last stop).
- Tapping **the spotlighted element itself** also advances (and performs
  nothing else — the tap is consumed by the overlay).
- Targets are measured at runtime (refs + `measureInWindow`/`onLayout`) — no
  hardcoded coordinates. If a target cannot be measured (layout changed,
  element absent), that stop is skipped silently; if no stops are measurable
  the tour marks itself complete without showing.
- Respects reduced motion: scrim/card fade only, no ring pulse or movement.
- Web + Android: pure RN `View`/`Pressable` overlay, no native dependencies.

### Chapter 1 — Home, first landing after the gate

| # | Target (in `FloatingTabBar`) | Copy (title / body) |
|---|------------------------------|---------------------|
| 1 | Center Play button | **Everything starts here** / Tap the flag to start a round or a weekend tournament — pairs and scoring are set up for you. |
| 2 | Stats tab | **Your game, measured** / Handicap evolution, strokes gained and a coach that tells you what to fix first. |
| 3 | Feed tab | **The group's memories** / Photos and moments from every round land here. |
| 4 | Profile tab | **Your player card** / Avatar, handicap, friends — and Settings, where you can tune the defaults. |

History tab intentionally omitted.

### Chapter 2 — first scorecard open

Fires once, the first time a live scorecard is shown (own round or one a friend
added the user to). Same pattern, own skip, own flag.

| # | Target (in `ScorecardScreen`) | Copy (title / body) |
|---|-------------------------------|---------------------|
| 1 | Score entry controls | **Score the hole** / Tap your strokes — points are worked out for you, extra handicap shots included. |
| 2 | Header distance block | **Distances, live** / GPS distances to front, middle and back of the green — tee distances when GPS is off. |
| 3 | Map / flyover control | **See the hole** / Swipe up for the flyover map and plan the shot. |
| 4 | Hole navigation | **Move through the round** / Swipe or tap to change holes; the running points strip keeps the match in view. |

Copy stays operational — no scoring theory.

### Persistence & replay

- Flags live in per-user settings (`profiles.settings` jsonb via
  `settingsStore`): `tour: { home: string|null, scorecard: string|null }`
  (ISO timestamp when completed or skipped; default `null`). Cross-device by
  construction, same merge path as every other setting.
- Skip and Done both stamp the chapter's flag.
- **Settings** gains a "Replay app tour" row (DISPLAY section) that resets both
  flags to `null`; chapter 1 re-arms next time Home mounts, chapter 2 next
  scorecard open.
- Anonymous guests (no profile) never see either chapter.

## 3. Settings defaults (decision, no UI)

Unchanged from `DEFAULT_APP_SETTINGS` (`src/store/settingsStore.js:14`):
GPS on, keep-awake on, haptics on, running score shown, auto-advance off,
no-spoilers off, all stat groups on, meters, all notifications on; theme
system (ThemeContext). Onboarding neither asks about nor displays them; the
only mention is chapter 1 stop 4's pointer to Settings.

## Architecture

- **`src/components/tour/CoachMarks.js`** — presentational overlay: takes
  `steps` (`[{ measure, title, body }]`), current index, `onNext`, `onSkip`.
  Renders scrim, ring, card. No domain knowledge.
- **`src/store/tourStore.js`** (or a `useTour` hook) — reads/writes the
  `settings.tour` flags through `settingsStore`; exposes
  `shouldShowTour(chapter)` and `completeTour(chapter)`.
- **Wiring:** `HomeScreen` arms chapter 1 (targets exposed by
  `FloatingTabBar` via ref registration); `ScorecardScreen` arms chapter 2.
  Both check `shouldShowTour` on mount/focus.
- `OnboardingScreen` changes are self-contained.

## Error handling

- Username check failure (offline): fall back to save-time validation exactly
  as today — never block Continue on the availability probe.
- Profile save failure: existing alert paths unchanged.
- Tour flag write failure: tour still dismisses locally this session
  (settingsStore already queues offline writes).

## Testing

- `OnboardingScreen`: display-name validation, prefill, availability states,
  save payload includes all three fields (extend existing tests).
- `tourStore`: flag read/write, replay reset, guest (no profile) → never show.
- `CoachMarks`: renders steps, Next/Skip/target-tap advance & complete,
  unmeasurable step skipped, zero-measurable steps auto-completes.
- Manual smoke on web (`verify` skill): fresh account → gate → chapter 1 →
  start round → chapter 2.

## Out of scope

- Handicap entry during onboarding (Profile handles it).
- Concept/education content (Stableford, pairing) — explicitly declined.
- Coach marks anywhere beyond the eight stops above.
- Any change to settings defaults.
