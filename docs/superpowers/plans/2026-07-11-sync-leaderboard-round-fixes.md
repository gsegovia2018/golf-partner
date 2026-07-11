# Fix: cross-device sync, stale leaderboard, wrong home round number

**Date:** 2026-07-11
**Branch:** feature/sync-round-leaderboard-fixes (to be created)

## Symptoms (reported)

1. Two devices show different scores for the same round even after one finished it; data doesn't sync between devices.
2. Home screen shows "Round 1/3" after round 2 is finished; flickers between 1/3 and 2/3.
3. Tournament leaderboard only shows Stableford points from round 1 even though round 2 is finished (pairs "hint" visible, but the total omits round 2).

## Root causes (verified in code)

### RC-A — `currentRound` never propagates across devices (drives #2 and #3)
- `currentRound` is written in exactly one place: `NextRoundScreen.handleConfirm` → `updated.currentRound = roundIndex; await saveTournament(updated)` (`NextRoundScreen.js:279-281`).
- `saveTournament` → `persistRemote` does a raw full-blob upsert (`tournamentStore.js:463-472, 519-526`). It is **not** in `metaPathFor` (`mutate.js:8-97`), so no `_meta['currentRound']` timestamp is ever stamped.
- On a peer pull, `mergeTournaments` has no `_meta` for `currentRound` on either side → `lTs=0, rTs=0` → **tie goes to local** (`merge.js:108`) → the peer keeps its own `currentRound` (usually `0`). The reveal's advance never lands on other phones.
- The mixed-mode leaderboard gate `isRoundPlayed` requires `index <= tournament.currentRound` (`scoring.js:380-383`). With `currentRound` stuck at 0 on the viewing device, round 2 (index 1) is dropped from `tournamentStablefordLeaderboard` (`scoring.js:741-769`). → symptom #3.
- Home pager/round labels read `tournament.currentRound` directly (`HomeScreen.js:65, 408, 424, 1864-1866`). Stale value → wrong round number. → symptom #2 (partial).

### RC-B — Home "X/3" card reads two disagreeing sources (drives #2 flicker)
- The "Round X/3" text counts completed rounds via `isRoundComplete` over whatever `loadAllTournamentsWithFallback()` returns (`HomeScreen.js:1266-1311`).
- Online it returns **remote-only, un-merged** rows (`loadAllTournaments`, `tournamentStore.js:185-248`); on any transient fetch failure / offline moment it returns **local-merged** blobs (`_loadCachedFullList`, `tournamentStore.js:252-278`). Remote lags local (batched score sync), so `played` flips 1 ↔ 2 as the many `reload()` triggers fire. Sort keys also differ between the two sources.

### RC-C — no cross-device pull + raw upserts clobber peer scores (drives #1)
- No Supabase realtime and no polling. The scorecard pulls peers' scores only when its own sync queue is non-empty (`syncWorker.js:98-102`); a device just watching never re-fetches. Scorecard has no focus/interval pull.
- Raw `saveTournament` upserts (RC-A path + `HomeScreen.js:506/528/549/688`, `SetupScreen.js:459`, `EditTournamentScreen.js:158`, `PlayersScreen.js:282`) bypass `mergeTournaments` and can overwrite peer score cells already on the server.
- (By design, kept: score cells are "always-mine" in `merge.js` — two devices editing the *same* cell surface a conflict marker rather than auto-converging. User opted NOT to change this.)

## Fixes

### Fix 1 — `currentRound` is monotonic in merge (RC-A, retroactive)
`currentRound` is a progression high-water mark; it only moves forward. In `mergeTournaments`, after the LWW loop, set:
```js
merged.currentRound = Math.max(local.currentRound ?? 0, remote.currentRound ?? 0);
```
This propagates the advance to every device on the next pull, cannot be defeated by tie-to-local, needs no new mutation type, and **heals the current tournament** (peer at 0 pulls remote 1 → becomes 1). Does not affect `isRoundPlayed` unit tests (they pass synthetic tournaments straight to the gate).

### Fix 2 — `saveTournament` merges before pushing (RC-C, stop clobbering)
Change `saveTournament(tournament)` so that when online it does: `saveLocal(local)` → fetch remote → `mergeTournaments(local, remote).merged` → `saveLocal(merged)` → `persistRemote(merged)`; on any fetch/merge error fall back to `persistRemote(local)` (today's behavior). Mirrors `syncWorker.drainTournament` (`syncWorker.js:63-95`). always-mine keeps the caller's own edits while preserving peer score cells. Combined with Fix 1, `currentRound` survives (max).

### Fix 3 — Home list is local-inclusive (RC-B, stop flicker)
In `loadAllTournaments`, after building `result` from remote rows, merge each row with its local blob before returning:
```js
const merged = await Promise.all(result.map(async (t) => {
  const local = await readLocal(t.id);
  return local ? { ...mergeTournaments(local, t).merged, _role: t._role } : t;
}));
```
Return/`writeIndex` the merged list. Also change `_loadCachedFullList`'s sort to `byCreatedAtDesc` so online and offline lists order identically. Now `isRoundComplete` sees the same (local-inclusive) data whichever source answers → stable `2/3`.

### Fix 4 — live pull on the scorecard (RC-C, converge peers)
In `ScorecardScreen`, add a `useFocusEffect` and a periodic interval (every ~20s while online and screen focused) that calls `refreshTournamentFromRemote(tournamentId)` (already exists: awaited fetch → merge → `saveLocal` → emit, `tournamentStore.js:406-414`). Guard against overlapping/in-flight refreshes. `saveLocal`'s `_emitChange` drives the existing subscription to re-render with peers' newly pulled scores. Use `routeTournamentId ?? tournament.id`; skip for official mode (RPC path).

## Task breakdown (TDD; each task: failing test → implement → `npm test` + `npm run lint`)

- **T1 — merge monotonic `currentRound`** (`src/store/merge.js`, `src/store/__tests__/merge.test.js`)
  - RED: merge(local `currentRound:0`, remote `currentRound:1`) → merged `currentRound:1`; local 2 vs remote 1 → 2; missing on both → 0.
- **T2 — `saveTournament` merge-before-push** (`src/store/tournamentStore.js`, its `__tests__`)
  - RED: with a remote blob carrying a peer score cell the local copy lacks, `saveTournament(local)` persists a blob that still contains the peer cell (no clobber); fetch error falls back to pushing local.
- **T3 — Home list local-inclusive + sort** (`src/store/tournamentStore.js`, `__tests__`)
  - RED: `loadAllTournaments` with remote row missing a locally-complete round → returned entry has the local scores (round complete); offline+online lists share order.
- **T4 — scorecard live pull** (`src/screens/ScorecardScreen.js`; test via existing screen test harness if present, else a store-level test for the refresh wiring)
  - RED: focus + interval invoke `refreshTournamentFromRemote`; no overlap; cleaned up on blur/unmount.

## Verification
- `npm test` green (update the 3–4 existing merge/scoring/store tests only if a change is intentional; none should need semantic changes).
- `npm run lint` clean.
- Runtime check via the `verify` skill (Expo web): finish round 2 in a mixed-mode tournament → leaderboard includes round 2; home shows 2/3 without flicker; a second browser context sees the scores after the pull interval.

## Out of scope (per user)
- Reworking the "always-mine" same-cell conflict policy / conflict-resolution UX.
- Supabase realtime subscriptions (polling/focus pull is sufficient for now).
