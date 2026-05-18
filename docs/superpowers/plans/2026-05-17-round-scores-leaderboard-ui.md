# Round Scores Leaderboard-Style UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four HomeScreen round cards render their results as ranked rows, visually consistent with the LEADERBOARD card.

**Architecture:** Add one shared theme-aware `RankedRow` presentational component (modeled on the leaderboard's row, but using `theme` colors so it is legible on the normal card background). Rewrite `StablefordRoundCard`, `MatchPlayRoundCard`, `BestBallRoundCard`, and `SindicatoRoundCard` to compute their ranked entries (unchanged logic) and render `RankedRow`s instead of the old `pairBlock` markup. No scoring math changes.

**Tech Stack:** React Native 0.81, Expo 54, jest + jest-expo. No React Native Testing Library — UI is verified by the jest suite staying green plus a structured manual checklist.

**Spec:** `docs/superpowers/specs/2026-05-17-round-scores-leaderboard-ui-design.md`

---

## File Structure

- **`src/screens/HomeScreen.js`** (modify) — add the `RankedRow` component and its `ranked*` styles in `makeStyles`; rewrite the four round-card components. Single-file change. The LEADERBOARD card, `GameOverviewCard`, `PairsPreviewCard`, the round tabs, and the swipe pager are untouched.

No test files — the change is pure presentation; the existing `scoring` / `scoringModes` / `merge` jest suites cover the unchanged scoring math.

---

## Task 1: Add the shared `RankedRow` component and styles

**Files:**
- Modify: `src/screens/HomeScreen.js`

- [ ] **Step 1: Add the `ranked*` styles**

In `src/screens/HomeScreen.js`, the `makeStyles` factory contains a `// Masters leaderboard` block ending with the `mastersSub` entry:
```js
  mastersSub: { fontFamily: 'PlusJakartaSans-Medium', color: 'rgba(255,255,255,0.45)', fontSize: 11, width: 60, textAlign: 'right' },
```
Immediately after that line, add these eight theme-aware style entries:
```js

  // Ranked rows (round cards — leaderboard-style, theme-aware)
  rankedRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border.default,
  },
  rankedRowFirst: {
    borderLeftWidth: 3, borderLeftColor: '#ffd700',
    paddingLeft: 8, marginLeft: -8,
  },
  rankBadge: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  rankText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 },
  rankedNameCol: { flex: 1, minWidth: 0, marginRight: 8 },
  rankedName: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.primary, fontSize: 14 },
  rankedPrimary: { fontFamily: 'PlusJakartaSans-ExtraBold', color: t.accent.primary, fontSize: 16, marginRight: 8 },
  rankedSub: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, width: 60, textAlign: 'right' },
```
NOTE: the `makeStyles` factory's theme parameter is named `t` in this file (the existing `masters*` styles reference `t.isDark`). Confirm the parameter name by reading the `makeStyles` signature; if it is named something other than `t`, use that name instead. If `makeStyles` does not exist or is not a `StyleSheet.create` factory taking the theme, STOP and report BLOCKED.

- [ ] **Step 2: Add the `RankedRow` component**

In `src/screens/HomeScreen.js`, find the line `const StablefordRoundCard = React.memo(function StablefordRoundCard(`. Immediately ABOVE that line, insert this component:
```js
// Shared ranked row for the round cards — the leaderboard's row visual made
// theme-aware so it is legible on the normal card background. Ranks 1/2/3 get
// gold/silver/bronze badges; the winner row also gets a left gold border and
// an award icon. `sub` is an optional right-aligned muted value (e.g. strokes).
function RankedRow({ rank, name, primary, sub, isWinner, isLast, theme, s }) {
  const rankColors = ['#ffd700', '#c0c8d4', '#daa06d'];
  const rankColor = rankColors[rank - 1] || theme.text.muted;
  const rankBg = rank === 1 ? 'rgba(255,215,0,0.18)'
    : rank === 2 ? 'rgba(192,200,212,0.18)'
    : rank === 3 ? 'rgba(218,160,109,0.18)'
    : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)');
  return (
    <View style={[
      s.rankedRow,
      rank === 1 && s.rankedRowFirst,
      isLast && { borderBottomWidth: 0 },
    ]}>
      <View style={[s.rankBadge, { backgroundColor: rankBg }]}>
        <Text style={[s.rankText, { color: rankColor }]}>{rank}</Text>
      </View>
      <View style={s.rankedNameCol}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={[s.rankedName, rank === 1 && { fontFamily: 'PlusJakartaSans-Bold' }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {isWinner && <Feather name="award" size={13} color="#ffd700" />}
        </View>
      </View>
      <Text style={[s.rankedPrimary, rank === 1 && { fontSize: 18 }]}>{primary}</Text>
      <Text style={s.rankedSub}>{sub ?? ''}</Text>
    </View>
  );
}
```
`View`, `Text`, and `Feather` are already imported in this file (used by every existing card). If any is not imported, STOP and report BLOCKED.

- [ ] **Step 3: Verify nothing regressed**

Run: `npx jest`
Expected: PASS — full suite (82 tests) green. No test imports `HomeScreen.js`; this confirms no unrelated module broke.

- [ ] **Step 4: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: add shared RankedRow component for round cards"
```

---

## Task 2: Convert the four round cards to ranked rows

**Files:**
- Modify: `src/screens/HomeScreen.js`

Each card below is replaced in full. Read the current component before replacing it to confirm it matches the "current" form shown; if a card has diverged, STOP and report BLOCKED with the actual content.

- [ ] **Step 1: Rewrite `StablefordRoundCard`**

Current form:
```js
const StablefordRoundCard = React.memo(function StablefordRoundCard({ round, players, clinchedPairIdx, theme, s, showRunning = true }) {
  const pairResults = roundPairLeaderboard(round, players);
  // Map sorted-leaderboard position back to round.pairs index so we can
  // tag the winner row with a crown when that pair is mathematically
  // clinched. The leader row (pi === 0) is always first in pairResults.
  const pairIdxFor = (members) => round.pairs.findIndex((pr) => (
    pr.length === members.length && pr.every((p) => members.some((m) => m.player.id === p.id))
  ));
  const competitive = pairResults.length > 1;
  return (
    <>
      {pairResults.map((pair, pi) => {
        const origIdx = pairIdxFor(pair.members);
        const isClinched = clinchedPairIdx != null && origIdx === clinchedPairIdx;
        return (
          <View key={pi} style={[s.pairBlock, showRunning && competitive && pi === 0 && s.winnerBlock]}>
            {showRunning && competitive && pi === 0 && <Text style={s.winnerBadge}>WINNER</Text>}
            <View style={s.pairHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={s.pairNames}>{pair.members.map((m) => m.player.name).join(' & ')}</Text>
                {showRunning && isClinched && <Feather name="award" size={14} color="#ffd700" />}
              </View>
              <Text style={s.pairPoints}>{showRunning ? `${pair.combinedPoints} pts` : '— pts'}</Text>
            </View>
          </View>
        );
      })}
    </>
  );
});
```
Replace it entirely with:
```js
const StablefordRoundCard = React.memo(function StablefordRoundCard({ round, players, clinchedPairIdx, theme, s, showRunning = true }) {
  const pairResults = roundPairLeaderboard(round, players);
  // Map sorted-leaderboard position back to round.pairs index so the winner
  // row can be tagged when that pair is mathematically clinched.
  const pairIdxFor = (members) => round.pairs.findIndex((pr) => (
    pr.length === members.length && pr.every((p) => members.some((m) => m.player.id === p.id))
  ));
  return (
    <>
      {pairResults.map((pair, pi) => {
        const origIdx = pairIdxFor(pair.members);
        const isClinched = clinchedPairIdx != null && origIdx === clinchedPairIdx;
        return (
          <RankedRow
            key={pi}
            rank={pi + 1}
            name={pair.members.map((m) => m.player.name).join(' & ')}
            primary={showRunning ? `${pair.combinedPoints} pts` : '— pts'}
            sub={showRunning ? `${pair.combinedStrokes || '-'} str` : null}
            isWinner={showRunning && isClinched}
            isLast={pi === pairResults.length - 1}
            theme={theme}
            s={s}
          />
        );
      })}
    </>
  );
});
```

- [ ] **Step 2: Rewrite `MatchPlayRoundCard`**

Current form:
```js
const MatchPlayRoundCard = React.memo(function MatchPlayRoundCard({ round, players, theme, s, showRunning = true }) {
  if (!players || players.length !== 2) {
    return <Text style={s.pairMember}>Match play needs 2 players</Text>;
  }
  const tally = matchPlayRoundTally(round, players);
  if (!tally) return <Text style={s.pairMember}>No results yet</Text>;

  const { aWins, bWins, halved, leaderIdx, lead, clinched, holesLeft } = tally;
  const leader = leaderIdx !== null ? players[leaderIdx] : null;
  const loser = leaderIdx !== null ? players[1 - leaderIdx] : null;

  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const status = leader
    ? clinched
      ? `${firstName(leader)} wins ${lead}&${holesLeft}`
      : `${firstName(leader)} ${lead} UP${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
    : `All square${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;

  // Order rows: leader first (winner), then other.
  const rows = leader
    ? [
        { player: leader, wins: leaderIdx === 0 ? aWins : bWins, isLeader: true },
        { player: loser, wins: leaderIdx === 0 ? bWins : aWins, isLeader: false },
      ]
    : [
        { player: players[0], wins: aWins, isLeader: false },
        { player: players[1], wins: bWins, isLeader: false },
      ];

  return (
    <>
      {rows.map(({ player, wins, isLeader }, i) => (
        <View key={player.id} style={[s.pairBlock, showRunning && clinched && isLeader && s.winnerBlock]}>
          {showRunning && clinched && isLeader && <Text style={s.winnerBadge}>WINNER</Text>}
          <View style={s.pairHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Text style={s.pairNames}>{player.name}</Text>
              {showRunning && clinched && isLeader && <Feather name="award" size={14} color="#ffd700" />}
            </View>
            <Text style={s.pairPoints}>{showRunning ? `${wins} ${wins === 1 ? 'hole' : 'holes'}` : '—'}</Text>
          </View>
        </View>
      ))}
      <Text style={s.pairsPreviewHint}>
        {showRunning ? `${status}${halved > 0 ? ` · ${halved} halved` : ''}` : 'Scores hidden'}
      </Text>
    </>
  );
});
```
Replace it entirely with:
```js
const MatchPlayRoundCard = React.memo(function MatchPlayRoundCard({ round, players, theme, s, showRunning = true }) {
  if (!players || players.length !== 2) {
    return <Text style={s.pairMember}>Match play needs 2 players</Text>;
  }
  const tally = matchPlayRoundTally(round, players);
  if (!tally) return <Text style={s.pairMember}>No results yet</Text>;

  const { aWins, bWins, halved, leaderIdx, lead, clinched, holesLeft } = tally;
  const leader = leaderIdx !== null ? players[leaderIdx] : null;
  const loser = leaderIdx !== null ? players[1 - leaderIdx] : null;

  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const status = leader
    ? clinched
      ? `${firstName(leader)} wins ${lead}&${holesLeft}`
      : `${firstName(leader)} ${lead} UP${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
    : `All square${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;

  // Order rows: leader first, then other.
  const rows = leader
    ? [
        { player: leader, wins: leaderIdx === 0 ? aWins : bWins, isLeader: true },
        { player: loser, wins: leaderIdx === 0 ? bWins : aWins, isLeader: false },
      ]
    : [
        { player: players[0], wins: aWins, isLeader: false },
        { player: players[1], wins: bWins, isLeader: false },
      ];

  return (
    <>
      {rows.map(({ player, wins, isLeader }, i) => (
        <RankedRow
          key={player.id}
          rank={i + 1}
          name={player.name}
          primary={showRunning ? `${wins} ${wins === 1 ? 'hole' : 'holes'}` : '—'}
          sub={null}
          isWinner={showRunning && clinched && isLeader}
          isLast={i === rows.length - 1}
          theme={theme}
          s={s}
        />
      ))}
      <Text style={s.pairsPreviewHint}>
        {showRunning ? `${status}${halved > 0 ? ` · ${halved} halved` : ''}` : 'Scores hidden'}
      </Text>
    </>
  );
});
```

- [ ] **Step 3: Rewrite `SindicatoRoundCard`**

Current form:
```js
const SindicatoRoundCard = React.memo(function SindicatoRoundCard({ round, players, theme, s, showRunning = true }) {
  if (!players || players.length !== 3) {
    return <Text style={s.pairMember}>Sindicato needs 3 players</Text>;
  }
  const tally = sindicatoRoundTally(round, players);
  if (!tally) return <Text style={s.pairMember}>No results yet</Text>;

  const { totals, leaderIdx, lead, clinched, holesLeft } = tally;
  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const leader = leaderIdx != null ? totals[leaderIdx].player : null;
  const status = clinched && leader
    ? `${firstName(leader)} wins`
    : leader
      ? `${firstName(leader)} leads by ${lead}${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
      : `All level${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;

  return (
    <>
      {totals.map(({ player, points }, i) => {
        const isLeader = leaderIdx === i;
        return (
          <View key={player.id} style={[s.pairBlock, showRunning && clinched && isLeader && s.winnerBlock]}>
            {showRunning && clinched && isLeader && <Text style={s.winnerBadge}>WINNER</Text>}
            <View style={s.pairHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={s.pairNames}>{player.name}</Text>
                {showRunning && clinched && isLeader && <Feather name="award" size={14} color="#ffd700" />}
              </View>
              <Text style={s.pairPoints}>{showRunning ? `${points} ${points === 1 ? 'pt' : 'pts'}` : '—'}</Text>
            </View>
          </View>
        );
      })}
      <Text style={s.pairsPreviewHint}>{showRunning ? status : 'Scores hidden'}</Text>
    </>
  );
});
```
Replace it entirely with:
```js
const SindicatoRoundCard = React.memo(function SindicatoRoundCard({ round, players, theme, s, showRunning = true }) {
  if (!players || players.length !== 3) {
    return <Text style={s.pairMember}>Sindicato needs 3 players</Text>;
  }
  const tally = sindicatoRoundTally(round, players);
  if (!tally) return <Text style={s.pairMember}>No results yet</Text>;

  const { totals, leaderIdx, clinched } = tally;
  const strokesOf = (id) =>
    Object.values(round.scores?.[id] ?? {}).reduce((sum, v) => sum + (v || 0), 0);

  return (
    <>
      {totals.map(({ player, points }, i) => (
        <RankedRow
          key={player.id}
          rank={i + 1}
          name={player.name}
          primary={showRunning ? `${points} ${points === 1 ? 'pt' : 'pts'}` : '—'}
          sub={showRunning ? `${strokesOf(player.id) || '-'} str` : null}
          isWinner={showRunning && clinched && leaderIdx === i}
          isLast={i === totals.length - 1}
          theme={theme}
          s={s}
        />
      ))}
    </>
  );
});
```
(The Sindicato status footer is intentionally dropped — only Match Play keeps a footer.)

- [ ] **Step 4: Rewrite `BestBallRoundCard`**

Current form (read the file to confirm — it ends with `</>`, `);`, `});` after the `pair2` block):
```js
const BestBallRoundCard = React.memo(function BestBallRoundCard({ round, players, settings, clinchedPairIdx, theme, s, showRunning = true }) {
  const result = calcBestWorstBall(round, players);
  if (!result) return <Text style={s.pairMember}>No results yet</Text>;

  const { pair1, pair2, bestBall, worstBall } = result;
  const p1Names = pair1.map((p) => p.name).join(' & ');
  const p2Names = pair2.map((p) => p.name).join(' & ');

  const p1Points = bestBall.pair1 * settings.bestBallValue + worstBall.pair1 * settings.worstBallValue;
  const p2Points = bestBall.pair2 * settings.bestBallValue + worstBall.pair2 * settings.worstBallValue;
  const winner = p1Points > p2Points ? 1 : p2Points > p1Points ? 2 : 0;
  const p1Clinched = clinchedPairIdx === 0;
  const p2Clinched = clinchedPairIdx === 1;

  return (
    <>
      <View style={[s.pairBlock, showRunning && winner === 1 && s.winnerBlock]}>
        {showRunning && winner === 1 && <Text style={s.winnerBadge}>WINNER</Text>}
        <View style={s.pairHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={s.pairNames}>{p1Names}</Text>
            {showRunning && p1Clinched && <Feather name="award" size={14} color="#ffd700" />}
          </View>
          <Text style={s.pairPoints}>{showRunning ? `${p1Points} pts` : '— pts'}</Text>
        </View>
      </View>
      <View style={[s.pairBlock, showRunning && winner === 2 && s.winnerBlock]}>
        {showRunning && winner === 2 && <Text style={s.winnerBadge}>WINNER</Text>}
        <View style={s.pairHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Text style={s.pairNames}>{p2Names}</Text>
            {showRunning && p2Clinched && <Feather name="award" size={14} color="#ffd700" />}
          </View>
          <Text style={s.pairPoints}>{showRunning ? `${p2Points} pts` : '— pts'}</Text>
        </View>
      </View>
    </>
  );
});
```
Replace the whole component entirely with:
```js
const BestBallRoundCard = React.memo(function BestBallRoundCard({ round, players, settings, clinchedPairIdx, theme, s, showRunning = true }) {
  const result = calcBestWorstBall(round, players);
  if (!result) return <Text style={s.pairMember}>No results yet</Text>;

  const { pair1, pair2, bestBall, worstBall } = result;
  const p1Points = bestBall.pair1 * settings.bestBallValue + worstBall.pair1 * settings.worstBallValue;
  const p2Points = bestBall.pair2 * settings.bestBallValue + worstBall.pair2 * settings.worstBallValue;

  // Rank the two pairs by total points so the leader is row 1.
  const entries = [
    { idx: 0, name: pair1.map((p) => p.name).join(' & '), points: p1Points },
    { idx: 1, name: pair2.map((p) => p.name).join(' & '), points: p2Points },
  ].sort((a, b) => b.points - a.points);

  return (
    <>
      {entries.map((e, i) => (
        <RankedRow
          key={e.idx}
          rank={i + 1}
          name={e.name}
          primary={showRunning ? `${e.points} pts` : '— pts'}
          sub={null}
          isWinner={showRunning && clinchedPairIdx === e.idx}
          isLast={i === entries.length - 1}
          theme={theme}
          s={s}
        />
      ))}
    </>
  );
});
```
If the current `BestBallRoundCard` differs in any way other than trailing whitespace from the "current form" above, STOP and report BLOCKED with the actual content.

- [ ] **Step 5: Verify**

Run: `npx jest`
Expected: PASS — full suite (82 tests) green.

Confirm the four cards no longer reference the removed markup — run:
`grep -nE "pairBlock|winnerBadge|winnerBlock" src/screens/HomeScreen.js`
Expected: any remaining matches are ONLY inside `PairsPreviewCard` (which legitimately keeps `pairBlock`) and the `makeStyles` style definitions — none inside `StablefordRoundCard`, `MatchPlayRoundCard`, `BestBallRoundCard`, or `SindicatoRoundCard`. (`winnerBadge`/`winnerBlock` styles may now be unused; leave the style definitions in place — removing dead styles is out of scope.)

- [ ] **Step 6: Manual verification**

Start the app (`npx expo start`). For each scoring mode, open a tournament/game with scores entered and confirm the ROUND SCORES card:
- Shows ranked rows: a numbered rank badge (gold/silver/bronze for 1/2/3), name, a bold primary value, and — for Stableford and Sindicato — a small strokes sub-value.
- The rank-1 row has the gold left border; when the result is decided it also shows the gold `award` icon.
- With the running-score eye toggle OFF, primary values show `—` and no award icon appears.
- Match Play still shows its status line ("X UP · N to play" / "All square" / "X wins A&B", with halved count) as a footer below the rows; the other modes have no footer.
- Verify in both light and dark mode that text is legible.
- The round tabs (R1/R2/R3) and swipe pager still work and are visually unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: round cards render leaderboard-style ranked rows"
```

---

## Self-Review Notes

- **Spec coverage:** shared theme-aware `RankedRow` (Task 1) ✓; rank badge gold/silver/bronze + neutral 4+ (Task 1) ✓; name + award icon, primary in accent color, rank-1 size bump + left border (Task 1) ✓; `StablefordRoundCard`/`SindicatoRoundCard`/`BestBallRoundCard`/`MatchPlayRoundCard` rewritten to ranked rows (Task 2) ✓; per-mode `name`/`primary`/`sub`/`isWinner` mapping matches the spec table ✓; Match Play keeps its status footer, others drop theirs ✓; guard/empty states preserved ✓; `showRunning` off → `—` ✓; LEADERBOARD card / `GameOverviewCard` / `PairsPreviewCard` / tabs / pager untouched ✓; no scoring-math change ✓.
- **Type consistency:** `RankedRow` props `{ rank, name, primary, sub, isWinner, isLast, theme, s }` are passed with exactly those names from all four cards. `rank` is 1-based everywhere (`pi + 1` / `i + 1`). `sub` is a string or `null`; `RankedRow` renders `sub ?? ''`.
- **No placeholders:** every code step contains complete, runnable code.
