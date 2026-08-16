# Shareable live leaderboard link + round share card

Growth feature: a read-only web page anyone can open **without an account** that
shows a tournament's live standings, plus a branded round-summary image card
that's one tap to send to WhatsApp. Every share of either is a demo of the app
sent to exactly the right audience (other golf groups' group chats).

Scope decision: **Phase 1 targets casual tournaments** (`kind='casual'`, the
sync-v2 `game_*` tables behind `get_game_tournament`) — that's what the group
actually plays, so it's where the real share moments are. Official mode gets
the same treatment in a follow-up phase (its data lives in its own
`tournament_*` tables and needs a different RPC).

## Existing infrastructure (reused, not built)

- **Web deploy**: `golf-partner.vercel.app`, Vercel Git integration, SPA
  rewrite in `vercel.json`. Deep-link `prefixes` and path routing already in
  `App.js:338-360`.
- **Pre-session rendering precedent**: `matchesJoinLink()` + the `!session`
  branch (`App.js:127-136`, `220-227`) already render
  `JoinTournamentLinkScreen` with no login. The public board follows the same
  pattern.
- **Anon access model**: RLS is owner-only everywhere; unauthenticated reads
  go through SECURITY DEFINER RPCs granted `TO anon` (see
  `20260517000001_official_tournaments.sql:313-317` for the precedent). The
  anon key ships in the bundle by design; the RPC is the security boundary.
- **Scoring is pure client-side**: `roundLeaderboard` / recap logic in
  `src/lib/liveRoundSummary.js`, `src/store/scoring.js`,
  `leaderboardPlacement.js` all take a tournament-shaped object. If the RPC
  returns the same shape, the public page reuses them unchanged.
- **Image card pipeline ~80% built**: `src/components/ShareableCard.js` —
  `shareLeaderboard()` does RN-view `captureRef` on native, hand-drawn
  1200×800 Canvas 2D on web (html2canvas is flaky with RN-web flex, per its
  header comment), and `shareBlobOrDownload()`'s
  `navigator.share({files})` cascade is what surfaces WhatsApp on web.
  Off-screen capture-host pattern at `HomeScreen.js:1958`. All deps
  (`react-native-view-shot`, `expo-sharing`, `expo-file-system`) installed.
- **Recap data**: `buildRoundRecap()` (`src/screens/roundSummaryModel.js:20`)
  + `roundLeaderboard()` already assembled in `RoundSummaryScreen.js:107-120`
  (winner, margin, per-player totals, course name, live flag).
- **Token precedent**: client-generated `uuidv4()` magic tokens written by the
  owner under normal RLS (`officialAdmin.js:23`).

## Design

- **Link shape**: `https://golf-partner.vercel.app/board/<share_token>`.
- **Token**: new nullable `share_token text UNIQUE` column on `tournaments`.
  Null = sharing off (default). **Write path is an owner-only guarded RPC**,
  `set_share_token(p_id, p_token)` — NOT a plain RLS update. `tournaments_update`
  gates on `can_edit_tournament`, which is true for every editor member
  (including anonymous invite guests), so a direct update would let any guest
  publish or revoke the group's board; and a failed RLS update is a silent
  0-row no-op rather than an error. The RPC checks `is_tournament_owner` and
  RAISEs 42501, following 20260715000006. Client passes a client-generated
  uuid to enable/rotate and `null` to revoke; online-only action — same
  precedent as `attestCard` being unqueued.
- **Read path**: one SECURITY DEFINER RPC `get_shared_board(p_token)`
  granted `TO anon, authenticated`. Looks up the non-deleted tournament by
  token, calls `get_game_tournament(id)` and returns a **whitelisted**
  re-projection of it: tournament name/kind/createdAt/currentRound/finishedAt
  + three scoring settings, players (id + display name + handicap only),
  rounds (id, courseName, holes as number/par/SI, scoringMode, revealed,
  pairs re-thinned to ids, playerHandicaps/playerIndexes/playerTees/slope/
  courseRating, best/worst ball values, scores). Everything else — the real
  tournament id, `props`, player `user_id`/`avatar_url`/`gender`, round
  `notes` and `shotDetails`, anything future — is excluded by construction:
  every level is rebuilt with `jsonb_build_object`, nothing passes through.
- **Freshness**: the public page polls the RPC every 30 s (same idea as
  `useOfficialRound`'s 20 s poll; `tournaments` has no `updated_at`, so a
  full refetch is the mechanism). Scorers' devices already push to the
  server via the existing sync queue — no new write path.
- **Privacy posture**: the link is a bearer capability. It exposes first
  names/display names, handicaps, and scores — nothing else. Owner can
  rotate/revoke. Acceptable for a friends app; documented in the share UI
  ("anyone with the link can watch").

## Build items

Model tiers per the routing table: migration/RPC and auth-gating changes are
**Opus** (security-adjacent, expensive to unwind); screen/UI work is
**Sonnet**; trivia is **Haiku**. Review of items 1 and 3 stays top-tier.

1. **Migration + RPC** (`supabase/migrations/…_shared_board.sql`) — [Opus]
   `share_token` column + unique index; owner-guarded `set_share_token(text,
   text)` granted `TO authenticated`; `get_shared_board(text)` SECURITY
   DEFINER with the whitelist re-projection of `get_game_tournament`;
   `GRANT EXECUTE TO anon, authenticated`; `REVOKE` from public per house
   style. Verify the projection against the real sync-v2 shape (rounds carry
   `playerHandicaps`, scores keyed per hole — mirror what
   `tournamentRepo`/`merge.js` read, not what we wish were there).
   → verify: SQL smoke test with an anon-role `set role` in the Supabase SQL
   editor; wrong token returns empty, right token returns whitelisted keys
   only.
2. **Board model** (`src/store/sharedBoard.js` + tests) — [Sonnet]
   Pure module: map the RPC payload into the tournament/round shapes that
   `roundLeaderboard` and `leaderboardPlacement` expect; derive overall
   standings (Stableford totals across rounds, mirroring mixed-mode ranking
   in the existing stores); expose `{tournamentName, rounds[], overall[],
   liveRound}` for the screen. All logic here, not in the screen.
   → verify: Jest fixtures for a 2-round tournament incl. a live partial
   round and a scramble round (scramble scores live under the captain —
   reuse existing store fixtures).
3. **Public route + gating** (`App.js`) — [Opus]
   Add `SharedBoard: 'board/:token'` to `linking.config`; add
   `matchesBoardLink()` alongside `matchesJoinLink()` (web sync pathname
   check + native `getInitialURL`/listener, same as App.js:143-164); render
   `SharedBoardScreen` **before the session check** so it works logged-out
   *and* logged-in, but after the `passwordRecovery` early-return so
   recovery is unaffected.
   → verify: existing App gating tests still pass + new test for the board
   path in all three states (no session, session, recovery).
4. **`SharedBoardScreen`** (`src/screens/SharedBoardScreen.js`) — [Sonnet]
   Calls the RPC via `supabase.rpc`, 30 s poll while focused, pull-to-refresh.
   Renders: tournament name + LIVE badge when a round is in play, overall
   standings, per-round tabs with "thru N" for the live round, graceful
   states (bad/revoked token, tournament finished, offline). Footer CTA:
   "Scored with Golf Partner 🏌️ — golf-partner.vercel.app". Read-only, no
   auth UI anywhere.
   → verify: `verify` skill (Playwright vs Expo web) in a fresh
   incognito-like context — the page must render standings with zero auth.
5. **Owner share action** (`HomeScreen.js` settings sheet +
   `tournamentStore.js`) — [Sonnet]
   `enableBoardSharing(tournamentId)` / `rotateBoardToken` /
   `disableBoardSharing` in the store (all three wrap the `set_share_token`
   RPC — owner-only, online-only with a friendly offline notice; read the
   current token back with a normal owner SELECT on `tournaments`). Sheet gains "Share live board" → enables on
   first use, then `Share.share` with the WhatsApp-safe format already used
   at `HomeScreen.js:2075` (blank line before the URL so the tap target
   survives). Show the revoke/rotate affordance for the owner.
   → verify: Jest for the store functions; manual share on Android.
6. **Round share card** (`ShareableCard.js` + `RoundSummaryScreen.js`) —
   [Sonnet]
   `ShareableRoundCard` RN variant + matching Canvas 2D drawing (pay the
   existing duplication tax; keep 1200×800 to reuse `roundRect`/`truncate`
   helpers) + `shareRoundSummary({recap, ranked, courseName, roundLabel,
   tournamentName, theme, viewRef})` cloned from `shareLeaderboard` — same
   busy/cancel/notify handling, and **route web through
   `shareBlobOrDownload`** so `navigator.share({files})` offers WhatsApp
   (the StatDetailSheet download-only path is the wrong precedent). Card
   shows winner + podium + course + date + app branding; share text appends
   the board link when sharing is enabled, else the plain text fallback à la
   `leaderboardToText()`. Entry point: share icon on `RoundSummaryScreen`
   (off-screen capture host, `collapsable={false}`; mock
   `react-native-view-shot` in Jest as in `StatsScreen.test.js:13`).
   → verify: Jest render test; manual: native share sheet shows image; web
   Chrome-on-Android offers WhatsApp with the file.
7. **Fix the logged-out official-invite drop** (`App.js`,
   `JoinTournamentLinkScreen.js`) — [Opus]
   Found during research: `matchesJoinLink()` only matches
   `/join-tournament/…`, so a signed-out recipient of an official
   `/join/<token>` link lands on the bare `AuthScreen` and the token is lost
   — even though the token RPCs are already granted to `anon`. Extend the
   matcher and the pre-session chooser to cover `/join/:token` (guest path =
   `signInAnonymously` → `JoinOfficial` with the token preserved).
   → verify: gating test: signed-out `/join/<token>` reaches redeem flow.
8. **Global OG tags** (`public/index.html` for the web export) — [Haiku]
   `og:title` / `og:description` / `og:image` (app logo) so WhatsApp link
   previews of board links look intentional. Per-tournament previews need
   SSR — explicitly out of scope.
   → verify: `npm run build:web`, check tags in `dist/index.html`, paste a
   link into WhatsApp.

Ship order: 1 → 2 → 3 → 4 (the board is demoable end-to-end), then 5, 6 in
parallel, 7 and 8 anytime. Everything is OTA/web-deployable — no native
module, no EAS build required.

## Phase 1.5 — feed-style live board (added 2026-08-16 after user feedback)

The v1 board shipped functional but visually generic and thin. Rebuild the
same `/board/<token>` page as an on-brand live game feed: scores per player,
current hole, and photos.

Key facts from investigation:
- `tournament-media` bucket is PUBLIC with an unrestricted storage read
  policy — `getPublicUrl()` works logged-out. Anonymous viewers only lack
  *discovery* (`tournament_media` table RLS is authenticated-only). One anon
  RPC fixes that. Caveat: token rotation hides discovery, not already-copied
  CDN URLs.
- `buildFeed` is friends-scoped by construction — NOT reusable. But
  `FeedRoundCard`, `RoundStoriesRail`, `MemoryCard`, `MemoriesStoriesViewer`
  are pure props+theme and reusable on an unauthenticated screen.
- Per-player current hole = count of scored holes + 1 (FeedRoundCard's
  `onHoleFor`); derivable from the board payload's existing `scores`.

Build items:
1. **Media RPC** — [Opus] `get_shared_board_media(p_token)` SECURITY
   DEFINER, anon-granted, keyed on the same share_token: whitelist
   `{id, round_id, hole_index, kind, storage_path, thumb_path, duration_s,
   created_at}`. Deliberately EXCLUDES `uploader_id`, `uploader_label`, and
   `caption` (free text / identity stay private). Cap + order newest-first.
2. **Model** — [Sonnet] extend `src/store/sharedBoard.js`: emit
   FeedRoundCard-shaped `item`s per round (results[] with points, strokes,
   holes, vsPar, onHole; no avatars — stripped server-side), plus a media
   model (public URLs via `getPublicUrl`, grouped per round, stories list).
3. **Screen** — [Sonnet] rebuild SharedBoardScreen presentation: DEEP_GREEN
   hero per DESIGN.md ("green plays" — same surface as LiveRoundCard/
   leaderboard), Playfair title, gold/silver/bronze rank ceremony, reuse
   FeedRoundCard + RoundStoriesRail + MemoryCard strip + read-only
   MemoriesStoriesViewer. Media fetched once on load + manual refresh
   (separate RPC), board keeps its 30s poll.
4. Runtime verify on Expo web logged-out; ship.

## Phase 2 (separate plan when wanted)

- **Official tournaments**: `get_official_board(p_share_token)` aggregating
  roster + scores tournament-wide (today `get_round_state` scopes to the
  caller's party), reusing `buildLeaderboard` client-side; share token on
  the tournament row as above.
- Per-tournament OG previews (needs an edge function or SSR).
- Podium/share-card portrait variant (9:16) for WhatsApp Status.

## Known limits

- Link previews show generic app branding, not the tournament (no SSR).
- Board freshness = scorers' sync cadence + 30 s poll; offline scorers show
  stale "thru N", which the LIVE badge copy should soften ("last update…"
  is not available — no `updated_at` column — so don't promise one).
- Enabling/rotating sharing is online-only.
- Desktop browsers without `navigator.share({files})` fall back to
  downloading the card PNG (existing behavior, unchanged).
