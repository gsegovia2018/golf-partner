# Scorecard cards engine: a from-scratch rebuild of casual-round scoring sync

**Date:** 2026-09-04
**Status:** Implemented on `feat/scorecard-cards-engine` (2026-09-05); production cutover = apply the two 20260905 migrations
**Rebuilds:** the scoring data layer and the scorecard screen's state handling. Replaces `scoreEntries.js`, the score half of `mutate.js` / `mutationWrites.js` / `syncWorker.js` / `realtimeSync.js`, `game_score_entries`, `game_score_resolutions`, `submit_game_score`, `resolve_game_score`, `recompute_game_score`, and the three-copy state inside `ScorecardScreen.js`.
**Keeps:** every presentational component, `scoring.js` maths, the normalized setup tables (`tournaments`, `game_players`, `game_rounds`) and their write RPCs with targeted fixes, official tournaments, feed, stats, media, shared board, notifications.

## 1. Required behaviour

Reference situation: four players, up to four phones scoring. Typically Marcos and Guille each keep a scorecard and mark any of the four players. Several games may be live at once on the same day.

| # | Situation | Required |
|---|---|---|
| R1 | Marcos enters his own score and stays on the hole. | Guille sees nothing. |
| R2 | Marcos enters everyone's score and stays on the hole. | Guille sees nothing. |
| R3 | Marcos enters scores and goes to the next hole. Guille is still on that hole. | Guille sees Marcos's entries as **unverified** for every player Marcos marked. |
| R4 | Both entered all scores and both moved on. Marcos said 5, Guille said 4 for the same player. | Both phones alert. The alert shows who said what. One agreed value clears it everywhere. |
| R5 | No internet, or unstable internet. | Every player's name and score is visible on both phones. |
| R6 | Unstable internet. | Game points in every mode follow **my** scorecard. |
| R7 | Marcos taps Next hole. | All his scores for that hole are sent as one unit. Never a partial hole. |
| R8 | No internet. | Scores are sent when internet returns. Nothing is lost. |
| R9 | Both tap Finish. | Both scorecards must match. If not, one discrepancy per hole that disagrees. |

Rules that make the table consistent:

- **Publication rule.** A hole is published only when the scorer leaves it: Next hole, Go to hole, or Finish. Backgrounding, going back to Home, or losing the connection never publishes. A hole is published as one packet containing every entry the scorer made on it. Editing an already published hole re-publishes it, as one packet, when the scorer leaves it again.
- **Blank rule.** A scorer who did not mark a player on a hole has no opinion on that cell. It never conflicts and never counts as agreement. It shows on their phone as another scorer's unverified value. At Finish it is listed for information and does not block.
- **Offline is expected.** Courses lose coverage often. Nothing on the render path touches the network.

## 2. Why the current design cannot deliver this

It publishes every tap, stores one settled number per cell chosen by whichever write reached the server last, and replaces the phone's copy with the server's on every refresh. R1, R2, and R7 fail by construction; R6 fails whenever a peer's value wins the server race; R5 and R8 fail whenever a queued write is dropped as "permanent". The scorecard screen keeps three copies of the state (server, blob, React) agreeing by hand. The rebuild removes the need for agreement: nobody merges a score.

## 3. The model: one card per scorer, a private draft, and version-anchored agreements

```
authorId     stable per device, generated once (deviceId.js), never tied to auth
draft        my unpublished entries for the hole I am on: local only, never sent
myCard       my published card for a round: only this device writes it
peerCards    the other scorers' published cards, cached locally
resolutions  agreed values, each anchored to the card versions it resolved
```

- **Only I write my card.** The card row is keyed by `(tournament, round, author)`. Replication of my card is an upsert of my own row. It cannot conflict with anyone and is safe to retry forever.
- **A published hole is one version of my card.** Every hole in the card carries a version counter `v` that increments on each publication of that hole. Publishing is atomic because it is one row write (R7).
- **A peer cannot change my card.** Their entries are in their row. The screen shows mine, then theirs greyed where I have nothing (R3, R6).
- **Discrepancies are a comparison of cards**, computed on the phone. The alert is identical whether a peer's card arrived live or after two hours offline (R4, R8).
- **An agreement points at the exact card versions it settled.** If any of those scorers re-publishes that hole, the agreement lapses and the discrepancy reappears. No clocks are involved.

