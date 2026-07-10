# Weekend tournament round modes + duel randomizer — design

**Date:** 2026-07-11
**Status:** Approved (user confirmed approach in chat)

## Goal

1. The live "Weekend Golf" tournament (id `1783584580051`) must have:
   round 1 Best Ball / Worst Ball, round 2 Pairs Match Play, round 3
   Scramble — Pairs, with the pairs **Marcos + Noé vs Guille + Alex** on
   all three rounds (user correction: the stored Marcos + Guille vs
   Alex + Noé pairing is wrong, including on the fully-scored round 1 —
   its best-ball result should recompute under the corrected pairs).
2. Add a UI to **randomize** the Pairs Match Play duel draw and then
   **edit** it, reachable for round 2.
3. Round 2 → ••• → Scoring Mode must show "Pairs Match Play", not the
   tournament default Best Ball.

## Current state (verified against Supabase, 2026-07-11)

- Tournament settings: `scoringMode: 'bestball'`, `fixedTeams: true`,
  `manualTeams: true`. Players: Marcos (hcp 17), Alex (12), Guille (15),
  Noé (17).
- Round `r0` (Golf Torrequebrada): no mode override → bestball ✓; fully
  scored; pairs wrong.
- Round `r1` (Mijas Golf Los Lagos): `scoringMode: 'pairsmatchplay'`
  already set (stamped `1783724025246`); pairs wrong; not revealed.
- Round `r2` (Santa Clara): no override → falls back to bestball ✗;
  pairs wrong; not revealed.
- The per-round sheet already reads the round's effective mode via
  `roundScoringMode()` (`HomeScreen.js:1950`), so item 3 is a data +
  stale-local-cache issue, not a code bug. The gear "Tournament
  Settings" sheet intentionally shows the tournament-wide default.
- `EditTeamsScreen` already renders the two duels for `pairsmatchplay`
  with a deterministic "Swap Matchups" button (`swapDuelOrder` in
  `lib/teamEditing.js`) and tap-to-swap player editing. There is no
  randomize action.

## Part A — data fix (direct Supabase update)

Update the tournament row's `data` JSON with the service-role key,
mirroring exactly what the app's `mutate()` would write:

- `rounds.r0.pairs`, `rounds.r1.pairs`, `rounds.r2.pairs` →
  `[[Marcos, Noé], [Guille, Alex]]`, reusing the tournament's existing
  embedded player objects verbatim (id, name, gender, user_id, handicap,
  avatar_url).
- `rounds.r2.scoringMode` → `'scramblepairs'`.
- `rounds.r1.scoringMode` stays `'pairsmatchplay'` (already correct).
- Stamp `_meta` for each changed path (`rounds.rX.pairs`,
  `rounds.r2.scoringMode`) with the current epoch-ms timestamp. This is
  what makes the offline-first LWW merge (`merge.js`) on every device
  accept the fix instead of resurrecting the old pairs — existing stamps
  top out at `1783724025246`, so any current timestamp wins.
- Do NOT touch `revealed` (pairs.set normally reveals, but the
  fixed-teams propagation precedent uses `reveal: false`; rounds 2–3
  keep their reveal moment).
- With the corrected pairs, round 2's index-matched duels default to
  Marcos vs Guille and Noé vs Alex until the user randomizes/edits.

Verification: re-fetch the row and assert modes, pairs, and stamps.

## Part B — duel randomizer UI (EditTeamsScreen)

With fixed 2×2 pairs there are exactly two possible duel draws
(index-matched or crossed). Design:

- `lib/teamEditing.js`: add `randomizeDuelOrder(pairs)` — returns
  `pairs` with the second pair's order randomly kept or swapped
  (50/50 via `Math.random`), reusing `swapDuelOrder` for the swap arm.
  Pure function aside from the coin flip; tests inject/mock randomness.
- `EditTeamsScreen`: in the existing DUELS card (pairsmatchplay only),
  add a "Randomize Matchups" button beside "Swap Matchups". It sets
  `hasLocalEdits` and updates local pairs state, same as the swap. Save
  path is unchanged (`pairs.set` mutation; fixed-teams propagation of
  pair membership to later rounds is already handled and is unaffected
  by within-pair order, which only matters to the duel draw of the
  pairsmatchplay round itself).
- Present the duels as slightly more prominent rows (existing
  `duelText` style is fine to keep; visual polish minimal — this is a
  button addition, not a redesign).
- Entry point (unchanged): round tab → ••• → Edit Teams (round must be
  revealed; unrevealed rounds go through Reveal Teams first).

Out of scope: an animated "match draw" reveal ceremony (user chose the
lightweight option).

## Part C — verification

- Unit: tests for `randomizeDuelOrder` (both outcomes reachable, pair
  membership never changes, idempotent shape).
- Existing suite (`npm test`) and lint must stay green; ignore failures
  originating in `.claude/worktrees` / `.worktrees` copies.
- Runtime (verify skill, QA account + replica tournament since the QA
  user is not a member of the real one): set a round to Pairs Match
  Play, confirm the per-round ••• sheet shows "Pairs Match Play" while
  another round shows its own mode, and exercise Randomize/Swap/edit in
  Edit Teams.
- Live data: assert via REST that the real tournament's three rounds
  read bestball / pairsmatchplay / scramblepairs with the corrected
  pairs.

## Error handling

- Data fix is a single-row PATCH; on any verification mismatch, re-read
  and re-apply rather than partially retrying paths.
- The randomize button mutates only local component state until Save —
  cancel/back discards, matching existing screen behavior.
