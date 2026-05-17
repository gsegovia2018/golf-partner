# Unified Game Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every game and tournament, in every scoring mode, shows the same two cards — a green LEADERBOARD (mode-specific standings) and a white ROUND SCORES card (universal per-player Stableford performance with a progress bar).

**Architecture:** A new `RoundScoreboard` component replaces the four mode-specific round cards with one universal card (progress bar + per-player Stableford points / strokes / vs-par). The green LEADERBOARD card is shown for single-round games (not just tournaments) and gains a Match Play branch backed by a new pure `tournamentMatchPlayStandings` function. `GameOverviewCard` is retired.

**Tech Stack:** React Native 0.81, Expo 54, jest + jest-expo. No React Native Testing Library — pure logic is TDD'd; UI is verified by the jest suite staying green plus a manual + Playwright checklist.

**Spec:** `docs/superpowers/specs/2026-05-17-unified-game-layout-design.md`

---

## File Structure

- **`src/store/scoring.js`** (modify) — add `tournamentMatchPlayStandings`.
- **`src/store/__tests__/scoring.test.js`** (modify) — tests for it.
- **`src/store/tournamentStore.js`** (modify) — import + re-export `tournamentMatchPlayStandings`.
- **`src/screens/HomeScreen.js`** (modify) — extend `RankedRow`; add `RoundScoreboard`; delete the four mode round cards and `GameOverviewCard`; rewire `RoundPage`; show the LEADERBOARD card for games and add its Match Play branch.

---

## Task 1: `tournamentMatchPlayStandings` scoring function

**Files:**
- Modify: `src/store/scoring.js`
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing tests**

Add `tournamentMatchPlayStandings` to the test file's `import { ... } from '../scoring';` block. Append:

```js
describe('tournamentMatchPlayStandings', () => {
  const players = [
    { id: 'a', name: 'Alex', handicap: 0 },
    { id: 'b', name: 'Bo', handicap: 0 },
  ];
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  test('ranks the two players by holes won and reports the lead', () => {
    // Hole 1: a 4, b 5 → a wins. Hole 2: a 4, b 5 → a wins. a 2 holes, b 0.
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 } },
    };
    const t = { players, rounds: [round], currentRound: 0 };
    const r = tournamentMatchPlayStandings(t);
    expect(r.board.map((e) => [e.player.id, e.points])).toEqual([['a', 2], ['b', 0]]);
    expect(r.board[0].strokes).toBe(8);
    expect(r.status).toBe('Alex wins');
  });

  test('reports a running lead when holes remain', () => {
    // Hole 1 only: a wins. Hole 2 unscored → 1 hole left, lead 1, not clinched.
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 } },
    };
    const t = { players, rounds: [round], currentRound: 0 };
    const r = tournamentMatchPlayStandings(t);
    expect(r.status).toBe('Alex leads by 1');
  });

  test('reports all square when holes won are equal', () => {
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 5 }, b: { 1: 5, 2: 4 } },
    };
    const t = { players, rounds: [round], currentRound: 0 };
    expect(tournamentMatchPlayStandings(t).status).toBe('All square');
  });

  test('returns null when not exactly 2 players', () => {
    const round = { holes, playerHandicaps: {}, scores: { a: { 1: 4 } } };
    const t = { players: players.slice(0, 1), rounds: [round], currentRound: 0 };
    expect(tournamentMatchPlayStandings(t)).toBeNull();
  });

  test('returns null before any hole is scored', () => {
    const t = {
      players, rounds: [{ holes, playerHandicaps: {}, scores: {} }], currentRound: 0,
    };
    expect(tournamentMatchPlayStandings(t)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest scoring -t "tournamentMatchPlayStandings" --verbose`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

In `src/store/scoring.js`, append after `tournamentSindicatoClinched`:

