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

- **Tournament:** A multi-round event across different courses. Each round
  may override the tournament's default scoring mode (`round.scoringMode`);
  mixed-mode tournaments rank by Stableford totals.
- **Round:** One game on a course with assigned partners — 18 holes, or 9 on
  a nine-hole layout. Hole count drives the handicap maths (`holeCountOf`):
  a 9-hole round halves the index for its course handicap and allocates
  strokes over SI 1-9. 9-hole rounds do not feed the handicap index.
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

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
