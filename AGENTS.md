# AGENTS.md

## Project Overview

Golf scoring app for a group of friends playing weekend multi-round tournaments.
Core features:
- Track Stableford scores per round per player
- Random partner pairing each round
- Handicap-aware scoring (extra shots from each hole's stroke index)
- Casual games and "Official" tournaments with admin/leaderboard tooling
- Course library, player stats, media/memories, push notifications
- Multi-platform: web + Android from a single codebase

## Stack

- **App:** Expo SDK 54, React Native 0.81, React 19. Web target via
  `react-native-web` — one codebase ships web + Android.
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions.
  Schema lives in `supabase/migrations/` (~20 migrations). One edge
  function: `supabase/functions/send-push` (push notifications).
- **Auth:** Google OAuth via `expo-auth-session`; session handled in
  `src/context/AuthContext.js`.
- **Navigation:** `@react-navigation` — stack + bottom-tabs.
- **Local state:** Plain JS store modules in `src/store/` (no Redux).
  `AsyncStorage` for persistence.
- **Offline-first:** Local writes queue and replay against Supabase —
  see `store/syncQueue.js`, `syncWorker.js`, `merge.js`, `conflictLabels.js`.
- **Config:** `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  via `.env` (see `.env.example`).

## Commands

- `npm start` / `npm run android` / `npm run ios` / `npm run web` — dev
- `npm test` — Jest (jest-expo); ~330 tests, store/lib well-covered
- `npm run lint` — ESLint 9 flat config (`eslint.config.mjs`); CI-blocking
- `npm run build:web` — static web export
- EAS Android builds should use the `preview-arm64` profile by default:
  `eas build --platform android --profile preview-arm64`. Do not use the
  `production` profile unless explicitly requested.

## Domain Concepts

- **Tournament:** A multi-round event across different courses.
- **Round:** One 18-hole game on a course with assigned partners.
- **Official tournament:** A managed tournament with admin controls, a
  shared leaderboard, and invite tokens — see the `official*` store modules.
- **Handicap:** Each player has a handicap index; each hole has a stroke
  index (SI) that determines extra shots.
- **Stableford scoring:** Points per hole = 2 + (par − strokes + extra shots);
  target is maximizing points. Logic in `store/scoring.js` / `statsEngine.js`.
- **Partner selection:** Two pairs per round, randomized each day.

## Architecture Notes

- Course data model: `Course → Holes[]`, each hole with `par`,
  `strokeIndex`, and optional `distance`; courses also carry tee sets.
- `src/store/` holds domain logic (scoring, stats, sync, official mode);
  `src/screens/` holds UI. Keep domain logic in stores, not screens.
- Swing analyzer: local Expo module `modules/golf-swing` (Kotlin: MediaCodec
  decode, MediaPipe pose, pass-2 `extractCheckpoints`, Camera2 high-speed
  capture); pure JS analysis in `src/swing/`; screens `Swing*Screen.js`.
  Plan: `docs/superpowers/plans/2026-10-11-swing-analyzer.md`.
- Swing `apiVersion` gate: native `API_VERSION` (`GolfSwingModule.kt`) vs JS
  `REQUIRED_API_VERSION` (`src/swing/native.js`), currently 2. Bump both on any
  contract change.
- Swing native change ⇒ new APK (`preview-arm64`); JS-only ⇒ OTA. Dev build
  `GOLF_APP_VARIANT=dev` (`com.golfpartner.app.dev`, scheme `golf-dev`) must
  never be set for `eas build` or `eas update`.
- Swing videos and analysis never leave the phone.
- Some screens are large monoliths (`ScorecardScreen`, `StatsScreen`) —
  prefer extracting components/hooks over growing them further.
- Plans and design specs are tracked under `docs/superpowers/`.