### 3.1 Identity

- `authorId` is the persisted device id. It survives auth expiry (R5 offline identity).
- Each card carries `scorer: { playerId, userId }` set when the device identifies itself. `scorerKey = userId ?? authorId`; two devices signed into the same account fold into one scorer, newest hole version wins per hole.
- "Who said what" resolves `scorerKey` to the roster player's name, else the profile display name, else "Another phone".

### 3.2 Data shapes

```
card = {
  scorer: { playerId, userId },
  holes: {
    [hole]: { v, entries: { [playerId]: strokes }, shots: { [playerId]: detail }, ts }
  }
}

resolution = {
  roundId, playerId, hole, value, by: scorerKey, ts,
  basis: { [scorerKey]: v }     // the card versions of every scorer who marked the cell
}

draft[roundId][hole] = { entries, shots, dirty }
```

Local storage per tournament: `@cards:<tid>:draft`, `@cards:<tid>:mine:<roundId>` (plus `pending: true` while unsent), `@cards:<tid>:peer:<roundId>:<author>`, `@cards:<tid>:resolutions`, `@cards:<tid>:meta` (last pull time).

### 3.3 Derived views

Pure functions in `src/engine/cards.js`, memoised on `(cards, resolutions, draft)`.

**`cell(round, player, hole)`**

```
mine        = draft entry if hole has a draft, else my published entry, else none
others      = one published entry per other scorer who marked the cell
resolution  = resolutions[player][hole] if valid (see below)
shown       = resolution ?? mine ?? (others.length ? most recently published of others : null)
status      = 'resolved' | 'mine' | 'agreed' | 'unverified' | 'discrepancy' | 'empty'
discrepancy = no valid resolution and ≥ 2 distinct non-null values across {my PUBLISHED entry, others}
```

My draft never participates in a discrepancy. It is private until published (R1, R2).

**Resolution validity.** Valid iff for every scorer who currently marks the cell, `basis[scorerKey] === card.holes[hole].v`. A scorer re-publishing the hole, or a fourth scorer marking it for the first time, invalidates it.

**`myPoints(round)`** from `shown` in every mode (R6). A draft wins over everything; `mine` wins over peers; only a valid resolution overrides mine.

**`settledCell`** = valid resolution, else the value if every scorer who marked it agrees, else null. **`settledPoints(round)`** with `provisional = true` when any cell is null because of a discrepancy or is marked by one scorer only. Feeds the leaderboard, Home, and the server projection.

**`discrepancies(round)`** grouped by hole, each row `{ playerId, values: [{ scorerKey, name, value, ts }] }`, up to four values (R4).

**`unverified(round)`** = cells with `status === 'unverified'` for the ghost rendering (R3).

### 3.4 When the alert fires

- **I leave a hole.** The draft is published: my card's hole gets `v + 1` and the row is marked pending. Recompute. Any cell on that hole where my published value disagrees with a peer's opens the sheet before the pager advances. If no peer has published that hole, nothing fires; it fires on their phone when they publish, and on mine when their card arrives.
- **A peer's card or a resolution arrives**, live or after reconnect. Recompute. Newly disagreeing cells open the sheet as one batched list, titled by number of holes.
- **Finish** (R9). Publishes the current hole, pushes and pulls once if online. If `discrepancies(round)` is non-empty, the finish sheet lists every disputed hole and Finish stays blocked. Cells marked by one scorer only are listed under "only Marcos marked" and do not block.
- **Agreeing** writes a resolution with the current `basis`. It clears the row on every phone as soon as it arrives.

## 4. Local store and replication

`src/engine/store/` (plain modules, injectable storage).