```js
// Match Play tournament standing. Across played rounds, sums each of the two
// players' holes won (matchPlayRoundTally) and total gross strokes. Returns
// { board: [{player, points, strokes}] sorted by holes won desc, status } or
// null for the wrong player count / before any hole is scored. `status` is
// "<leader> wins" once the lead exceeds the holes still to play, else
// "<leader> leads by N", else "All square".
export function tournamentMatchPlayStandings(tournament) {
  const { players, rounds } = tournament;
  if (!players || players.length !== 2) return null;
  const hasAnyScore = rounds.some((r) => r.scores && Object.keys(r.scores).length > 0);
  if (!hasAnyScore) return null;
  const [a, b] = players;
  let aHoles = 0;
  let bHoles = 0;
  let holesRemaining = 0;
  const strokes = { [a.id]: 0, [b.id]: 0 };
  rounds.forEach((round, idx) => {
    players.forEach((p) => {
      const holeScores = round.scores?.[p.id] ?? {};
      for (const v of Object.values(holeScores)) strokes[p.id] += (v || 0);
    });
    const future = idx > (tournament.currentRound ?? 0);
    if (future) {
      holesRemaining += round.holes?.length ?? 0;
      return;
    }
    const tally = matchPlayRoundTally(round, players);
    if (tally) {
      aHoles += tally.aWins;
      bHoles += tally.bWins;
      holesRemaining += tally.holesLeft;
    } else {
      holesRemaining += round.holes?.length ?? 0;
    }
  });
  const board = [
    { player: a, points: aHoles, strokes: strokes[a.id] },
    { player: b, points: bHoles, strokes: strokes[b.id] },
  ].sort((x, y) => y.points - x.points);
  const lead = Math.abs(aHoles - bHoles);
  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  let status;
  if (lead === 0) status = 'All square';
  else if (lead > holesRemaining) status = `${firstName(board[0].player)} wins`;
  else status = `${firstName(board[0].player)} leads by ${lead}`;
  return { board, status };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest scoring --verbose`
Expected: PASS — full `scoring.test.js` suite.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: tournamentMatchPlayStandings for the Match Play leaderboard"
```

---

## Task 2: Re-export `tournamentMatchPlayStandings` from tournamentStore

**Files:**
- Modify: `src/store/tournamentStore.js`

No unit test — verified by the suite staying green.

- [ ] **Step 1: Import it**

In `src/store/tournamentStore.js`, the `import { ... } from './scoring';` block contains `tournamentSindicatoClinched,`. Add `tournamentMatchPlayStandings,` to that import block (next line after `tournamentSindicatoClinched,`).

- [ ] **Step 2: Re-export it**

The `export { ... } from './scoring';` block contains `tournamentSindicatoLeaderboard,`. Add `tournamentMatchPlayStandings,` to that re-export block (next line after `tournamentSindicatoLeaderboard,`).

- [ ] **Step 3: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

- [ ] **Step 4: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "feat: re-export tournamentMatchPlayStandings"
```

---

## Task 3: Extend `RankedRow` with a second sub value

**Files:**
- Modify: `src/screens/HomeScreen.js`

`RoundScoreboard` (Task 4) needs each row to show points + strokes + vs-par. `RankedRow` currently shows `primary` + one `sub`. Add an optional second sub slot (`sub2`, with its own color) for vs-par.

No unit test — verified by the suite staying green.

- [ ] **Step 1: Update `RankedRow`**

In `src/screens/HomeScreen.js`, `RankedRow` is currently:
```js
const RankedRow = React.memo(function RankedRow({ rank, name, primary, sub, isWinner, isLast, theme, s }) {
```
…ending with:
```js
      <Text style={[s.rankedPrimary, rank === 1 && { fontSize: 18 }]}>{primary}</Text>
      <Text style={s.rankedSub}>{sub ?? ''}</Text>
    </View>
  );
});
```
Change the prop list to add `sub2` and `sub2Color`:
```js
const RankedRow = React.memo(function RankedRow({ rank, name, primary, sub, sub2, sub2Color, isWinner, isLast, theme, s }) {
```
And change the two trailing `<Text>` lines so a second sub renders only when provided:
```js
      <Text style={[s.rankedPrimary, rank === 1 && { fontSize: 18 }]}>{primary}</Text>
      <Text style={s.rankedSub}>{sub ?? ''}</Text>
      {sub2 != null && (
        <Text style={[s.rankedSub2, sub2Color && { color: sub2Color }]}>{sub2}</Text>
      )}
    </View>
  );
});
```

