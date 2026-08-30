# Friend Player Stats — implementation plan

Tap a friend in the Friends screen → push a `PlayerStats` screen showing that
friend's game: a **Summary** tab (new), then the existing **Form / Handicap /
Breakdown** tab bodies read-only, and a **Together** tab (rounds you both
played). Replaces the current `FriendProfileSheet` bottom sheet.

Design reference: mocks in the 2026-08-30 session (`friend-summary-v2`), with
two later corrections: the hero's average differential is the **last 5 rated
rounds** (same window as `form.metrics.avgDifferential.recent`), and the index
shown is the **app-computed** one (`computeHandicapIndex`), never the profile
field.

## Data facts (verified against production 2026-08-30)

- Friends' full tournament docs are already fetched by the feed
  (`fetchFriendTournaments` in `feedStore.js`, friend-aware RLS). No backend
  change needed.
- `collectMyRounds(tournaments, userId, displayName)` resolves the player by
  `user_id`, then by display name, then "only player in a game". For a
  **friend** the fallbacks are wrong: on Marcos's device they matched Noé to
  14 single-player games that were Marcos's own, producing phantom "shared"
  rounds with identical scores. Friend resolution must be **`user_id` only**.
- 9-hole and unfinished rounds have no differential (`roundDifferential`
  returns null); Stableford points still exist for them.

## Build items

### 1 — Store layer (pure JS, tests required) — `src/store/friendStats.js`

**1a.** `personalStats.collectMyRounds(tournaments, userId, displayName, opts)` —
add `opts.strictUserId` (default false). When true, `resolveMyPlayer` returns
only the `user_id` match (no name / solo-game fallback). No other behaviour
change; existing tests must stay green.

**1b.** `feedStore.buildFeed` — add `tournaments: all` to the returned object
(it already holds `all`; also add it to the early-return error object as
`[]`). This is the friend's tournament source.

**1c.** `friendStore.loadFriendStatsData(friend)` (replaces `getFriendProfile`,
which becomes dead — delete it):

```js
// → { me, myRounds, friendRounds, tournaments }
const { me, tournaments } = await buildFeed({ useCache: true, includeMedia: false });
const friendRounds = collectMyRounds(tournaments, friend.userId, null, { strictUserId: true });
const myRounds     = collectMyRounds(tournaments, me, null, { strictUserId: true });
```

**1d.** `friendStats.js` exports:

```js
sharedRounds(myRounds, friendRounds)
// → [{ key, tournamentId, tournamentName, courseName, date, roundIndex,
//      mePoints, themPoints, meHoles, themHoles, partners:boolean, scoringMode }]
// Joined on MyRound.key; both completed (isComplete) ; skip if
// myRound.playerId === friendRound.playerId (defensive). chronological.
// partners: round.pairs contains a pair with both playerIds.

headToHead(shared)
// → { n, wins, losses, ties, avgMe, avgThem, last5: ['W'|'L'|'T'...], partnerRounds }
// wins = rounds where mePoints > themPoints.

buildFriendSummary(friendRounds, { n = 5 } = {})
// Uses resolveSelection(friendRounds) → computeMyStats(selected, { n, targetHandicap: 0 })
// and computeHandicapIndex / handicapIndexSeries / roundDifferential.
// → {
//   roundCount,                      // selected.length
//   ratedCount,                      // rounds with a differential
//   recentDiff: { value, count },    // mean of the last `n` differentials (null if count === 0)
//   index: { value, move3m },        // computeHandicapIndex().index; move3m = value − series value
//                                    //   at/just before (now − 90 days), null if none
//   gap,                             // recentDiff.value − index.value (null if either null)
//   bestDiff: { value, courseName, date } | null,
//   bestRound: { points, handicap, courseName, date } | null,   // from careerMilestones
//   form: { recent, history, delta, chip },  // form.metrics avgDifferential; chip ∈ 'hot'|'up'|'steady'|'down'
//   series: [{ key, value, courseName, date }],  // last 10 differentials, chronological
//   strengths: [{ label, avgPoints }], weaknesses: [...],   // top 3 each, sample ≥ 30 holes
//   baseline,                        // ranking.baseline
//   scoreMix: { eagles, birdies, pars, bogeys, doubles, worse, total },
//   homeCourse: { courseName, rounds, avgPoints, bestPoints, avgDifferential, ratedCount } | null,
//   milestones: { longestParStreak, bestNine },
//   stats,                           // the full computeMyStats result (tabs reuse it)
//   selected,                        // the selected MyRounds (HandicapTab reuses them)
// }

friendVerdict(summary, { name, gender })
// Deterministic sentence, ≤ 20 words, DESCRIPTIVE not prescriptive:
//   level  from gap:  ≤ 0.5 "playing right to the {index} the app rates {obj}"
//                     ≤ 2.5 "a touch over the {index} the app rates {obj}"
//                     else  "averaging {gap} strokes over the {index} the app rates {obj}"
//   trait  = strengths ∪ weaknesses entry with max |deviation| (sample ≥ 30):
//     "Tee shot on the fairway"        → "deadly from the fairway"
//     "Tee shot missing the fairway"   → "lives and dies by the tee shot"
//     "Opening 3 holes"                → "fast out of the gate"
//     "Closing 3 holes"                → "a closer"
//     "Par 5s"                         → "a par-5 specialist"
//     "Par 3s" (weak)                  → "par 3s are the leak"
//     "After a tee penalty"            → "one penalty ruins a hole"
//     "Hard holes"                     → "thrives on the hard holes"
//     "Back nine" (weak)               → "fades after the turn"
//     "Front nine" (weak)              → "slow to get going"
//     anything else                    → omit the trait clause
//   form   from form.delta (recent − history, lower is better):
//     ≤ −3 "on {pos} hottest stretch yet" · ≤ −1 "trending the right way"
//     |Δ| < 1 "holding steady" · ≥ +1 "grinding through a rough patch"
//   pronouns: gender 'male' → his/him, 'female' → her/her, else their/them.
//   Shape: "{Level}, {trait} — and {form}." (no trait → "{Level} — and {form}.")
//   Returns null when ratedCount < 3.
```