- `draftStore(tid)`: `get(roundId, hole)`, `set(...)`, `take(roundId, hole)`.
- `cardStore(tid)`: `myCard(roundId)`, `publishHole(roundId, hole, draft)` (bumps `v`, sets `pending`), `peerCards(roundId)`, `putPeerCard(row)`, `resolutions()`, `putResolution(row)`.
- `replicator` (one singleton, all tournaments):
  - **push**: for every tournament and round with a pending card, upsert the whole row. On success clear `pending`. Exponential backoff on any error. A rejected upsert stays pending and is shown in the sync sheet with the server's error and a Retry. Resolutions push the same way. Works across every live game, not just the open one.
  - **pull**: `select` the round's cards and resolutions for the open tournament on focus, on reconnect, and every 20 s while the scorecard is focused; for all cached live tournaments when Home loads.
  - **live**: one realtime channel per open tournament on `scorer_cards` and `score_resolutions`, filtered by tournament. A row event is `putPeerCard` / `putResolution`. My own echo is ignored by `author_id`.
  - **reconnect**: push, then pull, then one `synced` signal the screen uses to open the batched sheet.
- `useRoundCards(tid, roundId)`: `useSyncExternalStore` over an in-memory `{ myCard, peerCards, resolutions, draft }`. Every scorecard read comes from this one object. No React copy of scores, no dirty sets, no self-echo skipping.

## 5. Server

One migration.

```sql
create table scorer_cards (
  tournament_id text not null references tournaments(id) on delete cascade,
  round_id      text not null,
  author_id     text not null,
  card          jsonb not null,
  updated_at    timestamptz not null default now(),
  primary key (tournament_id, round_id, author_id)
);

create table score_resolutions (
  tournament_id text not null references tournaments(id) on delete cascade,
  round_id      text not null,
  player_id     text not null,
  hole          int  not null,
  value         int,
  resolved_by   text not null,
  basis         jsonb not null,
  resolved_at   timestamptz not null default now(),
  primary key (tournament_id, round_id, player_id, hole)
);
```

