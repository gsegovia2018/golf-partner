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
- **Offline-first, two layers.** *Scores* run on the cards engine
  (`src/engine/`): taps write a private per-hole draft, leaving the hole
  publishes it as one packet into my own `scorer_cards` row, and a SQL
  trigger projects the settled cells into `game_scores`. Only my device
  writes my card, so a card is retried forever and never merged.
  *Setup* (roster, rounds, teams, courses, notes) still queues mutations and
  replays them against the normalized `game_*` tables — see
  `store/syncQueue.js` / `syncWorker.js`.
- **Config:** `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  via `.env` (see `.env.example`).

## Commands

- `npm start` / `npm run android` / `npm run ios` / `npm run web` — dev
- `npm test` — Jest (jest-expo); ~330 tests, store/lib well-covered
- `npm run lint` — ESLint 9 flat config (`eslint.config.mjs`); CI-blocking
- `npm run build:web` — static web export

### Shipping to Android

- `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview -m "…"`
  — push JS/asset changes over the air to installed preview builds. No
  rebuild, no reinstall. The env var is NOT optional: the installed APK comes
  from the `preview-arm64` profile, whose env makes `app.config.js` add the
  `expo-build-properties` plugin, and that plugin is part of the runtime
  fingerprint. Without it the update publishes under a different runtime and
  is never offered to anyone. Check before publishing:
  `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli fingerprint:compare <apk fingerprint hash>`
  (hash from `eas build:view <id> --json` → `fingerprint.hash`).
- `npx eas-cli build -p android --profile preview-arm64` — a new internal
  APK. Needed only when the **native** side changes: a new Expo plugin, a
  permission, an SDK or native dependency bump.

Local dev builds (`GOLF_APP_VARIANT=dev`, e.g. `GOLF_APP_VARIANT=dev
GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx expo prebuild -p android --clean`, then
`./gradlew :app:assembleRelease`) install next to the real app: package
`com.golfpartner.app.dev`, name "… Dev", URL scheme `golf-dev`, no https
intent filters and no google-services (no push). Install them with
`adb install --user 0` and never over `com.golfpartner.app`. **Never set
`GOLF_APP_VARIANT` for `eas build` or `eas update`**: it changes the package,
scheme and fingerprint, so an update would go to a runtime no installed APK has,
and a build would ship an app that can't receive the real app's links or push.

The universal `preview` profile has no `GOLF_ANDROID_BUILD_ARCHS` on purpose:
it is the any-ABI fallback (MediaPipe ships all four ABIs, so the swing
analyzer works on it), and it is its own runtime — the arm64 OTA command above
never reaches it. It is much bigger than `preview-arm64`: MediaPipe alone adds
~48 MB of native libraries for the three extra ABIs.

`runtimeVersion` uses the `fingerprint` policy, so the two stay honest with
each other — any native change alters the fingerprint, and an update built
against it simply is not offered to binaries that cannot run it. Builds
subscribe to a channel (`preview`/`production`, set per profile in
`eas.json`); `--branch` on an update is what that channel points at.

`fallbackToCacheTimeout: 0` is deliberate: the app launches from cache and
fetches in the background, applying on the next start. Rounds get played on
courses with no signal, and a launch that blocks on the network is worse
than a day-old bundle.

### Wear OS companion

The watch app is a native Kotlin/Compose module in `wear/` (same package,
`com.golfpartner.app`). `plugins/withWearApp.js` copies it to `android/wear`
at prebuild and adds `include ':wear'`; the phone build never compiles it.

- **Build on EAS:** `npx eas-cli build -p android --profile wear-preview` —
  runs `:wear:assembleRelease` and signs with the project keystore (read from
  the `credentials.json` EAS writes; the build fails rather than ship a
  debug-signed watch APK).
- **Build locally:** `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx expo prebuild -p android --no-install --clean`,
  then `cd android && ./gradlew :wear:assembleDebug :wear:testDebugUnitTest`.
  Edit `wear/`, never `android/wear` (overwritten on every prebuild).
- **Same key or no pairing.** The Data Layer only connects phone and watch
  apps with the same package *and* signing key: install EAS phone + EAS watch,
  or local phone + local watch (both use `android/app/debug.keystore`) —
  never mix.
- **Install on a Galaxy Watch** (Play doesn't offer internal APKs to the
  watch): on the watch, Settings → About watch → Software → tap *Software
  version* 5× for Developer options; enable *ADB debugging* and *Wireless
  debugging*; join the same Wi-Fi as the computer. *Wireless debugging → Pair
  new device* shows a code and port: `adb pair <ip>:<pair-port> <code>`, then
  `adb connect <ip>:<port>` (the port on the Wireless debugging screen), then
  `adb -s <ip>:<port> install -r <watch>.apk`.
- **Fingerprint:** `wear/` is not a fingerprint source, so watch-only changes
  don't move the phone runtime (OTA keeps reaching the phone APK) — the
  protocol `v` field guards phone/watch skew instead. `eas.json` and
  `plugins/withWearApp.js` *are* sources: any edit to either (even a
  watch-only profile tweak) needs a new phone APK. Run `fingerprint:compare`
  without a generated `android/` folder — its mere presence changes the hash.

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
- `src/store/` holds domain logic (scoring, stats, setup sync, official
  mode); `src/screens/` holds UI. Keep domain logic in stores, not screens.
- `src/engine/` is the scoring data layer: `cards.js` derives every cell view
  (mine / peers' / agreed / disputed) purely, `publish.js` writes a hole,
  `store/` persists and replicates, `hooks/useRoundCards.js` is the
  scorecard's single source of truth. Agreements are anchored to card
  versions, so an edit re-opens exactly the disputes it should. The plan is
  `docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md`.
- SG baselines (`store/strokesGainedBaseline.js`) are per-handicap,
  engine-consistent tables **generated** from the typical-golfer model in
  `scripts/lib/sgBaselineModel.js` (`node scripts/sgBaselineTables.mjs`); edit
  the model, regenerate, never hand-edit `BASELINES`; bump `SG_BASELINE_VERSION`
  when numbers move.
- GPS course maps (`golf_*` tables) load in two tiers: the `golf_course`
  index at launch, a course's holes/hazards/greens on demand
  (`ensureCourseGeometry` / `hooks/useCourseGeometry.js`), cached per
  course. Never fetch every course's rows at once — PostgREST caps at 1000.
  Spanish maps come from OSM via `scripts/importOsmGeometry.mjs`; seed new
  ones with `seedCourseGeometry.mjs --new-only` (a plain seed wipes in-app
  pin/green edits).
- Background GPS: `src/lib/roundTracking.js` runs an Android foreground
  location service (`expo-task-manager`) while a live scorecard is open,
  with a persistent notification driven by `hooks/useRoundTracking.js`;
  `useGpsDistances` seeds from its feed. Native change — needs an APK
  build. Spec: `docs/superpowers/specs/2026-09-11-background-gps-tracking-design.md`.
- Swing analyzer: local Expo module `modules/golf-swing` (Kotlin: MediaCodec
  decode, MediaPipe pose in `PoseAnalyzer.kt`, pass-2 `extractCheckpoints` in
  `Checkpoints.kt`, Camera2 high-speed capture in `camera/`); pure JS analysis
  in `src/swing/`; screens `Swing*Screen.js`. Plan: `docs/superpowers/plans/2026-10-11-swing-analyzer.md`.
- Swing `apiVersion` gate: native `API_VERSION` (`GolfSwingModule.kt`, currently 5)
  vs JS `REQUIRED_API_VERSION` (`src/swing/native.js`, currently 2): a binary below
  REQUIRED shows "Update the app" instead of crashing. Bump native on every contract
  change; raise REQUIRED only when the bundle cannot work without the new methods.
  Additive features get their own gate instead: `CAPTURE_API_VERSION` 2 (recording)
  and `PROXY_API_VERSION` 3 (pass-2 scrub proxies, D28), and `CLUB_MODEL_API_VERSION`
  4 (learned club detector, `clubModelSupport()`) and `CLUB_ONDEMAND_API_VERSION` 5
  (`detectClub` on a chosen frame, `clubOnDemandSupport()`), so older binaries still
  analyse and mark.
- Club model (plan `2026-10-16-swing-club-detector.md`): the `club_yolox_tiny_v1.tflite`
  asset and the `litert` dependency are native (APK, `preview-arm64`). Pass 2 runs it on
  the 13 checkpoint frames, GPU delegate with CPU fallback (`timings.clubMs ≤ 2000`;
  1.5 s on a Pixel 8 Pro). The model ships fp32: LiteRT 1.4 on CPU splits an fp16-weight graph. The lab that trains and
  exports it is `tools/swing-lab` (`train_yolox.py`, `export_tflite.py`, `eval_yolo.py`).
  On the marking canvas a frame the golfer chooses gets a proposal from `detectClub`
  (warm detector, still JPEG; plan `2026-10-16-swing-club-on-demand.md`).
- Swing native change ⇒ new APK (`preview-arm64`); JS-only ⇒ OTA. Dev build
  `GOLF_APP_VARIANT=dev` (`com.golfpartner.app.dev`, scheme `golf-dev`) is
  never set for `eas build`/`eas update` (see "Shipping to Android").
- Swing videos and analysis never leave the phone; the only planned exit is
  the explicit training-data export (plan §7.3).
- Some screens are large monoliths (`ScorecardScreen`) — prefer extracting
  components/hooks over growing them further.
- Game Stats (`StatsScreen`) is a thin shell: tabs Summary · Rounds · Players ·
  Rivals live in `src/components/gamestats/`, their data shaping in
  `src/store/gameStatsView.js` (pure, tested). Plan:
  `docs/superpowers/plans/2026-10-15-game-stats-redesign.md`. A game with
  one played round (`singleRoundIndex`) gets Summary · Scorecard · Players ·
  Rivals and no per-round wording (a guard test in `StatsScreen.test.js`
  enforces it); one Strokes | Points switch (gross by default) drives the
  score mixes and the scorecards. A game with one player (`isSoloGame`) has
  no tabs: the player's page is the screen.
- One read-only scorecard for played rounds: `components/scorecard/ShotScorecard`
  (model: `store/scorecardView.js` `scorecardModel`). A score row per player,
  gross strokes tinted by result or points, handicap strokes as dots; players
  who logged shots open putts / tee / green rows (mine starts open); one
  player is a ledger. Used by the finished game / tournament round cards on
  the game screen, the stats Scorecard / Rounds tab and Players' hole by hole.
  The live, editable scorecard stays `GridView`'s `ScorecardTable`.
- Plans and design specs are tracked under `docs/superpowers/`.
- i18n (Spanish/English): pure-JS layer in `src/i18n/`, never a native module
  (OTA). User-facing strings go through `useT()`/`t()` and the catalogues in
  `src/i18n/locales/`; conventions and the Spanish golf glossary are in `docs/i18n.md`.

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
