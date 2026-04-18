# Stats Drill-down, Hall of Shame & Pair Hole Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every numeric stat card in `StatsScreen` tappable for a drill-down, add a "Hall of Shame" tab, and add per-player best/worst-ball hole-wins to the Pairs tab.

**Architecture:** Extend `statsEngine.js` so each aggregate carries a `breakdown` array of the concrete holes/rounds that produced it. Add two new engine functions — `pairHoleWins` and `hallOfShame`. Introduce a single generic `StatDetailSheet` bottom-sheet component used by every tab. No new screens; all changes live inside `StatsScreen.js` and one new component file.

**Tech Stack:** React Native (Expo), React Native `Modal` for the bottom-sheet, `@expo/vector-icons` `Feather` for icons. No new dependencies.

**Non-git project:** Commit steps are replaced with **Verify** steps (manual smoke in the Expo app). The engineer should keep the Expo dev server running (`npm start` or `expo start`) and reload after each task.

**Spec:** `docs/superpowers/specs/2026-04-18-stats-drill-down-and-shame-design.md`

---

## File Structure

- **Modify:** `src/store/statsEngine.js` — Tasks 1–7. Each existing public function gains `breakdown` data alongside its scalar output. Two new exports (`pairHoleWins`, `hallOfShame`) are added.
- **Create:** `src/components/StatDetailSheet.js` — Task 8. Generic bottom-sheet rendering a title + row list.
- **Modify:** `src/screens/StatsScreen.js` — Tasks 9–13. Wire drill-downs on every numeric card, add the `Shame` tab, add the "Hole wins" section to Pairs.

All engine changes are **additive** — existing shape preserved so current UI keeps working mid-refactor.

---

## Task 1: Extend `playerStreaks` with per-streak breakdowns

**Files:**
- Modify: `src/store/statsEngine.js:57-87`

**Goal:** Return the concrete hole list that forms each of the three streaks (best par, best birdie, worst bogey) so the UI can drill down.

**Current output:**
```js
{ bestParStreak: 5, bestBirdieStreak: 2, worstBogeyStreak: 3 }
```

**New output (shape-compatible via numeric fields retained):**
```js
{
  bestParStreak: 5,           // kept for backward compat
  bestBirdieStreak: 2,
  worstBogeyStreak: 3,
  parStreakHoles: [{ roundIndex, courseName, holeNumber, par, strokes, points, vsPar }],
  birdieStreakHoles: [...],
  bogeyStreakHoles: [...],
}
```

- [ ] **Step 1: Replace `playerStreaks` with breakdown-aware implementation**

Replace lines 57–87 in `src/store/statsEngine.js` with:

```js
export function playerStreaks(tournament, playerId, { useNet = false } = {}) {
  // Flat list of hole entries in play order, across all rounds
  const entries = [];
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
      entries.push({
        roundIndex, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, strokes: sc, points, vsPar,
      });
    });
  });

  // Longest run matching a predicate — returns { count, holes: [entries] }
  const longestRun = (predicate) => {
    let bestCount = 0, bestStart = -1, bestEnd = -1;
    let curStart = -1;
    entries.forEach((e, i) => {
      if (predicate(e)) {
        if (curStart === -1) curStart = i;
        const curCount = i - curStart + 1;
        if (curCount > bestCount) { bestCount = curCount; bestStart = curStart; bestEnd = i; }
      } else {
        curStart = -1;
      }
    });
    return {
      count: bestCount,
      holes: bestCount > 0 ? entries.slice(bestStart, bestEnd + 1) : [],
    };
  };

  const par = longestRun(e => e.vsPar <= 0);
  const birdie = longestRun(e => e.vsPar <= -1);
  const bogey = longestRun(e => e.vsPar >= 1);

  return {
    bestParStreak: par.count,
    bestBirdieStreak: birdie.count,
    worstBogeyStreak: bogey.count,
    parStreakHoles: par.holes,
    birdieStreakHoles: birdie.holes,
    bogeyStreakHoles: bogey.holes,
  };
}
```

- [ ] **Step 2: Verify — Expo reload, open Stats → Players → streaks section**

Expected: the three numbers render identically to before (no UI wiring yet). No console errors.

---

## Task 2: Extend `playerScoreDistribution` with per-bucket hole lists

**Files:**
- Modify: `src/store/statsEngine.js:32-53`

**Goal:** For each bucket (eagles, birdies, pars, bogeys, doubles, worse), return the list of holes.

- [ ] **Step 1: Replace `playerScoreDistribution` with breakdown-aware implementation**

Replace lines 32–53 in `src/store/statsEngine.js` with:

```js
export function playerScoreDistribution(tournament, playerId, { useNet = false } = {}) {
  const dist = {
    eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worse: 0, total: 0,
    eagleHoles: [], birdieHoles: [], parHoles: [], bogeyHoles: [], doubleHoles: [], worseHoles: [],
  };
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
      const entry = {
        roundIndex, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, strokes: sc, points, vsPar,
      };
      dist.total++;
      if (vsPar <= -2) { dist.eagles++; dist.eagleHoles.push(entry); }
      else if (vsPar === -1) { dist.birdies++; dist.birdieHoles.push(entry); }
      else if (vsPar === 0) { dist.pars++; dist.parHoles.push(entry); }
      else if (vsPar === 1) { dist.bogeys++; dist.bogeyHoles.push(entry); }
      else if (vsPar === 2) { dist.doubles++; dist.doubleHoles.push(entry); }
      else { dist.worse++; dist.worseHoles.push(entry); }
    });
  });
  return dist;
}
```

- [ ] **Step 2: Verify — Expo reload, open Stats → Players**

Expected: distribution bars render identically. No console errors.

---

## Task 3: Extend `tournamentHighlights` with breakdowns

**Files:**
- Modify: `src/store/statsEngine.js:184-207`

**Goal:** Each highlight carries a `breakdown` array the UI can display.

- [ ] **Step 1: Replace `tournamentHighlights` with breakdown-aware implementation**

Replace lines 184–207 in `src/store/statsEngine.js` with:

```js
export function tournamentHighlights(tournament, { useNet = false } = {}) {
  let bestRound = null, mostBirdies = null, longestParStreak = null;

  tournament.players.forEach(p => {
    const history = playerRoundHistory(tournament, p.id);
    history.forEach(r => {
      if (!bestRound || r.points > bestRound.points) {
        const round = tournament.rounds[r.roundIndex];
        const handicap = getPlayingHandicap(round, p);
        const holes = round.holes
          .map(h => {
            const sc = round.scores?.[p.id]?.[h.number];
            if (!sc) return null;
            return {
              roundIndex: r.roundIndex, courseName: round.courseName,
              holeNumber: h.number, par: h.par, strokes: sc,
              points: calcStablefordPoints(h.par, sc, handicap, h.strokeIndex),
            };
          })
          .filter(Boolean);
        bestRound = { player: p, ...r, breakdown: holes };
      }
    });

    const dist = playerScoreDistribution(tournament, p.id, { useNet });
    const birdiesAndEagles = [...dist.eagleHoles, ...dist.birdieHoles];
    if (!mostBirdies || birdiesAndEagles.length > mostBirdies.count) {
      mostBirdies = { player: p, count: birdiesAndEagles.length, breakdown: birdiesAndEagles };
    }

    const streaks = playerStreaks(tournament, p.id, { useNet });
    if (!longestParStreak || streaks.bestParStreak > longestParStreak.count) {
      longestParStreak = { player: p, count: streaks.bestParStreak, breakdown: streaks.parStreakHoles };
    }
  });

  const holes = bestWorstHoles(tournament);

  return {
    bestRound,
    mostBirdies,
    longestParStreak,
    bestHole: holes.best[0] || null,
    worstHole: holes.worst[0] || null,
  };
}
```

- [ ] **Step 2: Verify — Expo reload, open Stats → Overview**

Expected: all highlight cards render identically. No console errors.

---

## Task 4: Extend `bestWorstHoles` with per-player scores

**Files:**
- Modify: `src/store/statsEngine.js:91-117`

**Goal:** Each hole entry includes the per-player scorecard for that hole.

- [ ] **Step 1: Replace `bestWorstHoles` with breakdown-aware implementation**

Replace lines 91–117 in `src/store/statsEngine.js` with:

