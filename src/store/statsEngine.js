import { calcStablefordPoints, calcExtraShots, roundPairLeaderboard, getPlayingHandicap } from './tournamentStore';

// ── Player Stats ──

export function playerRoundHistory(tournament, playerId) {
  return tournament.rounds
    .map((round, ri) => {
      if (!round.scores || !round.scores[playerId]) return null;
      const player = tournament.players.find(p => p.id === playerId);
      const handicap = player ? getPlayingHandicap(round, player) : 0;
      let points = 0, strokes = 0, holesPlayed = 0;
      round.holes.forEach(hole => {
        const sc = round.scores[playerId]?.[hole.number];
        if (sc) {
          strokes += sc;
          points += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
          holesPlayed++;
        }
      });
      if (holesPlayed === 0) return null;
      return { roundIndex: ri, courseName: round.courseName, points, strokes, holesPlayed, avgPerHole: +(points / holesPlayed).toFixed(2) };
    })
    .filter(Boolean);
}

export function playerAvgStableford(tournament, playerId) {
  const history = playerRoundHistory(tournament, playerId);
  if (history.length === 0) return 0;
  return +(history.reduce((s, r) => s + r.points, 0) / history.length).toFixed(1);
}

export function playerScoreDistribution(tournament, playerId, { useNet = false, roundIndex = null } = {}) {
  const dist = {
    eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, worse: 0, total: 0,
    eagleHoles: [], birdieHoles: [], parHoles: [], bogeyHoles: [], doubleHoles: [], worseHoles: [],
  };
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
      const entry = {
        roundIndex: ri, courseName: round.courseName,
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

// ── Streaks ──

export function playerStreaks(tournament, playerId, { useNet = false, roundIndex = null } = {}) {
  const entries = [];
  const player = tournament.players.find(p => p.id === playerId);
  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
    if (!round.scores?.[playerId]) return;
    const handicap = player ? getPlayingHandicap(round, player) : 0;
    round.holes.forEach(hole => {
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const extra = useNet ? calcExtraShots(handicap, hole.strokeIndex) : 0;
      const vsPar = sc - extra - hole.par;
      const points = calcStablefordPoints(hole.par, sc, useNet ? handicap : 0, hole.strokeIndex);
      entries.push({
        roundIndex: ri, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, strokes: sc, points, vsPar,
      });
    });
  });

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
  const bogeyOnly = longestRun(e => e.vsPar === 1);
  const doubleBogeyPlus = longestRun(e => e.vsPar >= 2);

  return {
    bestParStreak: par.count,
    bestBirdieStreak: birdie.count,
    bogeyOnlyStreak: bogeyOnly.count,
    doubleBogeyPlusStreak: doubleBogeyPlus.count,
    parStreakHoles: par.holes,
    birdieStreakHoles: birdie.holes,
    bogeyOnlyStreakHoles: bogeyOnly.holes,
    doubleBogeyPlusStreakHoles: doubleBogeyPlus.holes,
  };
}

// ── Hole Analysis ──

export function bestWorstHoles(tournament, { roundIndex = null } = {}) {
  const holeMap = {};
  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
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

export function holeDifficultyMap(tournament, roundIndex) {
  const round = tournament.rounds[roundIndex];
  if (!round?.scores) return [];
  return round.holes.map(hole => {
    const playerScores = tournament.players.map(p => {
      const sc = round.scores[p.id]?.[hole.number];
      if (!sc) return null;
      const handicap = getPlayingHandicap(round, p);
      return { playerId: p.id, playerName: p.name, points: calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex), strokes: sc };
    }).filter(Boolean);
    const avg = playerScores.length > 0 ? +(playerScores.reduce((s, x) => s + x.points, 0) / playerScores.length).toFixed(2) : 0;
    return { holeNumber: hole.number, par: hole.par, si: hole.strokeIndex, playerScores, avgPoints: avg };
  });
}

// ── Head-to-Head ──