- **RLS**: select for tournament members and participants (existing predicates). Insert/update on `scorer_cards` for members, restricted to rows whose `author_id` matches the device the caller registered (same trust model as today's device author id). Upsert on `score_resolutions` for members.
- **Writes** go through plain PostgREST upserts; no RPC is needed for cards. `updated_at` is set by a trigger.
- **Projection.** A trigger on both tables calls `project_round_scores(tournament_id, round_id)`, which recomputes `game_scores` for that round with the `settledCell` rule in one SQL statement over the card rows and valid resolutions. `game_shot_details` is projected from the identifying scorer's own card. Feed, stats, shared board, notifications, Home list, `get_game_tournament`, and `get_my_game_tournaments` keep working unchanged.
- **Backfill.** `backfill_scorer_cards(p_tid)` builds one card per `(round, author)` from `game_score_entries` with `v = 1` per hole, and one resolution per `game_score_resolutions` row with `basis` set to those versions. Idempotent; runs once per casual tournament at cutover. Afterwards the old tables and RPCs are dropped.

## 6. Setup layer: retained, with four fixes

Roster, rounds, teams, courses, and handicaps stay on the normalized tables and existing RPCs. They are edited rarely, usually by one person, and last-writer-wins by server `updated_at` is acceptable there. The problems you saw came from the read path, not the tables:

1. **Stop replacing local setup while a scorecard is open.** The open tournament's setup is refreshed only on focus and on an explicit pull, and a refresh that changes roster, order, or teams shows a notice ("Guille changed the teams for round 2") instead of silently re-rendering rows.
2. **Persist identity once.** `meId` is written to local storage the first time it is derived and read from there afterwards; row order comes from the immutable server `pos` plus "me first" from that stored id. Auth expiry cannot reorder rows.
3. **Never install a nameless player.** A `game_players` realtime row without a body keeps the cached player's fields and patches identity columns only.
4. **Setup writes are never dropped silently.** A rejected setup write is listed in the sync sheet with its error and a Retry, the local value stays, and the next refresh does not erase it.

The version stamp (`updated_at`) rides along on every setup write so a real conflict dialog can be added later without a schema change. It is not built now.

## 7. Screens

- **`ScorecardScreen`** becomes thin: `useRoundCards`, `useDiscrepancies`, `useHoleNavigation`. A tap writes the draft. Leaving a hole calls `publishHole` and lets the discrepancy hook decide whether the sheet opens before the pager moves. `HoleView` / `HolePage` / `PlayerCard` / `GridView` / `RoundSummary` receive `cells` (with `status`) and `myPoints` instead of `scores` + `myScores` + `verifiedUpTo` + `conflictHoles`. Unverified cells render greyed with the scorer's name; a tap starts my own entry pre-filled with that value, accepted one cell at a time. Target under 600 lines.
- **Setup screens** unchanged except for the fixes in §6.
- **Home / History** read the projection plus the local cards for tournaments cached on this device, so offline Home shows full rosters, names, and points (R5).
- **Sync sheet**: unpublished holes ("hole 7 not sent yet, leave the hole to send"), pending cards per game, last sync time, any rejected write with its error and Retry.
- **Discrepancy sheet** is `ConflictWizardSheet` fed by `discrepancies(round)`: one row per player per hole, one chip per scorer (up to four) with name and value; tapping a chip writes the resolution.

## 8. Acceptance scenarios

Each is a Jest fixture against the engine and a two-phone script through the `verify` skill.

| # | Scenario | Expected |
|---|---|---|
| S1 | Marcos enters his score on hole 3, stays. | Guille's phone unchanged. No traffic for hole 3. (R1) |
| S2 | Marcos enters all four scores on hole 3, stays. | Same as S1. (R2) |
| S3 | Marcos taps Next. Guille still on hole 3 with no entries. | Guille sees four greyed values tagged "Marcos". His points unchanged. (R3) |
| S4 | Guille enters all four, taps Next. Alex: Marcos 5, Guille 4. | Both phones: "Hole 3, Alex: Marcos 5, Guille 4". Either agrees; both clear. (R4) |
| S5 | Guille offline holes 3 to 9. Reconnect. | His cards push; one sheet on each phone listing every disputed hole. Names and scores visible throughout. (R5, R8) |
| S6 | Best ball, unstable network. Marcos enters hole 5 for all. | His round summary reflects hole 5 immediately and never changes when Guille's card arrives, unless a resolution is agreed. (R6) |
| S7 | Marcos taps Next; the upsert fails mid-flight. | Server has the whole card or the previous one. Retry sends the whole card. Never a partial hole. (R7) |
| S8 | Marcos edits hole 2 after publishing, leaves hole 2. | Hole 2 gets `v = 2` on both phones. An existing agreement on hole 2 lapses and the row reappears if values still differ. |
| S9 | Both tap Finish. Holes 6 and 14 disagree. | Two discrepancies, Finish blocked until agreed, then both cards identical. (R9) |
| S10 | Auth expires offline mid-round. | Row order, scorer names, points unchanged. |
| S11 | Same card pushed twice; realtime row received twice; app killed mid-push. | State identical. |
| S12 | Guille adds a player and reorders while Marcos scores offline. | Marcos's rows do not move until the change arrives with a notice; names never blank. |
| S13 | Four scorers. Three say 4, one says 5 for Alex on hole 11. | One row, four chips. Any scorer agreeing clears it. A fifth publication of hole 11 by any of the four reopens it. |
| S14 | Two live games on one phone. Score game A offline, open game B, score, reconnect. | Both games' cards push independently. Neither game's state touches the other. |
| S15 | Backfill a live 2026-08 tournament. | Cards plus resolutions produce the same settled cells as the current blob. |

## 9. Phases

Model per the routing table in the global instructions.

| Phase | Deliverable | Model | Verify |
|---|---|---|---|
| 0 | Engine: card and resolution shapes frozen, draft and publication rules, `cell` / validity / `myPoints` / `settledCell` / `discrepancies` as pure JS in `src/engine/`, fixtures for S1 to S14. No app wiring. | Opus writes, Fable reviews | `npm test` on the fixtures |
| 1 | Draft store, card store, replicator (push all games, pull, live, reconnect), `useRoundCards`. Against a mocked Supabase. | Opus | Unit tests; S5, S7, S11, S14 in an offline harness |
| 2 | Server: two tables, RLS, projection trigger, backfill. Projection parity against the JS `settledCell` on the fixtures. | Opus, DB review at top tier | `supabase test db`, parity suite |
| 3 | Scorecard rewired on the engine. Existing components receive `cells` and `myPoints`. | Sonnet, Opus review | S1 to S4, S6, S8, S9, S10, S13 on devices |
| 4 | Setup layer fixes from §6. Sync sheet. | Sonnet | S12 |
| 5 | Cutover in one release: backfill every casual tournament, ship, delete `scoreEntries.js`, the score paths in the old sync modules and their tests, drop `game_score_entries` / `game_score_resolutions` and the three score RPCs. | Haiku for deletions, Opus for the backfill run | S15 on production data; full suite green |

Phase 0 must not be rushed. Once the derived views and fixtures are right, the rest is wiring. There is no dual-engine period: finished tournaments only need the projection tables, which do not change.

## 10. Decisions

- **Publication on leaving the hole, not on tap.** Direct consequence of R1, R2, R7. The draft is the mechanism. Never on background.
- **One card per scorer instead of a merged document or an event log.** My card is mine; nobody else writes it, so there is nothing to merge and no clock to order. An event log would give the same guarantees with a fold, a Lamport clock, and a second fold in SQL; none of that is needed for four scorers and eighteen holes.
- **Agreements anchored to card versions, not timestamps.** Phones on a course disagree by minutes. A version anchor is exact and lapses precisely when it should.
- **No presence.** "Both moved past the hole" is the existence of both scorers' published holes. Works offline; makes the reconnect list exact.
- **Projection as a SQL trigger.** One statement over the card rows. Readers that never open the scorecard still see fresh settled scores. No second implementation to keep equal.
- **Setup tables retained.** Their bugs were read-path bugs. Rewriting them would cost more than it fixes.
- **Blank cells do not block Finish.** Listed for information.
- **Push spans all live games; live channel only for the open one.**

## 11. Out of scope

- Official tournaments (own data layer, unchanged).
- Media, feed, friends, notifications (readers of the projection only).
- A conflict dialog for setup edits (version stamp kept so it can be added later).

## 12. Follow-ups

Deliberately out of the implemented scope; each is a known gap, not a bug.

- ~~Setup-change notice on the scorecard (§6 fix 1, UI half).~~ Built
  2026-09-05: `src/screens/setupChangeNotice.js` signs roster/order, teams,
  course and handicaps; a change arriving while the scorecard is focused (and
  not dispatched by this screen) shows a five-second "… changed on another
  phone" banner. The baseline re-arms on every focus so this phone's own
  edits made on other screens are never announced.
- ~~Discrepancy sheet done state blocked the next alert.~~ Fixed 2026-09-05:
  mid-round and finish sheets close themselves when their last row is agreed
  (a leave prompt resumes the held navigation; the finish sheet continues the
  finish). The "all scores agreed" screen is no longer reachable.
- **The server projection does not fold two devices of one account.**
  `src/engine/cards.js` collapses them by `scorerKey` (newest hole version
  wins); `settled_round_cells` treats every `author_id` separately, so such a
  pair disagreeing with itself projects as disputed (NULL) rather than as the
  later value. The phones' own view is authoritative during play, so this only
  shows in Home/feed/stats. Fold in SQL if it ever bites.
- **A reset is not authoritative over an offline peer.** `resetRound` deletes
  the round's `scorer_cards` / `score_resolutions` rows, but a peer who was
  offline holding a card for that round re-upserts it whole on reconnect and
  its entries reappear as unverified values. Nothing on one phone can revoke a
  row on a phone the server has not heard from; resetting again after that
  card lands clears it for good.