```js
export function bestWorstHoles(tournament) {
  const holeMap = {};
  tournament.rounds.forEach((round, ri) => {
    if (!round.scores || Object.keys(round.scores).length === 0) return;
    round.holes.forEach(hole => {
      const key = `${ri}-${hole.number}`;
      let totalPts = 0, count = 0;
      const playerScores = [];
      tournament.players.forEach(p => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const handicap = getPlayingHandicap(round, p);
        const pts = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        totalPts += pts;
        count++;
        playerScores.push({ playerId: p.id, playerName: p.name, strokes: sc, points: pts });
      });
      if (count > 0) {
        holeMap[key] = {
          roundIndex: ri,
          holeNumber: hole.number,
          courseName: round.courseName,
          par: hole.par,
          si: hole.strokeIndex,
          avgPoints: +(totalPts / count).toFixed(2),
          playerScores,
        };
      }
    });
  });

  const all = Object.values(holeMap);
  const sorted = [...all].sort((a, b) => b.avgPoints - a.avgPoints);
  return {
    best: sorted.slice(0, 3),
    worst: sorted.slice(-3).reverse(),
  };
}
```

- [ ] **Step 2: Verify — Expo reload, open Stats → Holes**

Expected: easiest/hardest hole lists render identically. No console errors.

---

## Task 5: Extend `pairPerformance` with per-round breakdown

**Files:**
- Modify: `src/store/statsEngine.js:162-180`

**Goal:** Each pair carries an array of rounds with per-member points.

- [ ] **Step 1: Replace `pairPerformance` with breakdown-aware implementation**

Replace lines 162–180 in `src/store/statsEngine.js` with:

```js
export function pairPerformance(tournament) {
  const pairMap = {};
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.pairs || !round.scores || Object.keys(round.scores).length === 0) return;
    round.pairs.forEach(pair => {
      const key = [pair[0].id, pair[1].id].sort().join('-');
      if (!pairMap[key]) {
        pairMap[key] = { players: [pair[0], pair[1]], rounds: 0, totalPoints: 0, roundList: [] };
      }
      const results = roundPairLeaderboard(round, tournament.players);
      const match = results.find(r => r.members.some(m => m.player.id === pair[0].id));
      if (match) {
        pairMap[key].rounds++;
        pairMap[key].totalPoints += match.combinedPoints;
        pairMap[key].roundList.push({
          roundIndex,
          courseName: round.courseName,
          combinedPoints: match.combinedPoints,
          combinedStrokes: match.combinedStrokes,
          memberPoints: match.members.map(m => ({
            playerId: m.player.id,
            playerName: m.player.name,
            points: m.totalPoints,
          })),
        });
      }
    });
  });
  return Object.values(pairMap)
    .map(p => ({ ...p, avgPoints: p.rounds > 0 ? +(p.totalPoints / p.rounds).toFixed(1) : 0 }))
    .sort((a, b) => b.avgPoints - a.avgPoints);
}
```

- [ ] **Step 2: Verify — Expo reload, open Stats → Pairs**

Expected: pair chemistry list renders identically. No console errors.

---

## Task 6: Add `pairHoleWins` engine function

**Files:**
- Modify: `src/store/statsEngine.js` (append new export after `pairPerformance`)

**Goal:** Return per-player best-ball / worst-ball / total wins/ties/losses with a hole-by-hole breakdown.

**Attribution rules** (from spec):
- For each hole in each round that has two complete pairs and all four scores:
  - Compute each player's stableford points on that hole.
  - Best-ball contributors of a pair = members whose score equals max of the pair.
  - Worst-ball contributors of a pair = members whose score equals min of the pair.
  - Best-ball hole outcome: compare max(pair1) vs max(pair2) → `W | T | L` for each pair.
  - Worst-ball hole outcome: compare min(pair1) vs min(pair2) → `W | T | L` for each pair.
  - A player gets the best-ball credit (W/T/L) **only if they were a best-ball contributor** on that hole.
  - Same for worst-ball.
  - Totals are component-wise sums: `total.W = best.W + worst.W` etc.

- [ ] **Step 1: Append `pairHoleWins` at the end of `src/store/statsEngine.js`**

Add at the bottom of the file (after `tournamentHighlights`, before the end of file):

```js
// ── Pair Hole Wins (Best Ball / Worst Ball) ──

export function pairHoleWins(tournament) {
  const stats = {};
  tournament.players.forEach(p => {
    stats[p.id] = {
      player: p,
      best: { W: 0, T: 0, L: 0 },
      worst: { W: 0, T: 0, L: 0 },
      total: { W: 0, T: 0, L: 0 },
      breakdown: [],
    };
  });

  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores || !round.pairs || round.pairs.length < 2) return;
    const [pair1, pair2] = round.pairs;
    if (!pair1 || !pair2 || pair1.length < 2 || pair2.length < 2) return;

    const scoreOf = (playerId, hole) => {
      const player = tournament.players.find(x => x.id === playerId);
      if (!player) return null;
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return null;
      const handicap = getPlayingHandicap(round, player);
      return calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
    };

    round.holes.forEach(hole => {
      const p1a = scoreOf(pair1[0].id, hole);
      const p1b = scoreOf(pair1[1].id, hole);
      const p2a = scoreOf(pair2[0].id, hole);
      const p2b = scoreOf(pair2[1].id, hole);
      if (p1a === null || p1b === null || p2a === null || p2b === null) return;

      const pair1Max = Math.max(p1a, p1b);
      const pair1Min = Math.min(p1a, p1b);
      const pair2Max = Math.max(p2a, p2b);
      const pair2Min = Math.min(p2a, p2b);

      const bestOutcomePair1 = pair1Max > pair2Max ? 'W' : pair1Max < pair2Max ? 'L' : 'T';
      const bestOutcomePair2 = bestOutcomePair1 === 'W' ? 'L' : bestOutcomePair1 === 'L' ? 'W' : 'T';
      const worstOutcomePair1 = pair1Min > pair2Min ? 'W' : pair1Min < pair2Min ? 'L' : 'T';
      const worstOutcomePair2 = worstOutcomePair1 === 'W' ? 'L' : worstOutcomePair1 === 'L' ? 'W' : 'T';

      // Credit helper
      const credit = (playerId, pairScore, pairMax, pairMin, bestOutcome, worstOutcome, oppBest, oppWorst) => {
        const rec = stats[playerId];
        const entry = {
          roundIndex, courseName: round.courseName, holeNumber: hole.number, par: hole.par,
          playerPoints: pairScore, teamBest: pairMax, teamWorst: pairMin,
          oppBest, oppWorst,
          bestRole: null, bestOutcome: null,
          worstRole: null, worstOutcome: null,
        };
        if (pairScore === pairMax) {
          rec.best[bestOutcome]++;
          rec.total[bestOutcome]++;
          entry.bestRole = 'MB';
          entry.bestOutcome = bestOutcome;
        }
        if (pairScore === pairMin) {
          rec.worst[worstOutcome]++;
          rec.total[worstOutcome]++;
          entry.worstRole = 'PB';
          entry.worstOutcome = worstOutcome;
        }
        if (entry.bestRole || entry.worstRole) rec.breakdown.push(entry);
      };

      credit(pair1[0].id, p1a, pair1Max, pair1Min, bestOutcomePair1, worstOutcomePair1, pair2Max, pair2Min);
      credit(pair1[1].id, p1b, pair1Max, pair1Min, bestOutcomePair1, worstOutcomePair1, pair2Max, pair2Min);
      credit(pair2[0].id, p2a, pair2Max, pair2Min, bestOutcomePair2, worstOutcomePair2, pair1Max, pair1Min);
      credit(pair2[1].id, p2b, pair2Max, pair2Min, bestOutcomePair2, worstOutcomePair2, pair1Max, pair1Min);
    });
  });

  return Object.values(stats).sort((a, b) => b.total.W - a.total.W);
}
```

- [ ] **Step 2: Sanity-check math in a REPL-style comment**