export function headToHead(tournament, p1Id, p2Id) {
  let p1Wins = 0, p2Wins = 0, ties = 0;
  const holes = [];
  const p1 = tournament.players.find(p => p.id === p1Id);
  const p2 = tournament.players.find(p => p.id === p2Id);
  tournament.rounds.forEach(round => {
    if (!round.scores?.[p1Id] || !round.scores?.[p2Id]) return;
    const h1 = p1 ? getPlayingHandicap(round, p1) : 0;
    const h2 = p2 ? getPlayingHandicap(round, p2) : 0;
    round.holes.forEach(hole => {
      const s1 = round.scores[p1Id]?.[hole.number];
      const s2 = round.scores[p2Id]?.[hole.number];
      if (!s1 || !s2) return;
      const pts1 = calcStablefordPoints(hole.par, s1, h1, hole.strokeIndex);
      const pts2 = calcStablefordPoints(hole.par, s2, h2, hole.strokeIndex);
      if (pts1 > pts2) p1Wins++;
      else if (pts2 > pts1) p2Wins++;
      else ties++;
      holes.push({ holeNumber: hole.number, courseName: round.courseName, p1Points: pts1, p2Points: pts2 });
    });
  });
  return { p1Wins, p2Wins, ties, holes };
}

// ── Pair Chemistry ──

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

// ── Tournament Highlights ──

export function tournamentHighlights(tournament, { useNet = false, roundIndex = null } = {}) {
  let bestRound = { value: -Infinity, entries: [] };
  let mostBirdies = { value: -1, entries: [] };
  let longestParStreak = { value: 0, entries: [] };

  const pushTied = (holder, value, entry) => {
    if (value > holder.value) {
      holder.value = value;
      holder.entries = [entry];
    } else if (value === holder.value) {
      holder.entries.push(entry);
    }
  };

  tournament.players.forEach(p => {
    const history = playerRoundHistory(tournament, p.id)
      .filter(r => roundIndex === null || r.roundIndex === roundIndex);
    history.forEach(r => {
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
      pushTied(bestRound, r.points, { player: p, points: r.points, courseName: r.courseName, roundIndex: r.roundIndex, breakdown: holes });
    });

    const dist = playerScoreDistribution(tournament, p.id, { useNet, roundIndex });
    const birdiesAndEagles = [...dist.eagleHoles, ...dist.birdieHoles];
    pushTied(mostBirdies, birdiesAndEagles.length, { player: p, count: birdiesAndEagles.length, breakdown: birdiesAndEagles });

    const streaks = playerStreaks(tournament, p.id, { useNet, roundIndex });
    pushTied(longestParStreak, streaks.bestParStreak, { player: p, count: streaks.bestParStreak, breakdown: streaks.parStreakHoles });
  });

  const holes = bestWorstHoles(tournament, { roundIndex });

  return {
    bestRound: bestRound.entries.length ? { value: bestRound.value, entries: bestRound.entries } : null,
    mostBirdies: mostBirdies.value > 0 ? { value: mostBirdies.value, entries: mostBirdies.entries } : null,
    longestParStreak: longestParStreak.value > 1 ? { value: longestParStreak.value, entries: longestParStreak.entries } : null,
    bestHole: holes.best[0] || null,
    worstHole: holes.worst[0] || null,
  };
}

// ── Pair Hole Wins (Best Ball / Worst Ball) ──