Tests (`src/store/__tests__/friendStats.test.js`): strict resolver ignores
name/solo fallbacks; `sharedRounds` skips same-player joins and incomplete
rounds; `headToHead` counts and last5; `buildFriendSummary` recentDiff uses
last 5 only, `gap`, `bestDiff` picks the min, `homeCourse` = most-played;
`friendVerdict` for the three gap bands, trait mapping, pronouns, null under
3 rated rounds.

### 2 — UI

**2a.** `HandicapTab` — add `readOnly` prop: when true hide the Apply button
block, the target picker entry point, and the exclusion toggles (already
conditional on `onToggleExcluded`); the "you"-voiced note copy may stay.

**2b.** `src/components/playerstats/SummaryTab.js` — renders `summary` +
`verdict` + `h2h` as in the mock: hero (verdict, Avg differential · last N,
App index · 3-mo move, Best diff) → Form card (recent diff, chip, 10-point
sparkline with dashed index line, filled dots ≤ index; use
`TrendLineChart`/`chartGeometry` if they fit, else a small inline SVG) →
Strengths/Watch-outs → Net score mix (`ScoreMixBar`) → Home course →
Bests 2×2 tiles → You-vs-{name} card with link to Together → footer
"Based on N rounds you can see". Tap on hero numbers calls `onInfo(key)` with
`scoreDifferential` / existing explainer keys.

**2c.** `src/components/playerstats/TogetherTab.js` — two tiles (rounds
together, points edge) + list of shared rounds, two score columns, winner
tinted `accent.light`, ties untinted, "partners" tag when true; tap →
`navigation.navigate('Scorecard', { tournamentId, roundIndex })` (check the
existing Scorecard params in `App.js`/`HomeScreen` and match them).

**2d.** `src/screens/PlayerStatsScreen.js` — route param `{ friend }`
(the object from `listFriends`: userId, username, displayName, avatarColor,
avatarUrl, handicap, gender?). Header: back, name, avatar (move
`PersonAvatar` out of `FriendsScreen` into `src/components/ui/PersonAvatar.js`
and import it in both), `@username · HCP {index} · target …` only if known.
Tabs: Summary · Form · Handicap · Breakdown · Together — plain horizontal
pill row (do **not** copy MyStats' animated pager). Loads via
`loadFriendStatsData`; loading / error / "no rounds yet" states. `StatDetailSheet`
wired to `onInfo` like MyStats. FormTab gets `stats`, local `n` state,
`onInfo`. BreakdownTab gets `stats`, `onInfo`, `onSelectCourse` **undefined**.
HandicapTab gets `myRounds=selected`, `profileHandicap=friend.handicap`,
`readOnly`. Footer line on every tab.

**2e.** `FriendsScreen` — row tap → `navigation.navigate('PlayerStats', { friend: p })`;
delete `FriendProfileSheet` + its styles + the `getFriendProfile` import.
`App.js` — register `PlayerStats` with the horizontal iOS interpolator like
`Scorecard`.

### 3 — Verify

`npm test`, `npm run lint`, then runtime check on web: Friends → tap Noé →
all five tabs render; Together shows 13 rounds for Marcos↔Noé.
