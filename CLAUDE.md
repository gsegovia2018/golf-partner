# CLAUDE.md

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

## Domain Concepts

- **Tournament:** A multi-round event across different courses.
- **Round:** One 18-hole game on a course with assigned partners.
- **Official tournament:** A managed tournament with admin controls, a
  shared leaderboard, and invite tokens — see the `official*` store modules.
- **Handicap:** Each player has a handicap index; each hole has a stroke
  index (SI) that determines extra shots.
- **Stableford scoring:** Points per hole = 2 + (par − strokes + extra shots);
  target is maximizing points. Logic in `store/scoring.js` / `statsEngine.js`.
- **Partner selection:** Two pairs per round, randomized each day — unless
  the `fixedTeams` setting keeps the same teams all tournament.
- **Scramble modes:** `scramblepairs` / `scramble3v1` / `scramble4` — one
  ball per team, scored Stableford off a team handicap (USGA Appendix C
  allowances), stored under the team captain (`pair[0]`). Excluded from
  personal stats.
- **Pairs match play:** `pairsmatchplay` — two pairs, two cross-team 1v1
  duels (index-matched within `round.pairs`), 2 points per hole (1 per duel,
  ½ each on a halve), net via stroke index.

## Architecture Notes

- Course data model: `Course → Holes[]`, each hole with `par`,
  `strokeIndex`, and optional `distance`; courses also carry tee sets.
- `src/store/` holds domain logic (scoring, stats, sync, official mode);
  `src/screens/` holds UI. Keep domain logic in stores, not screens.
- Some screens are large monoliths (`ScorecardScreen`, `StatsScreen`) —
  prefer extracting components/hooks over growing them further.
- Plans and design specs are tracked under `docs/superpowers/`.