export function pairHoleWins(tournament, { roundIndex = null } = {}) {
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

  tournament.rounds.forEach((round, ri) => {
    if (roundIndex !== null && ri !== roundIndex) return;
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

      const credit = (playerId, pairScore, pairMax, pairMin, bestOutcome, worstOutcome, oppBest, oppWorst) => {
        const rec = stats[playerId];
        const entry = {
          roundIndex: ri, courseName: round.courseName, holeNumber: hole.number, par: hole.par,
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

// ── Hall of Shame ──

export function hallOfShame(tournament, { useNet = false } = {}) {
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

  const tied = (minValue = 1) => ({ value: -Infinity, entries: [], minValue });
  const push = (holder, value, entry) => {
    if (value < holder.minValue) return;
    if (value > holder.value) { holder.value = value; holder.entries = [entry]; }
    else if (value === holder.value) holder.entries.push(entry);
  };
  const finalize = (holder) => holder.entries.length ? { value: holder.value, entries: holder.entries } : null;

  // 1. Triple Bogey Club — worst single hole by vsPar
  const tripleBogey = tied(3);
  tournament.players.forEach(p => {
    perPlayerEntries[p.id].forEach(e => push(tripleBogey, e.vsPar, { player: p, ...e, breakdown: [e] }));
  });

  // longest-run helper per-player
  const longestRunPerPlayer = (predicate) => {
    const holder = tied(1);
    tournament.players.forEach(p => {
      const entries = perPlayerEntries[p.id];
      let curStart = -1, bestCount = 0, bestStart = -1, bestEnd = -1;
      entries.forEach((e, i) => {
        if (predicate(e)) {
          if (curStart === -1) curStart = i;
          const curCount = i - curStart + 1;
          if (curCount > bestCount) { bestCount = curCount; bestStart = curStart; bestEnd = i; }
        } else { curStart = -1; }
      });
      if (bestCount > 0) {
        push(holder, bestCount, {
          player: p, count: bestCount,
          breakdown: entries.slice(bestStart, bestEnd + 1),
        });
      }
    });
    return holder;
  };

  // 2. Bogey Streak — longest run of exactly-bogey holes
  const bogeyStreak = longestRunPerPlayer(e => e.vsPar === 1);
  // Require at least 2 to be meaningful
  bogeyStreak.minValue = 2;
  if (bogeyStreak.value < 2) bogeyStreak.entries = [];

  // 3. Double Bogey+ Streak — longest run of 2-over-or-worse
  const doubleBogeyStreak = longestRunPerPlayer(e => e.vsPar >= 2);
  doubleBogeyStreak.minValue = 2;
  if (doubleBogeyStreak.value < 2) doubleBogeyStreak.entries = [];

  // 4. Pointless Streak — longest 0-stableford-points streak
  const pointlessStreak = longestRunPerPlayer(e => e.points === 0);
  pointlessStreak.minValue = 2;
  if (pointlessStreak.value < 2) pointlessStreak.entries = [];

  // 5. The Gift — biggest gap between others' avg and this player's points on a hole
  const gift = { value: -Infinity, entries: [] };
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
        const gap = +(othersAvg - entry.points).toFixed(2);
        const payload = {
          player: entry.player,
          gap,
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
        if (gap > gift.value) { gift.value = gap; gift.entries = [payload]; }
        else if (gap === gift.value) gift.entries.push(payload);
      });
    });
  });

  // 6. The Collapse — biggest front9 − back9 drop (18 holes required)
  const collapse = { value: 0, entries: [] };
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
      if (drop <= 0) return;
      const payload = { player: p, drop, front, back, roundIndex, courseName: round.courseName, breakdown: holeEntries };
      if (drop > collapse.value) { collapse.value = drop; collapse.entries = [payload]; }
      else if (drop === collapse.value) collapse.entries.push(payload);
    });
  });

  // 7. Blow-up Hole — highest raw stroke count on any hole
  const blowup = { value: 0, entries: [] };
  tournament.players.forEach(p => {
    perPlayerEntries[p.id].forEach(e => {
      const payload = { player: p, ...e, breakdown: [e] };
      if (e.strokes > blowup.value) { blowup.value = e.strokes; blowup.entries = [payload]; }
      else if (e.strokes === blowup.value) blowup.entries.push(payload);
    });
  });

  return {
    tripleBogey: finalize(tripleBogey),
    bogeyStreak: bogeyStreak.entries.length ? { value: bogeyStreak.value, entries: bogeyStreak.entries } : null,
    doubleBogeyStreak: doubleBogeyStreak.entries.length ? { value: doubleBogeyStreak.value, entries: doubleBogeyStreak.entries } : null,
    pointlessStreak: pointlessStreak.entries.length ? { value: pointlessStreak.value, entries: pointlessStreak.entries } : null,
    gift: gift.entries.length ? { value: gift.value, entries: gift.entries } : null,
    collapse: collapse.entries.length ? { value: collapse.value, entries: collapse.entries } : null,
    blowup: blowup.entries.length ? { value: blowup.value, entries: blowup.entries } : null,
  };
}
