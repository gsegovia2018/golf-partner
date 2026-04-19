# Math-clinch + partner splits + running score toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the four UX additions agreed in `docs/superpowers/specs/2026-04-19-clinch-and-pair-splits-design.md`: math-clinch badge + popup, partner splits in Pairs tab, and a toggle for per-player running Stableford in the scorecard.

**Architecture:** Pure helpers in `tournamentStore.js`, consumed by `HomeScreen.js`, `ScorecardScreen.js`, and `StatsScreen.js`. No persistence schema changes; the only new persisted state is a single AsyncStorage boolean for the scorecard toggle.

**Tech stack:** React Native + Expo, AsyncStorage for the toggle, existing Feather icon set for the crown badge.

The codebase has no test framework — verification is manual (developer runs the app, walks the scenarios). Each task ends with a commit so reverting is cheap.

---

### Task 1: Math-clinch helpers in tournamentStore.js

**Files:**
- Modify: `src/store/tournamentStore.js` (append after `playerRoundBestWorstPoints` around line 504)

- [ ] **Step 1: Add the helpers**

```js
// Maximum additional Stableford points a player can score on a round's
// remaining (unscored) holes. Assumes 1 stroke (hole-in-one) on each.
export function roundMaxRemainingStableford(round, player) {
  const handicap = getPlayingHandicap(round, player);
  let max = 0;
  round.holes.forEach((hole) => {
    if (round.scores?.[player.id]?.[hole.number] != null) return;
    max += calcStablefordPoints(hole.par, 1, handicap, hole.strokeIndex);
  });
  return max;
}

// Best-ball: per-pair max additional points on remaining holes. A hole is
// "remaining" if any of the four players has not scored it. Cap per hole
// is bestBallValue + worstBallValue (pair wins both roles).
export function roundMaxRemainingBestBall(round, settings) {
  if (!round.pairs || round.pairs.length < 2) return { pair1: 0, pair2: 0 };
  const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };
  const cap = bestBallValue + worstBallValue;
  const allIds = round.pairs.flat().map((p) => p.id);
  let remaining = 0;
  round.holes.forEach((hole) => {
    const allScored = allIds.every((id) => round.scores?.[id]?.[hole.number] != null);
    if (!allScored) remaining += cap;
  });
  return { pair1: remaining, pair2: remaining };
}

// Returns the index (0 or 1) of the pair that has clinched the round, or
// null if neither has. mode: 'stableford' | 'bestball'.
export function roundPairClinched(round, players, settings, mode) {
  if (!round.pairs || round.pairs.length < 2) return null;
  if (mode === 'bestball') {
    const bw = calcBestWorstBall(round, players);
    if (!bw) return null;
    const { bestBallValue, worstBallValue } = { ...DEFAULT_SETTINGS, ...settings };
    const p1 = bw.bestBall.pair1 * bestBallValue + bw.worstBall.pair1 * worstBallValue;
    const p2 = bw.bestBall.pair2 * bestBallValue + bw.worstBall.pair2 * worstBallValue;
    const rem = roundMaxRemainingBestBall(round, settings);
    if (p1 >= p2 + rem.pair2 && p1 > p2) return 0;
    if (p2 >= p1 + rem.pair1 && p2 > p1) return 1;
    if (p1 === p2 && rem.pair1 === 0 && rem.pair2 === 0) return null;
    return null;
  }
  const lb = roundPairLeaderboard(round, players);
  if (lb.length < 2) return null;
  const remByPlayer = new Map();
  round.pairs.forEach((pair, idx) => {
    let pairRem = 0;
    pair.forEach((p) => { pairRem += roundMaxRemainingStableford(round, p); });
    remByPlayer.set(idx, pairRem);
  });
  const pairIdxOf = (members) => round.pairs.findIndex((pr) =>
    pr.length === members.length && pr.every((p) => members.some((m) => m.player.id === p.id))
  );
  const leaderIdx = pairIdxOf(lb[0].members);
  const otherIdx = pairIdxOf(lb[1].members);
  if (leaderIdx < 0 || otherIdx < 0) return null;
  const leaderPts = lb[0].combinedPoints;
  const otherPts = lb[1].combinedPoints;
  const otherMax = remByPlayer.get(otherIdx) ?? 0;
  if (leaderPts > otherPts && leaderPts >= otherPts + otherMax) return leaderIdx;
  return null;
}

// Returns the player id who has clinched the tournament, or null.
export function tournamentPlayerClinched(tournament, mode) {
  const { players, rounds, settings } = tournament;
  const lb = mode === 'bestball'
    ? tournamentBestWorstLeaderboard(tournament)
    : tournamentLeaderboard(tournament);
  if (lb.length < 2) return null;

  const remainingPerPlayer = new Map(players.map((p) => [p.id, 0]));
  rounds.forEach((round, idx) => {
    if (idx > (tournament.currentRound ?? 0)) {
      // Future round counts entirely as "all 18 holes unscored".
      players.forEach((p) => {
        if (mode === 'bestball') {
          const cap = (settings?.bestBallValue ?? 1) + (settings?.worstBallValue ?? 1);
          remainingPerPlayer.set(p.id, remainingPerPlayer.get(p.id) + round.holes.length * cap);
        } else {
          const handicap = getPlayingHandicap(round, p);
          let max = 0;
          round.holes.forEach((h) => {
            max += calcStablefordPoints(h.par, 1, handicap, h.strokeIndex);
          });
          remainingPerPlayer.set(p.id, remainingPerPlayer.get(p.id) + max);
        }
      });
      return;
    }
    if (mode === 'bestball') {
      const rem = roundMaxRemainingBestBall(round, settings);
      // Each player in pair gets the same max contribution from this round.
      round.pairs?.forEach((pair, pairIdx) => {
        const r = pairIdx === 0 ? rem.pair1 : rem.pair2;
        pair.forEach((p) => remainingPerPlayer.set(p.id, remainingPerPlayer.get(p.id) + r));
      });
    } else {
      players.forEach((p) => {
        remainingPerPlayer.set(p.id, remainingPerPlayer.get(p.id) + roundMaxRemainingStableford(round, p));
      });
    }
  });

  const leaderId = lb[0].player.id;
  const leaderPts = mode === 'bestball' ? lb[0].points : lb[0].points;
  for (let i = 1; i < lb.length; i++) {
    const otherPts = mode === 'bestball' ? lb[i].points : lb[i].points;
    const otherRem = remainingPerPlayer.get(lb[i].player.id) ?? 0;
    if (leaderPts < otherPts + otherRem || leaderPts === otherPts) return null;
  }
  return leaderId;
}
```