- [ ] **Step 2: Add the `rankedSub2` style**

In the `makeStyles` factory, find the existing `rankedSub` style entry:
```js
  rankedSub: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, width: 60, textAlign: 'right' },
```
Add directly after it:
```js
  rankedSub2: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 11, width: 44, textAlign: 'right' },
```

- [ ] **Step 3: Verify**

Run: `npx jest`
Expected: PASS — full suite green. (`RankedRow`'s existing callers pass no `sub2`, so `sub2 != null` is false and behavior is unchanged for them.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: RankedRow optional second sub value (vs-par slot)"
```

---

## Task 4: `RoundScoreboard` — the universal round card

**Files:**
- Modify: `src/screens/HomeScreen.js`

Create one universal `RoundScoreboard` (progress bar + per-player Stableford points / strokes / vs-par), wire `RoundPage` to render it, and delete the four mode-specific round cards.

No unit test — verified by the suite staying green plus the manual checklist.

- [ ] **Step 1: Add the `RoundScoreboard` component**

In `src/screens/HomeScreen.js`, immediately ABOVE the line `const StablefordRoundCard = React.memo(function StablefordRoundCard(`, insert:

```js
// Universal round card — identical in every scoring mode. Shows a holes-played
// progress bar for the round, then each player ranked by Stableford points
// with strokes and vs-par. Replaces the four mode-specific round cards.
const RoundScoreboard = React.memo(function RoundScoreboard({ round, players, theme, s, showRunning = true }) {
  const holes = round?.holes ?? [];
  const totalHoles = holes.length || 18;

  // Per-player strokes / par-through / scored-hole count, plus Stableford
  // points from roundTotals.
  const totals = roundTotals(round, players);
  const totalsById = Object.fromEntries(totals.map((t) => [t.player.id, t]));
  const rows = players.map((player) => {
    const ps = round?.scores?.[player.id] ?? {};
    let strokes = 0;
    let parThrough = 0;
    let played = 0;
    for (const hole of holes) {
      const sc = ps[hole.number];
      if (sc) { strokes += sc; parThrough += hole.par ?? 0; played++; }
    }
    return {
      player,
      points: totalsById[player.id]?.totalPoints ?? 0,
      strokes,
      played,
      vsPar: strokes - parThrough,
    };
  }).sort((a, b) => b.points - a.points);

  const holesPlayed = rows.length ? Math.max(...rows.map((r) => r.played)) : 0;
  const progressPct = totalHoles > 0 ? Math.min(100, Math.round((holesPlayed / totalHoles) * 100)) : 0;

  // The round is decided once every player has scored every hole and there is
  // a sole top scorer.
  const allScored = players.length > 0 && players.every((p) =>
    holes.every((h) => round?.scores?.[p.id]?.[h.number] != null));
  const decided = allScored && rows.length > 1 && rows[0].points !== rows[1].points;

  const vsParText = (r) => {
    if (r.played === 0) return '—';
    if (r.vsPar === 0) return 'E';
    return r.vsPar > 0 ? `+${r.vsPar}` : `${r.vsPar}`;
  };
  const vsParColor = (r) => {
    if (r.played === 0) return theme.text.muted;
    if (r.vsPar < 0) return theme.scoreColor('excellent');
    if (r.vsPar === 0) return theme.scoreColor('good');
    return theme.scoreColor('poor');
  };

  return (
    <>
      <View style={s.roundProgressRow}>
        <View style={s.roundProgressTrack}>
          <View style={[s.roundProgressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={s.roundProgressText}>{holesPlayed} / {totalHoles}</Text>
      </View>
      {rows.map((r, i) => (
        <RankedRow
          key={r.player.id}
          rank={i + 1}
          name={r.player.name}
          primary={showRunning ? `${r.points} pts` : '— pts'}
          sub={showRunning ? `${r.strokes || '-'} str` : null}
          sub2={showRunning ? vsParText(r) : '—'}
          sub2Color={showRunning ? vsParColor(r) : theme.text.muted}
          isWinner={showRunning && decided && i === 0}
          isLast={i === rows.length - 1}
          theme={theme}
          s={s}
        />
      ))}
    </>
  );
});
```

`roundTotals` is already imported in this file (used by other code). `theme.scoreColor` is the existing theme helper used elsewhere (e.g. ScorecardScreen's vs-par). If `theme.scoreColor` does not exist, STOP and report BLOCKED.

- [ ] **Step 2: Add the progress-bar styles**

In `makeStyles`, find the `rankedSub2` style added in Task 3, and after it add:
```js
  roundProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  roundProgressTrack: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: t.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  roundProgressFill: { height: 6, borderRadius: 3, backgroundColor: t.accent.primary },
  roundProgressText: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.muted, fontSize: 11 },
```

- [ ] **Step 3: Rewire `RoundPage` to render `RoundScoreboard`**

In `RoundPage`, the `hasScores` branch currently reads:
```js
      {hasScores ? (
        settings?.scoringMode === 'matchplay'
          ? <MatchPlayRoundCard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
          : settings?.scoringMode === 'sindicato'
            ? <SindicatoRoundCard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
            : roundBestBall
              ? <BestBallRoundCard round={round} players={players} settings={settings} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
              : <StablefordRoundCard round={round} players={players} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
      ) : revealed && hasPairs ? (
```
Replace that whole `hasScores ?` expression with:
```js
      {hasScores ? (
        <RoundScoreboard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
      ) : revealed && hasPairs ? (
```
`RoundPage` still computes `clinchedPairIdx` / `tournamentMode` above this — those are now unused by the `hasScores` branch. Remove the now-unused `const tournamentMode = ...` and `const clinchedPairIdx = ...` lines in `RoundPage` (and the `roundPairClinched` import if nothing else in the file uses it — verify with grep; if `roundPairClinched` is still used elsewhere, keep the import).

- [ ] **Step 4: Delete the four mode-specific round cards**

Delete these four component definitions entirely from `src/screens/HomeScreen.js`:
`StablefordRoundCard`, `MatchPlayRoundCard`, `SindicatoRoundCard`, `BestBallRoundCard`.
(`RoundScoreboard` from Step 1 replaces all of them. `RankedRow` and `PairsPreviewCard` stay.)

- [ ] **Step 5: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

Run: `grep -nE "StablefordRoundCard|MatchPlayRoundCard|SindicatoRoundCard|BestBallRoundCard" src/screens/HomeScreen.js`
Expected: no matches (all four definitions and references gone).

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: universal RoundScoreboard replaces four mode round cards"
```

---

## Task 5: Show the LEADERBOARD card for games + Match Play branch

**Files:**
- Modify: `src/screens/HomeScreen.js`

No unit test — verified by the suite staying green plus the manual checklist.

- [ ] **Step 1: Import `tournamentMatchPlayStandings`**

`HomeScreen.js` imports from `'../store/tournamentStore'`. The import block contains the line `sindicatoRoundTally, tournamentSindicatoLeaderboard,`. Change that line to:
```js
  sindicatoRoundTally, tournamentSindicatoLeaderboard,
  tournamentMatchPlayStandings,
```

- [ ] **Step 2: Branch the `leaderboard` memo for Match Play**

The `leaderboard` memo currently reads:
```js
  const leaderboard = useMemo(
    () => {
      if (!tournament) return [];
      return settings.scoringMode === 'sindicato'
        ? tournamentSindicatoLeaderboard(tournament)
        : tournamentLeaderboard(tournament);
    },
    [tournament, settings.scoringMode],
  );
```
Replace it with:
```js
  const matchPlayStandings = useMemo(
    () => (tournament && settings.scoringMode === 'matchplay'
      ? tournamentMatchPlayStandings(tournament)
      : null),
    [tournament, settings.scoringMode],
  );
  const leaderboard = useMemo(
    () => {
      if (!tournament) return [];
      if (settings.scoringMode === 'matchplay') return matchPlayStandings?.board ?? [];
      if (settings.scoringMode === 'sindicato') return tournamentSindicatoLeaderboard(tournament);
      return tournamentLeaderboard(tournament);
    },
    [tournament, settings.scoringMode, matchPlayStandings],
  );
```

- [ ] **Step 3: Include Match Play in `tournamentMode`**

The `tournamentMode` line currently reads:
```js
  const tournamentMode = settings.scoringMode === 'bestball' ? 'bestball'
    : settings.scoringMode === 'sindicato' ? 'sindicato'
    : 'stableford';
```
Replace it with:
```js
  const tournamentMode = settings.scoringMode === 'bestball' ? 'bestball'
    : settings.scoringMode === 'sindicato' ? 'sindicato'
    : settings.scoringMode === 'matchplay' ? 'matchplay'
    : 'stableford';
```

- [ ] **Step 4: Show the LEADERBOARD card for games**

The LEADERBOARD card JSX is wrapped in a `{!isGame && (` … `)}` guard — it begins:
```js
      {!isGame && (
      <View style={s.mastersCard}>
        <View style={s.cardTitleRow}>
          <Text style={s.mastersCardTitle}>LEADERBOARD</Text>
```
and ends, after the `displayedBoard.map(...)` block, with:
```js
      </View>
      )}
```
Remove the `{!isGame && (` opening and its matching `)}` closing so the `<View style={s.mastersCard}>` … `</View>` always renders. (Re-indent is optional; correctness only requires removing the two guard lines.)

- [ ] **Step 5: Render the Match Play points unit and status**

Inside the LEADERBOARD card, the per-row points `Text` currently reads:
```js
              <Text style={[s.mastersPoints, i === 0 && { fontSize: 18 }]}>{showRunning ? `${entry.points} pts` : '—'}</Text>
```
Replace it with (Match Play shows holes, not points):
```js
              <Text style={[s.mastersPoints, i === 0 && { fontSize: 18 }]}>{
                !showRunning ? '—'
                  : settings.scoringMode === 'matchplay'
                    ? `${entry.points} ${entry.points === 1 ? 'hole' : 'holes'}`
                    : `${entry.points} pts`
              }</Text>
```

Then add the Match Play status line. Immediately after the `displayedBoard.map(...)` closing `})}` and before the LEADERBOARD card's closing `</View>`, add:
```js
        {settings.scoringMode === 'matchplay' && matchPlayStandings && showRunning && (
          <Text style={s.mastersMatchStatus}>{matchPlayStandings.status}</Text>
        )}
```

- [ ] **Step 6: Add the `mastersMatchStatus` style**

In `makeStyles`, find the `mastersSub` style entry and add directly after it:
```js
  mastersMatchStatus: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.85)',
    fontSize: 12, textAlign: 'center', marginTop: 10,
  },
```

- [ ] **Step 7: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: LEADERBOARD card for games + Match Play branch"
```

---

## Task 6: Retire `GameOverviewCard`

**Files:**
- Modify: `src/screens/HomeScreen.js`

No unit test — verified by the suite staying green plus the manual checklist.

- [ ] **Step 1: Remove the `GameOverviewCard` render block**

In the HomeScreen JSX, the `GameOverviewCard` is rendered in a block that begins:
```js
      {tournament.rounds.length > 0 && isGame && tournament.rounds.length === 1
        && settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball' && settings.scoringMode !== 'sindicato' && (
        <GameOverviewCard
```
…and ends with `)}` after the `<GameOverviewCard ... />` element. Delete this entire block (the conditional and the `<GameOverviewCard>` element).

- [ ] **Step 2: Make the ROUND SCORES card unconditional**

The ROUND SCORES card is currently gated so it does NOT show when `GameOverviewCard` would. Its guard begins:
```js
      {tournament.rounds.length > 0 && !(isGame && tournament.rounds.length === 1
        && settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball' && settings.scoringMode !== 'sindicato') && (
        <View style={s.card}>
```
Replace that opening guard line(s) with a simple "has rounds" guard:
```js
      {tournament.rounds.length > 0 && (
        <View style={s.card}>
```
(The card's matching `)}` closing stays as-is.)

- [ ] **Step 3: Delete the `GameOverviewCard` component definition**

Delete the entire `const GameOverviewCard = React.memo(function GameOverviewCard({ ... }) { ... });` definition from `src/screens/HomeScreen.js`.

- [ ] **Step 4: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

Run: `grep -nE "GameOverviewCard" src/screens/HomeScreen.js`
Expected: no matches.

Note: `GameOverviewCard`'s styles (`gameHeroCard`, `gamePlayerCard`, `gameStat*`, `gameProgress*`, etc.) are now unused. Leaving unused style definitions is acceptable and out of scope — do NOT remove them (removing dead styles risks touching a style still referenced elsewhere; a separate cleanup pass can handle it).

- [ ] **Step 5: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "refactor: retire GameOverviewCard for the unified game layout"
```

- [ ] **Step 6: Manual verification**

Start the app (`npx expo start`) — or use the running web build. For a game/tournament in **each** scoring mode (individual, stableford, matchplay, bestball, sindicato), and for both a single-round game and a multi-round tournament, confirm:
- The green LEADERBOARD card and the white ROUND SCORES card both appear, in that order, for every game and tournament.
- ROUND SCORES shows a holes-played progress bar, then each player ranked by Stableford points with strokes and a colored vs-par — identical layout in every mode.
- LEADERBOARD shows the mode's standing: Stableford/individual → Stableford points; Best Ball → pair points (with the toggle); Sindicato → Sindicato points; Match Play → the two players by holes won plus the status line ("Alex leads by 2" / "Alex wins" / "All square").
- A single-round game shows the same two-card layout as a tournament; no `GameOverviewCard` appears anywhere.
- With the running-score eye toggle off, values render `—`.
- Verified in both light and dark mode.

---

## Self-Review Notes

- **Spec coverage:** universal `RoundScoreboard` with progress bar + points/strokes/vs-par (Task 4) ✓; "through" dropped, progress bar + vs-par generalized to all modes (Task 4) ✓; `RankedRow` extended for the extra figure (Task 3) ✓; LEADERBOARD shown for games (Task 5 Step 4) ✓; Match Play branch via `tournamentMatchPlayStandings` (Tasks 1, 5) ✓; four mode round cards deleted (Task 4) ✓; `GameOverviewCard` retired (Task 6) ✓; card order LEADERBOARD-then-ROUND-SCORES preserved ✓; no scoring-math change beyond the new function ✓.
- **Type consistency:** `tournamentMatchPlayStandings` → `{ board: [{player, points, strokes}], status } | null`; its `board` is shape-compatible with `tournamentLeaderboard`/`tournamentSindicatoLeaderboard` output (`{player, points, strokes}`) so the `displayedBoard.map` renders it unchanged. `RankedRow` props `{ rank, name, primary, sub, sub2, sub2Color, isWinner, isLast, theme, s }` — `RoundScoreboard` passes all of them; after Task 4 `RoundScoreboard` is the only `RankedRow` caller.
- **No placeholders:** every code step contains complete, runnable code.