Mental walkthrough (do not add to file): if pair1 = [A=3, B=2] and pair2 = [C=3, D=1] on a hole:
- pair1Max = 3 (both A tied? no, A=3 > B=2, so A is the max contributor alone).
- pair2Max = 3 (C).
- Best-ball outcome: pair1 T pair2 → A gets best.T, C gets best.T. Neither B nor D count (not max contributors).
- pair1Min = 2 (B), pair2Min = 1 (D). Pair1 wins worst → B gets worst.W, D gets worst.L.
- Totals: A 0W/1T/0L, B 1W/0T/0L, C 0W/1T/0L, D 0W/0T/1L.

Checks pass: credit only goes to contributors; totals are component-wise.

- [ ] **Step 3: Verify — Expo reload**

Expected: no crashes on import (function isn't called yet). No console errors.

---

## Task 7: Add `hallOfShame` engine function

**Files:**
- Modify: `src/store/statsEngine.js` (append new export)

**Goal:** Return six humorous shame metrics, each with a player, metric, and breakdown.

**Metrics:**
1. `tripleBogey` — single hole with the worst (strokes − par − netExtra). Ties → first found.
2. `shameStreak` — longest consecutive bogey-or-worse streak across all players.
3. `ceroPatatero` — longest consecutive 0-stableford-points streak across all players.
4. `regalo` — hole within a round where a player's stableford points were the lowest by the largest margin vs the other three players' average.
5. `desmoronamiento` — round where a player's `front9Points − back9Points` is largest (big drop in the back 9). Requires 18 holes played.
6. `bucketazo` — single hole with the highest absolute stroke count.

- [ ] **Step 1: Append `hallOfShame` at the end of `src/store/statsEngine.js`**

Add at the bottom of the file:

```js
// ── Hall of Shame ──

export function hallOfShame(tournament, { useNet = false } = {}) {
  const result = {
    tripleBogey: null,
    shameStreak: null,
    ceroPatatero: null,
    regalo: null,
    desmoronamiento: null,
    bucketazo: null,
  };

  // Flatten holes per player (preserving play order) so we can detect streaks
  const perPlayerEntries = {};
  tournament.players.forEach(p => { perPlayerEntries[p.id] = []; });
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    tournament.players.forEach(p => {
      if (!round.scores[p.id]) return;
      const handicap = getPlayingHandicap(round, p);
      round.holes.forEach(hole => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
        const vsPar = sc - extra - hole.par;
        const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
        perPlayerEntries[p.id].push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
          strokes: sc, vsPar, points,
        });
      });
    });
  });

  // 1. Triple Bogey Club — worst single hole by vsPar
  tournament.players.forEach(p => {
    perPlayerEntries[p.id].forEach(e => {
      if (!result.tripleBogey || e.vsPar > result.tripleBogey.vsPar) {
        result.tripleBogey = { player: p, ...e, breakdown: [e] };
      }
    });
  });

  // 2. Racha de la Vergüenza — longest bogey-or-worse streak
  tournament.players.forEach(p => {
    const entries = perPlayerEntries[p.id];
    let curStart = -1, bestCount = 0, bestStart = -1, bestEnd = -1;
    entries.forEach((e, i) => {
      if (e.vsPar >= 1) {
        if (curStart === -1) curStart = i;
        const curCount = i - curStart + 1;
        if (curCount > bestCount) { bestCount = curCount; bestStart = curStart; bestEnd = i; }
      } else {
        curStart = -1;
      }
    });
    if (bestCount > 0 && (!result.shameStreak || bestCount > result.shameStreak.count)) {
      result.shameStreak = {
        player: p,
        count: bestCount,
        breakdown: entries.slice(bestStart, bestEnd + 1),
      };
    }
  });

  // 3. Cero Patatero — longest 0-stableford-points streak
  tournament.players.forEach(p => {
    const entries = perPlayerEntries[p.id];
    let curStart = -1, bestCount = 0, bestStart = -1, bestEnd = -1;
    entries.forEach((e, i) => {
      if (e.points === 0) {
        if (curStart === -1) curStart = i;
        const curCount = i - curStart + 1;
        if (curCount > bestCount) { bestCount = curCount; bestStart = curStart; bestEnd = i; }
      } else {
        curStart = -1;
      }
    });
    if (bestCount > 0 && (!result.ceroPatatero || bestCount > result.ceroPatatero.count)) {
      result.ceroPatatero = {
        player: p,
        count: bestCount,
        breakdown: entries.slice(bestStart, bestEnd + 1),
      };
    }
  });

  // 4. El Regalo — hole where a player's stableford is lowest by the largest margin vs the average of the other three
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores) return;
    round.holes.forEach(hole => {
      const scores = tournament.players.map(p => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return null;
        const handicap = getPlayingHandicap(round, p);
        const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
        const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
        return { player: p, strokes: sc, points, netVsPar: sc - extra - hole.par };
      }).filter(Boolean);
      if (scores.length < 4) return;
      scores.forEach(entry => {
        const others = scores.filter(s => s.player.id !== entry.player.id);
        const othersAvg = others.reduce((s, o) => s + o.points, 0) / others.length;
        const gap = othersAvg - entry.points;
        if (!result.regalo || gap > result.regalo.gap) {
          result.regalo = {
            player: entry.player,
            gap: +gap.toFixed(2),
            playerPoints: entry.points,
            othersAvg: +othersAvg.toFixed(2),
            roundIndex,
            courseName: round.courseName,
            holeNumber: hole.number,
            par: hole.par,
            breakdown: scores.map(s => ({
              playerId: s.player.id,
              playerName: s.player.name,
              strokes: s.strokes,
              points: s.points,
            })),
          };
        }
      });
    });
  });

  // 5. El Desmoronamiento — round where front9 − back9 points is largest (needs 18 holes played)
  tournament.rounds.forEach((round, roundIndex) => {
    if (!round.scores || round.holes.length < 18) return;
    tournament.players.forEach(p => {
      if (!round.scores[p.id]) return;
      const handicap = getPlayingHandicap(round, p);
      let front = 0, back = 0, frontComplete = 0, backComplete = 0;
      const holeEntries = [];
      round.holes.forEach(hole => {
        const sc = round.scores[p.id]?.[hole.number];
        if (!sc) return;
        const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
        if (hole.number <= 9) { front += points; frontComplete++; } else { back += points; backComplete++; }
        holeEntries.push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, strokes: sc, points,
        });
      });
      if (frontComplete < 9 || backComplete < 9) return;
      const drop = front - back;
      if (drop > 0 && (!result.desmoronamiento || drop > result.desmoronamiento.drop)) {
        result.desmoronamiento = {
          player: p,
          drop,
          front, back,
          roundIndex,
          courseName: round.courseName,
          breakdown: holeEntries,
        };
      }
    });
  });

  // 6. Bucketazo — highest raw stroke count on any hole
  tournament.players.forEach(p => {
    perPlayerEntries[p.id].forEach(e => {
      if (!result.bucketazo || e.strokes > result.bucketazo.strokes) {
        result.bucketazo = { player: p, ...e, breakdown: [e] };
      }
    });
  });

  return result;
}
```

- [ ] **Step 2: Mental sanity check**

- If any round has fewer than 4 scored players on a hole, `regalo` skips it.
- If a round has fewer than 18 holes or incomplete 9s, `desmoronamiento` skips it.
- All other metrics require at least one scored hole.
- Each metric's field is `null` when no qualifying data exists, letting the UI hide the card.

- [ ] **Step 3: Verify — Expo reload**

Expected: no crashes on import. No console errors.

---

## Task 8: Create `StatDetailSheet` bottom-sheet component

**Files:**
- Create: `src/components/StatDetailSheet.js`

**Goal:** One reusable bottom-sheet component that renders `title`, optional `subtitle`, and a scrollable row list. Used by every drill-down.

**Props:**
- `visible: boolean`
- `onClose: () => void`
- `title: string`
- `subtitle?: string`
- `rows: Array<{ key, primary, secondary?, rightPrimary?, rightSecondary?, tone? }>`
  - `tone: 'excellent' | 'good' | 'neutral' | 'poor'` (optional; used for `rightPrimary` color)

- [ ] **Step 1: Create the component file**

Create `src/components/StatDetailSheet.js`:

```js
import React from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function StatDetailSheet({ visible, onClose, title, subtitle, rows = [] }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const toneColor = (tone) => {
    if (!tone) return theme.text.primary;
    return theme.scoreColor(tone);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={s.sheet}>
        <View style={s.handle} />
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{title}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          {rows.length === 0 ? (
            <Text style={s.empty}>No details available.</Text>
          ) : rows.map(r => (
            <View key={r.key} style={s.row}>
              <View style={s.rowLeft}>
                <Text style={s.rowPrimary}>{r.primary}</Text>
                {r.secondary ? <Text style={s.rowSecondary}>{r.secondary}</Text> : null}
              </View>
              <View style={s.rowRight}>
                {r.rightPrimary != null ? (
                  <Text style={[s.rowRightPrimary, { color: toneColor(r.tone) }]}>{r.rightPrimary}</Text>
                ) : null}
                {r.rightSecondary ? <Text style={s.rowRightSecondary}>{r.rightSecondary}</Text> : null}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: t.bg.primary,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 32,
    borderTopWidth: 1, borderColor: t.border.default,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.border.default,
    alignSelf: 'center', marginTop: 10,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  title: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 17 },
  subtitle: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 12, marginTop: 3 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  empty: { fontFamily: 'PlusJakartaSans-Regular', color: t.text.muted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border.subtle,
  },
  rowLeft: { flex: 1, paddingRight: 8 },
  rowPrimary: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.primary, fontSize: 13 },
  rowSecondary: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowRightPrimary: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  rowRightSecondary: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.muted, fontSize: 11, marginTop: 2 },
});
```

- [ ] **Step 2: Verify — Expo reload**

Expected: no crashes on import (nothing renders it yet). No console errors.

---

## Task 9: Wire drill-down into Overview tab

**Files:**
- Modify: `src/screens/StatsScreen.js`

**Goal:** Make all five Overview highlight cards tappable and open `StatDetailSheet` with the proper rows.

- [ ] **Step 1: Add imports**

At the top of `src/screens/StatsScreen.js`, change:

```js
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Switch } from 'react-native';
```

to:

```js
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, FlatList, Switch } from 'react-native';
import StatDetailSheet from '../components/StatDetailSheet';
```

Also add `hallOfShame, pairHoleWins` to the `statsEngine` import so later tasks don't have to re-do it:

Change:
```js
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
} from '../store/statsEngine';
```

to:

```js
import {
  playerRoundHistory, playerAvgStableford, playerScoreDistribution,
  playerStreaks, bestWorstHoles, holeDifficultyMap,
  headToHead, pairPerformance, tournamentHighlights,
  hallOfShame, pairHoleWins,
} from '../store/statsEngine';
```

- [ ] **Step 2: Refactor `HighlightCard` to accept `onPress` and extend `OverviewTab` with sheet state**

Replace the current `OverviewTab` and `HighlightCard` (lines 74–115) with:

```js
function OverviewTab({ tournament, useNet, theme, s }) {
  const highlights = tournamentHighlights(tournament, { useNet });
  const modeLabel = useNet ? 'net' : 'gross';
  const [sheet, setSheet] = useState(null);

  if (!highlights.bestRound) {
    return <Text style={s.emptyText}>No scores entered yet. Play a round first!</Text>;
  }

  const openBestRound = () => {
    const h = highlights.bestRound;
    setSheet({
      title: `${h.player.name} — ${h.points} pts`,
      subtitle: `Best round · ${h.courseName} · ${modeLabel}`,
      rows: h.breakdown.map(b => ({
        key: `${b.holeNumber}`,
        primary: `Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  const openBirdies = () => {
    const h = highlights.mostBirdies;
    setSheet({
      title: `${h.player.name} — ${h.count} birdies+`,
      subtitle: `Birdies & Eagles · ${modeLabel}`,
      rows: h.breakdown.map((b, i) => ({
        key: `${b.roundIndex}-${b.holeNumber}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: b.vsPar <= -2 ? 'Eagle' : 'Birdie',
        tone: 'excellent',
      })),
    });
  };

  const openParStreak = () => {
    const h = highlights.longestParStreak;
    setSheet({
      title: `${h.player.name} — ${h.count} hoyos`,
      subtitle: `Longest par streak · ${modeLabel}`,
      rows: h.breakdown.map((b, i) => ({
        key: `${b.roundIndex}-${b.holeNumber}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.vsPar <= -1 ? 'excellent' : 'good',
      })),
    });
  };

  const openHole = (h, label) => {
    setSheet({
      title: `Hoyo ${h.holeNumber} · ${h.courseName}`,
      subtitle: `${label} · Par ${h.par} · ${h.avgPoints} avg pts`,
      rows: h.playerScores.map(ps => ({
        key: ps.playerId,
        primary: ps.playerName,
        secondary: `${ps.strokes} golpes`,
        rightPrimary: `${ps.points} pts`,
        tone: ps.points >= 3 ? 'excellent' : ps.points === 2 ? 'good' : ps.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  return (
    <View>
      <Text style={s.sectionTitle}>TOURNAMENT HIGHLIGHTS</Text>
      {highlights.bestRound && (
        <HighlightCard icon="award" label="Best Round" value={`${highlights.bestRound.player.name} — ${highlights.bestRound.points} pts`} sub={highlights.bestRound.courseName} onPress={openBestRound} theme={theme} s={s} />
      )}
      {highlights.mostBirdies && highlights.mostBirdies.count > 0 && (
        <HighlightCard icon="zap" label="Most Birdies+" value={`${highlights.mostBirdies.player.name} — ${highlights.mostBirdies.count}`} sub={`Birdies + Eagles (${modeLabel})`} onPress={openBirdies} theme={theme} s={s} />
      )}
      {highlights.longestParStreak && highlights.longestParStreak.count > 1 && (
        <HighlightCard icon="trending-up" label="Longest Par Streak" value={`${highlights.longestParStreak.player.name} — ${highlights.longestParStreak.count} holes`} sub={`Consecutive holes at par or better (${modeLabel})`} onPress={openParStreak} theme={theme} s={s} />
      )}
      {highlights.bestHole && (
        <HighlightCard icon="thumbs-up" label="Easiest Hole" value={`Hole ${highlights.bestHole.holeNumber} — ${highlights.bestHole.avgPoints} avg pts`} sub={`${highlights.bestHole.courseName} · Par ${highlights.bestHole.par}`} onPress={() => openHole(highlights.bestHole, 'Easiest Hole')} theme={theme} s={s} />
      )}
      {highlights.worstHole && (
        <HighlightCard icon="thumbs-down" label="Hardest Hole" value={`Hole ${highlights.worstHole.holeNumber} — ${highlights.worstHole.avgPoints} avg pts`} sub={`${highlights.worstHole.courseName} · Par ${highlights.worstHole.par}`} onPress={() => openHole(highlights.worstHole, 'Hardest Hole')} theme={theme} s={s} />
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}

function HighlightCard({ icon, label, value, sub, onPress, theme, s }) {
  const Container = onPress ? TouchableOpacity : View;
  return (
    <Container style={s.highlightCard} onPress={onPress} activeOpacity={0.7}>
      <View style={s.highlightIcon}>
        <Feather name={icon} size={20} color={theme.accent.primary} />
      </View>
      <View style={s.highlightContent}>
        <Text style={s.highlightLabel}>{label}</Text>
        <Text style={s.highlightValue}>{value}</Text>
        {sub && <Text style={s.highlightSub}>{sub}</Text>}
      </View>
      {onPress && <Feather name="chevron-right" size={18} color={theme.text.muted} />}
    </Container>
  );
}
```

- [ ] **Step 3: Verify — Expo reload, open Stats → Overview**

Expected: each highlight card shows a chevron on the right. Tapping opens a bottom-sheet with the drill-down rows. Backdrop tap closes the sheet. No console errors.

---

## Task 10: Wire drill-down into Players tab (streaks + distribution + history)

**Files:**
- Modify: `src/screens/StatsScreen.js`

**Goal:** Each streak number is tappable → drill-down of the streak's holes. Each distribution bar is tappable → drill-down of holes in that bucket. Each round history row is tappable → drill-down of that round's holes.

- [ ] **Step 1: Replace `PlayersTab` body with sheet-aware version**

Replace `PlayersTab` (lines 118–194) with:

```js
function PlayersTab({ tournament, players, selectedPlayer, setSelectedPlayer, useNet, theme, s }) {
  const player = players[selectedPlayer];
  const [sheet, setSheet] = useState(null);
  if (!player) return null;

  const dist = playerScoreDistribution(tournament, player.id, { useNet });
  const streaks = playerStreaks(tournament, player.id, { useNet });
  const history = playerRoundHistory(tournament, player.id);
  const avg = playerAvgStableford(tournament, player.id);
  const modeLabel = useNet ? 'net' : 'gross';

  const holeRows = (holes, toneFn) => holes.map((b, i) => ({
    key: `${b.roundIndex}-${b.holeNumber}-${i}`,
    primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
    secondary: `Par ${b.par} · ${b.strokes} golpes`,
    rightPrimary: `${b.points} pts`,
    tone: toneFn(b),
  }));

  const defaultTone = (b) => b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor';

  const openStreak = (title, holes, toneFn) => setSheet({
    title,
    subtitle: `${player.name} · ${modeLabel}`,
    rows: holeRows(holes, toneFn),
  });

  const openBucket = (label, holes) => {
    if (holes.length === 0) return;
    setSheet({
      title: `${player.name} — ${holes.length} ${label}`,
      subtitle: `${modeLabel}`,
      rows: holeRows(holes, defaultTone),
    });
  };

  const openRound = (r) => {
    const round = tournament.rounds[r.roundIndex];
    const handicap = getPlayingHandicapSafe(round, player);
    const rows = round.holes.map(h => {
      const sc = round.scores?.[player.id]?.[h.number];
      if (!sc) return null;
      const pts = calcStablefordPointsSafe(h.par, sc, handicap, h.strokeIndex);
      return {
        key: `${h.number}`,
        primary: `Hoyo ${h.number}`,
        secondary: `Par ${h.par} · ${sc} golpes`,
        rightPrimary: `${pts} pts`,
        tone: pts >= 3 ? 'excellent' : pts === 2 ? 'good' : pts === 1 ? 'neutral' : 'poor',
      };
    }).filter(Boolean);
    setSheet({
      title: `R${r.roundIndex + 1} · ${r.courseName}`,
      subtitle: `${player.name} — ${r.points} pts · ${r.strokes} golpes`,
      rows,
    });
  };

  return (
    <View>
      <View style={s.playerSelector}>
        {players.map((p, i) => (
          <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
            <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {dist.total === 0 ? (
        <Text style={s.emptyText}>No scores for {player.name} yet.</Text>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.cardLabel}>Average per Round</Text>
            <Text style={s.bigNumber}>{avg}</Text>
            <Text style={s.cardSub}>Stableford points</Text>
          </View>

          <Text style={s.sectionTitle}>SCORE DISTRIBUTION</Text>
          <View style={s.card}>
            <View style={s.distRow}>
              <DistBar label="Eagle+" count={dist.eagles} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('Eagles', dist.eagleHoles)} s={s} />
              <DistBar label="Birdie" count={dist.birdies} total={dist.total} color={theme.scoreColor('excellent')} onPress={() => openBucket('Birdies', dist.birdieHoles)} s={s} />
              <DistBar label="Par" count={dist.pars} total={dist.total} color={theme.scoreColor('good')} onPress={() => openBucket('Pares', dist.parHoles)} s={s} />
              <DistBar label="Bogey" count={dist.bogeys} total={dist.total} color={theme.scoreColor('neutral')} onPress={() => openBucket('Bogeys', dist.bogeyHoles)} s={s} />
              <DistBar label="Dbl+" count={dist.doubles + dist.worse} total={dist.total} color={theme.scoreColor('poor')} onPress={() => openBucket('Dobles o peor', [...dist.doubleHoles, ...dist.worseHoles])} s={s} />
            </View>
          </View>

          <Text style={s.sectionTitle}>STREAKS</Text>
          <View style={s.card}>
            <View style={s.streakRow}>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bestParStreak > 0 && openStreak(`Par streak — ${streaks.bestParStreak} hoyos`, streaks.parStreakHoles, defaultTone)} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestParStreak}</Text>
                <Text style={s.streakLabel}>Par streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.bestBirdieStreak > 0 && openStreak(`Birdie streak — ${streaks.bestBirdieStreak} hoyos`, streaks.birdieStreakHoles, () => 'excellent')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('excellent') }]}>{streaks.bestBirdieStreak}</Text>
                <Text style={s.streakLabel}>Birdie streak</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.streakItem} onPress={() => streaks.worstBogeyStreak > 0 && openStreak(`Bogey streak — ${streaks.worstBogeyStreak} hoyos`, streaks.bogeyStreakHoles, () => 'poor')} activeOpacity={0.7}>
                <Text style={[s.streakNumber, { color: theme.scoreColor('poor') }]}>{streaks.worstBogeyStreak}</Text>
                <Text style={s.streakLabel}>Bogey streak</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={s.sectionTitle}>ROUND HISTORY</Text>
          {history.map((r, i) => (
            <TouchableOpacity key={i} style={s.historyRow} onPress={() => openRound(r)} activeOpacity={0.7}>
              <Text style={s.historyRound}>R{r.roundIndex + 1}</Text>
              <Text style={s.historyCourse}>{r.courseName}</Text>
              <Text style={s.historyPts}>{r.points} pts</Text>
              <Text style={s.historyStr}>{r.strokes} str</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}
```

- [ ] **Step 2: Replace `DistBar` to accept `onPress`**

Replace `DistBar` (lines 196–207) with:

```js
function DistBar({ label, count, total, color, onPress, s }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const Container = onPress && count > 0 ? TouchableOpacity : View;
  return (
    <Container style={s.distItem} onPress={onPress} activeOpacity={0.7}>
      <View style={s.distBarBg}>
        <View style={[s.distBarFill, { height: `${Math.max(pct, 2)}%`, backgroundColor: color }]} />
      </View>
      <Text style={s.distCount}>{count}</Text>
      <Text style={s.distLabel}>{label}</Text>
    </Container>
  );
}
```

- [ ] **Step 3: Add imports for `getPlayingHandicap` and `calcStablefordPoints` (aliased)**

The `openRound` helper uses two functions that currently aren't imported into `StatsScreen.js`. Add to the top imports:

```js
import { getPlayingHandicap, calcStablefordPoints } from '../store/tournamentStore';
```

And in the `openRound` helper, replace `getPlayingHandicapSafe` with `getPlayingHandicap` and `calcStablefordPointsSafe` with `calcStablefordPoints`:

```js
  const openRound = (r) => {
    const round = tournament.rounds[r.roundIndex];
    const handicap = getPlayingHandicap(round, player);
    const rows = round.holes.map(h => {
      const sc = round.scores?.[player.id]?.[h.number];
      if (!sc) return null;
      const pts = calcStablefordPoints(h.par, sc, handicap, h.strokeIndex);
      return {
        key: `${h.number}`,
        primary: `Hoyo ${h.number}`,
        secondary: `Par ${h.par} · ${sc} golpes`,
        rightPrimary: `${pts} pts`,
        tone: pts >= 3 ? 'excellent' : pts === 2 ? 'good' : pts === 1 ? 'neutral' : 'poor',
      };
    }).filter(Boolean);
    setSheet({
      title: `R${r.roundIndex + 1} · ${r.courseName}`,
      subtitle: `${player.name} — ${r.points} pts · ${r.strokes} golpes`,
      rows,
    });
  };
```

- [ ] **Step 4: Verify — Expo reload, open Stats → Players**

Expected: tap each streak number → bottom-sheet shows hole list. Tap each distribution bar (non-zero) → sheet shows hole list. Tap each round row → sheet shows 18-hole breakdown. Zero-count streaks/bars do nothing. No console errors.

---

## Task 11: Wire drill-down into Holes tab (best/worst hole cards)

**Files:**
- Modify: `src/screens/StatsScreen.js`

**Goal:** Each easiest/hardest hole card is tappable and opens the per-player scorecard for that hole.

- [ ] **Step 1: Replace `HolesTab` with sheet-aware version**

Replace `HolesTab` (lines 210–295) with:

```js
function HolesTab({ tournament, completedRounds, theme, s }) {
  const bw = bestWorstHoles(tournament);
  const firstRoundIdx = tournament.rounds.indexOf(completedRounds[0]);
  const heatmap = firstRoundIdx >= 0 ? holeDifficultyMap(tournament, firstRoundIdx) : [];
  const [sheet, setSheet] = useState(null);

  const openHole = (h, label) => setSheet({
    title: `Hoyo ${h.holeNumber} · ${h.courseName}`,
    subtitle: `${label} · Par ${h.par} · ${h.avgPoints} avg pts`,
    rows: h.playerScores.map(ps => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: `${ps.strokes} golpes`,
      rightPrimary: `${ps.points} pts`,
      tone: ps.points >= 3 ? 'excellent' : ps.points === 2 ? 'good' : ps.points === 1 ? 'neutral' : 'poor',
    })),
  });

  return (
    <View>
      {bw.best.length > 0 && (
        <>
          <Text style={s.sectionTitle}>EASIEST HOLES</Text>
          {bw.best.map((h, i) => (
            <TouchableOpacity key={`b${i}`} style={s.holeCard} onPress={() => openHole(h, 'Easiest Hole')} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('excellent') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('excellent') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('excellent') }]}>{h.avgPoints} avg</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {bw.worst.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HARDEST HOLES</Text>
          {bw.worst.map((h, i) => (
            <TouchableOpacity key={`w${i}`} style={s.holeCard} onPress={() => openHole(h, 'Hardest Hole')} activeOpacity={0.7}>
              <View style={[s.holeRank, { backgroundColor: theme.scoreColor('poor') + '20' }]}>
                <Text style={[s.holeRankText, { color: theme.scoreColor('poor') }]}>#{i + 1}</Text>
              </View>
              <View style={s.holeInfo}>
                <Text style={s.holeName}>Hole {h.holeNumber} · Par {h.par}</Text>
                <Text style={s.holeCourse}>{h.courseName}</Text>
              </View>
              <Text style={[s.holeAvg, { color: theme.scoreColor('poor') }]}>{h.avgPoints} avg</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {heatmap.length > 0 && (
        <>
          <Text style={s.sectionTitle}>HOLE HEATMAP — {completedRounds[0]?.courseName}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={s.heatRow}>
                <Text style={[s.heatCell, s.heatHeader]}>Hole</Text>
                {tournament.players.map(p => (
                  <Text key={p.id} style={[s.heatCell, s.heatHeader]}>{p.name.split(' ')[0]}</Text>
                ))}
                <Text style={[s.heatCell, s.heatHeader]}>Avg</Text>
              </View>
              {heatmap.map(h => (
                <View key={h.holeNumber} style={s.heatRow}>
                  <Text style={[s.heatCell, s.heatHoleNum]}>{h.holeNumber}</Text>
                  {tournament.players.map(p => {
                    const ps = h.playerScores.find(x => x.playerId === p.id);
                    const pts = ps?.points ?? '-';
                    const color = pts === '-' ? theme.text.muted
                      : pts >= 3 ? theme.scoreColor('excellent')
                      : pts === 2 ? theme.scoreColor('good')
                      : pts === 1 ? theme.scoreColor('neutral')
                      : theme.scoreColor('poor');
                    return (
                      <View key={p.id} style={[s.heatCell, s.heatValue, { backgroundColor: color + '18' }]}>
                        <Text style={[s.heatValueText, { color }]}>{pts}</Text>
                      </View>
                    );
                  })}
                  <View style={[s.heatCell, s.heatValue]}>
                    <Text style={s.heatAvgText}>{h.avgPoints}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      )}

      {bw.best.length === 0 && <Text style={s.emptyText}>No scores entered yet.</Text>}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}
```

- [ ] **Step 2: Verify — Expo reload, open Stats → Holes**

Expected: each easiest/hardest card tappable, opens sheet with all 4 players' scores for that hole. Heatmap unchanged. No console errors.

---

## Task 12: Add `Shame` tab with drill-downs and gross/net toggle support

**Files:**
- Modify: `src/screens/StatsScreen.js`

**Goal:** A 5th tab "Shame" with the six Hall of Shame cards, each tappable, honoring the gross/net toggle.

- [ ] **Step 1: Add `Shame` to the tabs list and update the gross/net toggle visibility**

Find this line (near the top of the component):

```js
const TABS = ['Overview', 'Players', 'Holes', 'Pairs'];
```

Replace with:

```js
const TABS = ['Overview', 'Players', 'Holes', 'Pairs', 'Shame'];
```

Find the gross/net toggle gate:

```js
{(tab === 0 || tab === 1) && (
```

Replace with (include `tab === 4` so the toggle also shows on Shame):

```js
{(tab === 0 || tab === 1 || tab === 4) && (
```

Add a 5th render block under the existing four:

Find:
```js
        {tab === 3 && <PairsTab tournament={tournament} players={players} h2hPlayer={h2hPlayer} setH2hPlayer={setH2hPlayer} selectedPlayer={selectedPlayer} setSelectedPlayer={setSelectedPlayer} theme={theme} s={s} />}
```

Add immediately after it:

```js
        {tab === 4 && <ShameTab tournament={tournament} useNet={useNet} theme={theme} s={s} />}
```

- [ ] **Step 2: Implement `ShameTab`**

Add this function above the `// ── Styles ──` comment (near the end of the file, before `const makeStyles`):

```js
// ── Shame Tab ──

function ShameTab({ tournament, useNet, theme, s }) {
  const shame = hallOfShame(tournament, { useNet });
  const [sheet, setSheet] = useState(null);
  const modeLabel = useNet ? 'net' : 'gross';

  const holeRows = (holes) => holes.map((b, i) => ({
    key: `${b.roundIndex}-${b.holeNumber}-${i}`,
    primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
    secondary: `Par ${b.par} · ${b.strokes} golpes`,
    rightPrimary: `${b.points} pts`,
    tone: b.points === 0 ? 'poor' : b.vsPar >= 1 ? 'neutral' : 'good',
  }));

  const openTripleBogey = () => {
    const x = shame.tripleBogey;
    setSheet({
      title: `${x.player.name} — +${x.vsPar} sobre par`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · Hoyo ${x.holeNumber} · ${modeLabel}`,
      rows: [{
        key: 'sole',
        primary: `Par ${x.par} · SI ${x.si}`,
        secondary: `${x.strokes} golpes`,
        rightPrimary: `${x.points} pts`,
        tone: 'poor',
      }],
    });
  };

  const openShameStreak = () => {
    const x = shame.shameStreak;
    setSheet({
      title: `${x.player.name} — ${x.count} bogeys+ seguidos`,
      subtitle: `Racha de la vergüenza · ${modeLabel}`,
      rows: holeRows(x.breakdown),
    });
  };

  const openCero = () => {
    const x = shame.ceroPatatero;
    setSheet({
      title: `${x.player.name} — ${x.count} hoyos a 0 pts`,
      subtitle: `Cero patatero · ${modeLabel}`,
      rows: holeRows(x.breakdown),
    });
  };

  const openRegalo = () => {
    const x = shame.regalo;
    setSheet({
      title: `${x.player.name} — ${x.playerPoints} vs avg ${x.othersAvg}`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · Hoyo ${x.holeNumber} · ${modeLabel}`,
      rows: x.breakdown.map(b => ({
        key: b.playerId,
        primary: b.playerName,
        secondary: `${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.playerId === x.player.id ? 'poor' : b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  const openDesmoronamiento = () => {
    const x = shame.desmoronamiento;
    setSheet({
      title: `${x.player.name} — ${x.front} / ${x.back}`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · caída de ${x.drop} pts · ${modeLabel}`,
      rows: x.breakdown.map(b => ({
        key: `${b.holeNumber}`,
        primary: `Hoyo ${b.holeNumber} ${b.holeNumber <= 9 ? '(ida)' : '(vuelta)'}`,
        secondary: `Par ${b.par} · ${b.strokes} golpes`,
        rightPrimary: `${b.points} pts`,
        tone: b.points >= 3 ? 'excellent' : b.points === 2 ? 'good' : b.points === 1 ? 'neutral' : 'poor',
      })),
    });
  };

  const openBucketazo = () => {
    const x = shame.bucketazo;
    setSheet({
      title: `${x.player.name} — ${x.strokes} golpes en un hoyo`,
      subtitle: `R${x.roundIndex + 1} · ${x.courseName} · Hoyo ${x.holeNumber} · ${modeLabel}`,
      rows: [{
        key: 'sole',
        primary: `Par ${x.par} · SI ${x.si}`,
        secondary: `${x.strokes} golpes · +${x.vsPar} sobre par`,
        rightPrimary: `${x.points} pts`,
        tone: 'poor',
      }],
    });
  };

  const any = shame.tripleBogey || shame.shameStreak || shame.ceroPatatero || shame.regalo || shame.desmoronamiento || shame.bucketazo;

  return (
    <View>
      {!any && <Text style={s.emptyText}>No hay suficientes datos todavía. ¡Juega alguna ronda primero!</Text>}

      {shame.tripleBogey && (
        <HighlightCard icon="alert-triangle" label="🏌️ Triple Bogey Club" value={`${shame.tripleBogey.player.name} — +${shame.tripleBogey.vsPar} sobre par`} sub={`${shame.tripleBogey.courseName} · Hoyo ${shame.tripleBogey.holeNumber}`} onPress={openTripleBogey} theme={theme} s={s} />
      )}
      {shame.shameStreak && shame.shameStreak.count > 1 && (
        <HighlightCard icon="trending-down" label="💀 Racha de la Vergüenza" value={`${shame.shameStreak.player.name} — ${shame.shameStreak.count} bogeys+`} sub={`Consecutivos (${modeLabel})`} onPress={openShameStreak} theme={theme} s={s} />
      )}
      {shame.ceroPatatero && shame.ceroPatatero.count > 0 && (
        <HighlightCard icon="minus-circle" label="🕳️ Cero Patatero" value={`${shame.ceroPatatero.player.name} — ${shame.ceroPatatero.count} hoyos`} sub={`Sin sumar puntos (${modeLabel})`} onPress={openCero} theme={theme} s={s} />
      )}
      {shame.regalo && (
        <HighlightCard icon="gift" label="🎁 El Regalo" value={`${shame.regalo.player.name} — brecha ${shame.regalo.gap} pts`} sub={`${shame.regalo.courseName} · Hoyo ${shame.regalo.holeNumber}`} onPress={openRegalo} theme={theme} s={s} />
      )}
      {shame.desmoronamiento && (
        <HighlightCard icon="activity" label="📉 El Desmoronamiento" value={`${shame.desmoronamiento.player.name} — caída ${shame.desmoronamiento.drop} pts`} sub={`${shame.desmoronamiento.courseName} · ida ${shame.desmoronamiento.front} vs vuelta ${shame.desmoronamiento.back}`} onPress={openDesmoronamiento} theme={theme} s={s} />
      )}
      {shame.bucketazo && (
        <HighlightCard icon="flag" label="🪣 El Bucketazo" value={`${shame.bucketazo.player.name} — ${shame.bucketazo.strokes} golpes`} sub={`${shame.bucketazo.courseName} · Hoyo ${shame.bucketazo.holeNumber}`} onPress={openBucketazo} theme={theme} s={s} />
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}
```

- [ ] **Step 3: Verify — Expo reload, open Stats → Shame**

Expected: tab appears as 5th chip. Up to 6 cards render (missing data hides the card). Each tappable opens drill-down. Gross/Net toggle visible and switches values. No console errors.

---

## Task 13: Add "Hole Wins on Points" section to Pairs tab (and make H2H card drillable)

**Files:**
- Modify: `src/screens/StatsScreen.js`

**Goal:** New section in Pairs tab showing per-player best-ball / worst-ball / total W-T-L with drill-down per row. Also make the H2H result card tappable.

- [ ] **Step 1: Replace `PairsTab` with expanded version**

Replace `PairsTab` (lines 298–370) with:

```js
function PairsTab({ tournament, players, h2hPlayer, setH2hPlayer, selectedPlayer, setSelectedPlayer, theme, s }) {
  const pairs = pairPerformance(tournament);
  const holeWins = pairHoleWins(tournament);
  const p1 = players[selectedPlayer];
  const p2Idx = h2hPlayer >= players.length ? 0 : h2hPlayer;
  const p2 = players[p2Idx];
  const h2h = p1 && p2 && p1.id !== p2.id ? headToHead(tournament, p1.id, p2.id) : null;
  const [sheet, setSheet] = useState(null);

  const openPair = (pair) => setSheet({
    title: `${pair.players[0].name} & ${pair.players[1].name}`,
    subtitle: `${pair.avgPoints} avg pts · ${pair.rounds} round${pair.rounds !== 1 ? 's' : ''}`,
    rows: pair.roundList.map(r => ({
      key: `r${r.roundIndex}`,
      primary: `R${r.roundIndex + 1} · ${r.courseName}`,
      secondary: r.memberPoints.map(m => `${m.playerName.split(' ')[0]} ${m.points}`).join(' · '),
      rightPrimary: `${r.combinedPoints} pts`,
      rightSecondary: `${r.combinedStrokes} golpes`,
    })),
  });

  const openHoleWins = (row) => setSheet({
    title: `${row.player.name} — hoyos a puntos`,
    subtitle: `MB ${row.best.W}·${row.best.T}·${row.best.L}  PB ${row.worst.W}·${row.worst.T}·${row.worst.L}  Tot ${row.total.W}·${row.total.T}·${row.total.L}`,
    rows: row.breakdown.map((b, i) => {
      const roleParts = [];
      if (b.bestRole) roleParts.push(`MB ${b.bestOutcome}`);
      if (b.worstRole) roleParts.push(`PB ${b.worstOutcome}`);
      const tone = roleParts.some(p => p.endsWith('W')) && !roleParts.some(p => p.endsWith('L'))
        ? 'excellent'
        : roleParts.every(p => p.endsWith('L'))
          ? 'poor'
          : 'neutral';
      return {
        key: `${b.roundIndex}-${b.holeNumber}-${i}`,
        primary: `R${b.roundIndex + 1} · ${b.courseName} · Hoyo ${b.holeNumber}`,
        secondary: `Par ${b.par} · ${b.playerPoints} pts (equipo ${b.teamBest}/${b.teamWorst} · rival ${b.oppBest}/${b.oppWorst})`,
        rightPrimary: roleParts.join(' · '),
        tone,
      };
    }),
  });

  const openH2H = () => {
    if (!h2h) return;
    setSheet({
      title: `${p1.name.split(' ')[0]} vs ${p2.name.split(' ')[0]}`,
      subtitle: `${h2h.p1Wins} - ${h2h.p2Wins} (${h2h.ties} empates)`,
      rows: h2h.holes.map((h, i) => {
        const winner = h.p1Points > h.p2Points ? p1.name.split(' ')[0] : h.p2Points > h.p1Points ? p2.name.split(' ')[0] : 'Empate';
        const tone = h.p1Points === h.p2Points ? 'neutral' : 'good';
        return {
          key: `${h.courseName}-${h.holeNumber}-${i}`,
          primary: `${h.courseName} · Hoyo ${h.holeNumber}`,
          secondary: `${p1.name.split(' ')[0]} ${h.p1Points} · ${p2.name.split(' ')[0]} ${h.p2Points}`,
          rightPrimary: winner,
          tone,
        };
      }),
    });
  };

  return (
    <View>
      {pairs.length > 0 && (
        <>
          <Text style={s.sectionTitle}>PAIR CHEMISTRY</Text>
          {pairs.map((p, i) => (
            <TouchableOpacity key={i} style={s.pairCard} onPress={() => openPair(p)} activeOpacity={0.7}>
              <View style={s.pairNames}>
                <Text style={s.pairName}>{p.players[0].name}</Text>
                <Text style={s.pairAmp}>&</Text>
                <Text style={s.pairName}>{p.players[1].name}</Text>
              </View>
              <View style={s.pairStats}>
                <Text style={s.pairAvg}>{p.avgPoints} avg pts</Text>
                <Text style={s.pairRounds}>{p.rounds} round{p.rounds !== 1 ? 's' : ''}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      {holeWins.some(r => r.total.W + r.total.T + r.total.L > 0) && (
        <>
          <Text style={s.sectionTitle}>HOLE WINS ON POINTS</Text>
          <View style={s.card}>
            <View style={s.hwHeader}>
              <Text style={[s.hwCell, s.hwHeaderText, { flex: 1.2 }]}>Jugador</Text>
              <Text style={[s.hwCell, s.hwHeaderText]}>MB G·E·P</Text>
              <Text style={[s.hwCell, s.hwHeaderText]}>PB G·E·P</Text>
              <Text style={[s.hwCell, s.hwHeaderText]}>Tot G·E·P</Text>
            </View>
            {holeWins.map(row => {
              const empty = row.total.W + row.total.T + row.total.L === 0;
              return (
                <TouchableOpacity
                  key={row.player.id}
                  style={s.hwRow}
                  onPress={() => !empty && openHoleWins(row)}
                  activeOpacity={0.7}
                  disabled={empty}
                >
                  <Text style={[s.hwCell, s.hwName, { flex: 1.2 }]}>{row.player.name.split(' ')[0]}</Text>
                  <Text style={[s.hwCell, s.hwValue]}>{row.best.W}·{row.best.T}·{row.best.L}</Text>
                  <Text style={[s.hwCell, s.hwValue]}>{row.worst.W}·{row.worst.T}·{row.worst.L}</Text>
                  <Text style={[s.hwCell, s.hwValueStrong]}>{row.total.W}·{row.total.T}·{row.total.L}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={s.sectionTitle}>HEAD TO HEAD</Text>
      <View style={s.h2hSelector}>
        <View style={s.h2hCol}>
          {players.map((p, i) => (
            <TouchableOpacity key={p.id} style={[s.playerChip, selectedPlayer === i && s.playerChipActive]} onPress={() => setSelectedPlayer(i)} activeOpacity={0.7}>
              <Text style={[s.playerChipText, selectedPlayer === i && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.h2hVs}>vs</Text>
        <View style={s.h2hCol}>
          {players.filter((_, i) => i !== selectedPlayer).map((p) => {
            const realIdx = players.indexOf(p);
            return (
              <TouchableOpacity key={p.id} style={[s.playerChip, p2Idx === realIdx && s.playerChipActive]} onPress={() => setH2hPlayer(realIdx)} activeOpacity={0.7}>
                <Text style={[s.playerChipText, p2Idx === realIdx && s.playerChipTextActive]}>{p.name.split(' ')[0]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {h2h ? (
        <TouchableOpacity style={s.card} onPress={openH2H} activeOpacity={0.7}>
          <View style={s.h2hResult}>
            <View style={s.h2hPlayer}>
              <Text style={s.h2hName}>{p1.name.split(' ')[0]}</Text>
              <Text style={[s.h2hScore, h2h.p1Wins > h2h.p2Wins && { color: theme.accent.primary }]}>{h2h.p1Wins}</Text>
            </View>
            <View style={s.h2hCenter}>
              <Text style={s.h2hTies}>{h2h.ties} ties</Text>
            </View>
            <View style={s.h2hPlayer}>
              <Text style={s.h2hName}>{p2.name.split(' ')[0]}</Text>
              <Text style={[s.h2hScore, h2h.p2Wins > h2h.p1Wins && { color: theme.accent.primary }]}>{h2h.p2Wins}</Text>
            </View>
          </View>
          <Text style={s.h2hSub}>{h2h.holes.length} holes compared</Text>
        </TouchableOpacity>
      ) : (
        <Text style={s.emptyText}>Select two different players to compare.</Text>
      )}

      <StatDetailSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title || ''}
        subtitle={sheet?.subtitle}
        rows={sheet?.rows || []}
      />
    </View>
  );
}
```

- [ ] **Step 2: Add styles for the hole-wins table**

In the `makeStyles` stylesheet at the bottom of the file, add these entries (append inside the `StyleSheet.create({ ... })` object, just before the closing `});`):

```js
  // Hole Wins table
  hwHeader: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: t.border.subtle },
  hwRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border.subtle },
  hwCell: { flex: 1, textAlign: 'center' },
  hwHeaderText: { fontFamily: 'PlusJakartaSans-SemiBold', color: t.text.muted, fontSize: 10, letterSpacing: 1 },
  hwName: { fontFamily: 'PlusJakartaSans-Bold', color: t.text.primary, fontSize: 13, textAlign: 'left' },
  hwValue: { fontFamily: 'PlusJakartaSans-Medium', color: t.text.secondary, fontSize: 13 },
  hwValueStrong: { fontFamily: 'PlusJakartaSans-Bold', color: t.accent.primary, fontSize: 13 },
```

- [ ] **Step 3: Verify — Expo reload, open Stats → Pairs**

Expected:
- Pair chemistry cards tappable → sheet with per-round breakdown.
- New `HOLE WINS ON POINTS` section appears, showing per-player `MB G·E·P`, `PB G·E·P`, `Tot G·E·P`. Sum `total.W + total.T + total.L` per row equals number of holes the player was a contributor on.
- Tap a row → sheet with each credited hole, showing role (MB / PB) and outcome (W / T / L).
- H2H card tappable → sheet with per-hole comparison.
- No console errors.

---

## Task 14: End-to-end smoke + math sanity check

**Files:**
- None (verification only)

**Goal:** Exercise every drill-down with real data and confirm the pair hole-wins math is consistent.

- [ ] **Step 1: Scenario — fresh tournament with no rounds scored**

Open Stats. Expected:
- Overview: empty-state message.
- Players: empty-state per selected player.
- Holes: empty-state.
- Pairs: no sections render.
- Shame: "No hay suficientes datos…" message.

- [ ] **Step 2: Scenario — one complete round**

Play a full round. Open Stats:
- Overview: all highlights visible. Tap each → drill-down populated with one round worth of data.
- Players: select each player, tap each streak and each non-zero distribution bar, tap the single round row.
- Holes: tap each easiest/hardest card, verify 4 players' scores shown.
- Pairs: pair chemistry card tappable, hole-wins table populated. Verify for one row: `total.W + total.T + total.L == total holes that player contributed on (either as MB or PB)`. Typically every hole has ≥1 MB and ≥1 PB contributor, so total per player ≤ 18.
- Shame: cards show, each tappable.

- [ ] **Step 3: Scenario — full 3-round tournament with handicaps**

- Toggle Gross/Net on Overview, Players, and Shame. Values change accordingly.
- On Pairs, verify each pair chemistry drill-down lists exactly the rounds that pair played together.
- On Shame, `desmoronamiento` should appear only for a player whose front-9 outscored their back-9 in a round.

- [ ] **Step 4: Scenario — partial round (not all holes scored)**

Open Stats. Expected: functions that require all 4 scores (pair hole wins, `regalo`) simply skip the incomplete holes with no crashes. Sum per-row in hole-wins table reflects only the completed holes.

- [ ] **Step 5: Scenario — three-player round (odd pair)**

If `randomPairs` produced a pair of length 1, `pairHoleWins` should skip that round (`pair1.length < 2 || pair2.length < 2`). Verify no crash on opening Stats → Pairs.

- [ ] **Step 6: Confirm no regressions**

- Re-check that the existing Pair Chemistry numbers match what they did before Task 5 (engine change was additive).
- Re-check that Overview highlight values match what they did before Task 3.

---

## Self-Review Notes

**Spec coverage:**
- Drill-down on every numeric card → Tasks 1–5, 9–13.
- Hall of Shame as new tab with gross/net toggle → Tasks 7, 12.
- Pair hole wins in Pairs tab → Tasks 6, 13.
- Bottom-sheet UI → Task 8.
- Engine additive (existing shape preserved) → Tasks 1–5 verified via intermediate Expo reloads.

**Type consistency:**
- `playerStreaks` returns both scalar (`bestParStreak`) and list (`parStreakHoles`) fields — consistent naming across the three streak types.
- `breakdown` field used consistently in `tournamentHighlights`, `pairHoleWins`, `hallOfShame`.
- `StatDetailSheet` row shape identical across all callers: `{ key, primary, secondary?, rightPrimary?, rightSecondary?, tone? }`.
- Role tokens `'MB'`, `'PB'` and outcome tokens `'W' | 'T' | 'L'` consistent in Task 6 and Task 13.

**Placeholder scan:** No "TBD", "TODO", "similar to Task N" — every step has the actual code.

**Ambiguity:** Attribution rules for ties in `pairHoleWins` spelled out: if both members of a pair have equal stableford on a hole, both are contributors for both best-ball and worst-ball. No hidden assumptions.