- [ ] **Step 2: Manual sanity check via Node REPL**

Spot-check that the helpers behave reasonably given a hand-built fixture. Skip if comfortable with the logic — these will be exercised manually in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "Stats: math-clinch helpers (round and tournament, both modes)"
```

---

### Task 2: Partner-splits helper in tournamentStore.js

**Files:**
- Modify: `src/store/tournamentStore.js` (append after `tournamentPlayerClinched`)

- [ ] **Step 1: Add helper**

```js
// For a given player, returns one entry per partner with average individual
// Stableford points across rounds they played together, plus the player's
// overall average (baseline) and the delta between them.
export function playerPartnerSplits(tournament, playerId) {
  const { players, rounds } = tournament;
  const player = players.find((p) => p.id === playerId);
  if (!player) return { baseline: 0, partners: [] };

  const playerRoundPoints = [];
  rounds.forEach((round, idx) => {
    if (!isRoundPlayed(round, idx, tournament)) return;
    const totals = roundTotals(round, players);
    const me = totals.find((t) => t.player.id === playerId);
    if (!me) return;
    const hasAnyScore = Object.values(round.scores?.[playerId] ?? {}).some((s) => s != null);
    if (!hasAnyScore) return;
    playerRoundPoints.push({ roundIndex: idx, points: me.totalPoints });
  });

  const baseline = playerRoundPoints.length
    ? playerRoundPoints.reduce((s, r) => s + r.points, 0) / playerRoundPoints.length
    : 0;

  const buckets = new Map(); // partnerId → { partner, points: [], roundIndices: [] }
  rounds.forEach((round, idx) => {
    if (!isRoundPlayed(round, idx, tournament) || !round.pairs?.length) return;
    const myPair = round.pairs.find((pr) => pr.some((p) => p.id === playerId));
    if (!myPair) return;
    const partner = myPair.find((p) => p.id !== playerId);
    if (!partner) return;
    const totals = roundTotals(round, players);
    const me = totals.find((t) => t.player.id === playerId);
    if (!me) return;
    const hasAnyScore = Object.values(round.scores?.[playerId] ?? {}).some((s) => s != null);
    if (!hasAnyScore) return;
    if (!buckets.has(partner.id)) {
      buckets.set(partner.id, { partner, points: [], roundIndices: [] });
    }
    const bucket = buckets.get(partner.id);
    bucket.points.push(me.totalPoints);
    bucket.roundIndices.push(idx);
  });

  const partners = [...buckets.values()].map(({ partner, points, roundIndices }) => {
    const avg = points.reduce((s, p) => s + p, 0) / points.length;
    return {
      partner,
      rounds: points.length,
      avgPlayerPoints: Math.round(avg * 10) / 10,
      delta: Math.round((avg - baseline) * 10) / 10,
      roundIndices,
      perRoundPoints: points,
    };
  }).sort((a, b) => b.avgPlayerPoints - a.avgPlayerPoints);

  return { baseline: Math.round(baseline * 10) / 10, partners };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "Stats: partner splits — per-player avg points by partner with baseline delta"
```

---

### Task 3: Crown badge in HomeScreen leaderboard

**Files:**
- Modify: `src/screens/HomeScreen.js` (import block + masters row render around line 463)

- [ ] **Step 1: Import the helper**

In the existing `tournamentStore` import block (around line 12-19), add `tournamentPlayerClinched`, `roundPairClinched` to the named imports.

- [ ] **Step 2: Compute clinch state in component body**

After the existing `bestWorstLeaderboard` useMemo (around line 285), add:

```js
const tournamentClinchedId = useMemo(() => (
  tournament ? tournamentPlayerClinched(tournament, leaderboardBestBall ? 'bestball' : 'stableford') : null
), [tournament, leaderboardBestBall]);

const roundClinchedPair = useMemo(() => (
  tournament && selectedRoundData
    ? roundPairClinched(selectedRoundData, tournament.players, settings, leaderboardBestBall ? 'bestball' : 'stableford')
    : null
), [tournament, selectedRoundData, settings, leaderboardBestBall]);
```

- [ ] **Step 3: Render crown next to leader**

In the `mastersNameCol` block (around line 469-472), inline the crown when the row matches:

```js
<View style={s.mastersNameCol}>
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Text style={[s.mastersName, i === 0 && { fontFamily: 'PlusJakartaSans-Bold' }]} numberOfLines={1}>
      {entry.player.name}
    </Text>
    {entry.player.id === tournamentClinchedId && (
      <Feather name="award" size={12} color="#ffd700" />
    )}
  </View>
  <Text style={s.mastersRoundSub}>
    R{selectedRound + 1} · {roundValue == null ? '—' : `${roundValue} ${roundUnit}`}
  </Text>
</View>
```

- [ ] **Step 4: Pass roundClinchedPair into RoundPage**

Find the `<RoundPage` JSX (around line 583) and add `roundClinchedPair={roundClinchedPair}` to the props. Add `roundClinchedPair` to the `RoundPage` parameter list.

In `StablefordRoundCard` and `BestBallRoundCard` (passed via render branch), pass the boolean `isClinched={roundClinchedPair === pi}` for each pair index. In their `pairNames` JSX render the crown next to it when `isClinched`.

- [ ] **Step 5: Manual check — start the dev server**

Run `npm run web`, open a tournament, score round 1 fully so a winner is defined → crown should appear.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "Home: crown badge for math-clinched player and round-winning pair"
```

---

### Task 4: Math-clinch popup in ScorecardScreen

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Import helper**

Add `roundPairClinched` to the existing `tournamentStore` import block.

- [ ] **Step 2: Track previous clinch state**

Inside the component, near the other `useRef`s, add:

```js
const lastClinchedPairRef = useRef(null);
```

Initialize once on mount based on the current round state (so re-mounts on a clinched round do not re-fire the popup):

```js
useEffect(() => {
  if (!round || !tournament) return;
  const mode = tournament.settings?.scoringMode ?? 'stableford';
  lastClinchedPairRef.current = roundPairClinched(round, tournament.players, tournament.settings, mode);
}, []); // intentional empty deps — initialize once
```

- [ ] **Step 3: Hook into goToNextHole**

Wrap the existing `goToNextHole` body so that, after the navigation step, it checks for a transition `null → pairIdx`:

```js
const goToNextHole = useCallback(() => {
  setCurrentHole((h) => Math.min(18, h + 1));
  if (!round || !tournament) return;
  const mode = tournament.settings?.scoringMode ?? 'stableford';
  const clinched = roundPairClinched(round, tournament.players, tournament.settings, mode);
  if (clinched != null && lastClinchedPairRef.current == null) {
    const pair = round.pairs[clinched];
    const names = pair.map((p) => p.name).join(' & ');
    const message = `${names} cannot be caught in this round.`;
    if (Platform.OS === 'web') window.alert(`🏆 Round clinched\n${message}`);
    else Alert.alert('🏆 Round clinched', message);
  }
  lastClinchedPairRef.current = clinched;
}, [round, tournament]);
```

(Adjust to whatever existing closure variables `goToNextHole` already references — the existing one wraps `setCurrentHole`. Preserve existing behavior, only add the post-step check.)

- [ ] **Step 4: Manual check**

Score a round so that on the last-but-one hole one pair becomes uncatchable. Tap "next hole" → popup fires. Go back, then forward again → no second popup.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "Scorecard: popup when a pair clinches the round on next-hole nav"
```

---

### Task 5: Running-score toggle in ScorecardScreen

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Add state + persistence**

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
const RUNNING_SCORE_KEY = '@scorecard_show_running_score';

const [showRunning, setShowRunning] = useState(false);
useEffect(() => {
  AsyncStorage.getItem(RUNNING_SCORE_KEY).then((v) => {
    if (v === '1') setShowRunning(true);
  });
}, []);
const toggleRunning = useCallback(() => {
  setShowRunning((v) => {
    const next = !v;
    AsyncStorage.setItem(RUNNING_SCORE_KEY, next ? '1' : '0').catch(() => {});
    return next;
  });
}, []);
```

- [ ] **Step 2: Add toggle button**

Find the scorecard header area and add a small `eye` / `eye-off` icon button using the existing `iconBtn` style. Put it next to the existing header controls. The icon flips between `eye` (off) and `eye-off` (on) — when ON, running scores are visible, so an "eye-off" icon means "tap to hide".

```js
<TouchableOpacity style={s.iconBtn} onPress={toggleRunning} activeOpacity={0.7}
  accessibilityLabel="Toggle running score">
  <Feather name={showRunning ? 'eye-off' : 'eye'} size={16} color={theme.accent.primary} />
</TouchableOpacity>
```

- [ ] **Step 3: Render running totals when on**

The screen already passes `playerTotals` to `HoleView` (line 584). Locate where each player's name is rendered in the per-hole panel and, gated on `showRunning`, render below it:

```js
{showRunning && (
  <Text style={[s.playerSubLine, { color: theme.text.muted, fontSize: 12 }]}>
    {playerTotals.find((t) => t.player.id === player.id)?.totalPoints ?? 0} pts
  </Text>
)}
```

If `playerSubLine` style does not exist, use an inline style.

- [ ] **Step 4: Manual check**

Toggle on → totals appear. Edit a stroke → totals update. Toggle off → hidden. Reload app → state persisted.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "Scorecard: toggle running per-player Stableford under each name"
```

---

### Task 6: Partner-splits section in StatsScreen Pairs tab

**Files:**
- Modify: `src/screens/StatsScreen.js`

- [ ] **Step 1: Import helper**

Add `playerPartnerSplits` to the existing `tournamentStore` import.

- [ ] **Step 2: Compute splits in PairsTab**

Inside `PairsTab` (line 1079), near the existing `pairs = pairPerformance(tournament)` call, add:

```js
const splits = selectedPlayer != null && players[selectedPlayer]
  ? playerPartnerSplits(tournament, players[selectedPlayer].id)
  : { baseline: 0, partners: [] };
```

- [ ] **Step 3: Add a section**

After the existing pair-performance card and before "Synergy" (find a stable insertion point in the JSX), add:

```js
<View style={s.card}>
  <View style={s.cardTitleRow}>
    <Text style={s.cardTitle}>PARTNER SPLITS · {firstName(players[selectedPlayer] ?? { name: '?' })}</Text>
    <Text style={[s.modeLabel, { color: theme.text.muted }]}>baseline {splits.baseline} pts</Text>
  </View>
  {splits.partners.length === 0 ? (
    <Text style={s.emptyHint}>No completed rounds with this player yet.</Text>
  ) : splits.partners.map((row) => {
    const tone = row.delta >= 2 ? 'excellent' : row.delta <= -2 ? 'poor' : 'neutral';
    const deltaColor = tone === 'excellent' ? theme.accent.primary
      : tone === 'poor' ? theme.destructive
      : theme.text.muted;
    return (
      <TouchableOpacity
        key={row.partner.id}
        style={s.splitRow}
        onPress={() => setSheet({
          title: `${players[selectedPlayer].name} with ${row.partner.name}`,
          subtitle: `${row.avgPlayerPoints} avg · ${row.rounds} round${row.rounds === 1 ? '' : 's'} · baseline ${splits.baseline}`,
          explainer: `Average individual Stableford points scored by ${players[selectedPlayer].name} when partnered with ${row.partner.name}, vs their overall ${splits.baseline} pts/round baseline.`,
          rows: row.perRoundPoints.map((pts, i) => ({
            key: `${row.partner.id}-${i}`,
            primary: `R${row.roundIndices[i] + 1}`,
            rightPrimary: `${pts} pts`,
          })),
        })}
        activeOpacity={0.7}
      >
        <Text style={s.splitName}>{row.partner.name}</Text>
        <Text style={s.splitRounds}>{row.rounds}r</Text>
        <Text style={s.splitAvg}>{row.avgPlayerPoints} pts</Text>
        <Text style={[s.splitDelta, { color: deltaColor }]}>
          {row.delta >= 0 ? '+' : ''}{row.delta}
        </Text>
      </TouchableOpacity>
    );
  })}
</View>
```

- [ ] **Step 4: Add styles**

Find `makeStyles` for StatsScreen (or wherever the component styles are defined) and add:

```js
splitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border.subtle },
splitName: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: t.text.primary, fontSize: 13 },
splitRounds: { width: 36, textAlign: 'right', color: t.text.muted, fontSize: 11, fontFamily: 'PlusJakartaSans-Medium' },
splitAvg: { width: 64, textAlign: 'right', color: t.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
splitDelta: { width: 50, textAlign: 'right', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13 },
emptyHint: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 12, paddingVertical: 12, textAlign: 'center' },
```

- [ ] **Step 5: Manual check**

Open Stats → Pairs → use the player chip to pick a player → list shows partners with rounds count, avg, signed delta. Tap a row → drill-down sheet shows per-round points.

- [ ] **Step 6: Commit**

```bash
git add src/screens/StatsScreen.js
git commit -m "Stats: partner splits in Pairs tab — avg per partner and delta vs baseline"
```

---

### Task 7: Push, PR, merge

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: PR**

```bash
gh pr create --title "Stats: math-clinch alerts, partner splits, scorecard running score" --body ...
```

- [ ] **Step 3: Merge**

```bash
gh pr merge <num> --merge
```

---

## Self-review notes

- All four spec features mapped to tasks.
- No placeholders.
- Helper signatures match between definitions (Task 1, Task 2) and call sites (Tasks 3-6).
- `mode` argument is consistent: `'stableford' | 'bestball'`.
- `roundPairLeaderboard` already exists — reused, not redefined.
- `calcBestWorstBall` returns `{ pair1, pair2, holes, bestBall, worstBall }` per existing code — Task 1 best-ball clinch reads `bw.bestBall.pair1` etc. ✓
