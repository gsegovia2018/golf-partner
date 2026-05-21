// Pure per-mode scoring for the scorecard. Wraps the scoring engines in
// store/tournamentStore.js so components never branch on mode themselves.
import {
  calcStablefordPoints,
  matchPlayHolePts,
  matchPlayRoundTally,
  sindicatoHolePoints,
  calcBestWorstBall,
  roundPairLeaderboard,
  sindicatoRoundTally,
  roundPairClinched,
} from '../../store/tournamentStore';
import { playersMeFirst } from '../../lib/playerOrder';

// Points for every player on one hole. Returns { [playerId]: number|null };
// null means the player has not scored the hole yet.
export function holePoints({ mode, hole, players, scores, handicaps }) {
  const result = {};
  for (const p of players) {
    const str = scores?.[p.id]?.[hole.number];
    if (str == null) { result[p.id] = null; continue; }
    if (mode === 'matchplay') {
      // matchPlayHolePts returns null when either player (not just p) has not scored yet.
      result[p.id] = matchPlayHolePts(hole, p.id, players, scores, handicaps);
    } else if (mode === 'sindicato') {
      result[p.id] = sindicatoHolePoints(hole, players, scores, handicaps)?.[p.id] ?? null;
    } else {
      const hcp = handicaps?.[p.id] ?? p.handicap ?? 0;
      result[p.id] = calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
    }
  }
  return result;
}

// Per-player round totals. Returns Map<playerId, { pts, str, parPlayed }>.
export function roundTotals({ mode, round, players, scores, handicaps }) {
  const map = new Map();
  const holes = round?.holes ?? [];
  for (const p of players) {
    let pts = 0;
    let str = 0;
    let parPlayed = 0;
    for (const hole of holes) {
      const sc = scores?.[p.id]?.[hole.number];
      if (sc == null) continue;
      str += sc;
      parPlayed += hole.par;
      const hp = holePoints({ mode, hole, players, scores, handicaps });
      pts += hp[p.id] ?? 0;
    }
    map.set(p.id, { pts, str, parPlayed });
  }
  return map;
}

// --- summaryState helpers ----------------------------------------------------

// First name only — mirrors the `name.split(' ')[0]` used across the panels.
function firstName(player) {
  return player?.name?.split(' ')[0] ?? '—';
}

// Join a pair's member first names with ' & ' — ports `pairLabel`.
function pairLabel(pair) {
  return pair.map((p) => firstName(p)).join(' & ');
}

// Ports `holeTeamPts`: best/worst-ball points a team scored on one hole.
// Returns null when the hole is not fully scored (bestWinner === null).
function holeTeamPts(holeData, team, bbVal, wbVal) {
  if (!holeData || holeData.bestWinner === null) return null;
  return (holeData.bestWinner === team ? bbVal : 0)
    + (holeData.worstWinner === team ? wbVal : 0);
}

// Ports `roundTeamPts`: a team's total best/worst-ball points for the round.
function roundTeamPts(bbResult, team, bbVal, wbVal) {
  const { bestBall, worstBall } = bbResult;
  return (team === 1 ? bestBall.pair1 : bestBall.pair2) * bbVal
    + (team === 1 ? worstBall.pair1 : worstBall.pair2) * wbVal;
}

// vs-par label for the solo ribbon — ports SoloTotalsRibbon's vsParLabel.
function vsParLabel(str, parPlayed) {
  if (parPlayed === 0) return '-';
  const diff = str - parPlayed;
  if (diff === 0) return 'E';
  if (diff > 0) return `+${diff}`;
  return String(diff);
}

// Bottom-summary view-model for the unified scorecard. Consolidates the math
// that previously lived in MatchPanel, SindicatoPanel, StablefordWinnerBanner
// and SoloTotalsRibbon. Pure — no React, no I/O.
export function summaryState({ mode, round, players, scores, settings, currentHole, meId }) {
  const playerList = players ?? [];
  const liveRound = { ...round, scores };
  const cfg = settings ?? {};

  // --- solo --------------------------------------------------------------
  if (playerList.length === 1) {
    const totals = roundTotals({ mode, round, players: playerList, scores });
    const me = playerList[0];
    const { str = 0, pts = 0, parPlayed = 0 } = totals.get(me.id) ?? {};
    return {
      variant: 'solo',
      eyebrow: 'ROUND TOTALS',
      solo: { str, pts, vsParLabel: vsParLabel(str, parPlayed) },
      status: null,
      decided: false,
    };
  }

  // --- match play (1v1 — exactly 2 individual players) -------------------
  if (mode === 'matchplay') {
    const totals = roundTotals({ mode, round, players: playerList, scores });
    const ordered = playersMeFirst(playerList, meId);
    const tally = matchPlayRoundTally(
      { ...round, scores, playerHandicaps: round?.playerHandicaps ?? {} },
      playerList,
    );
    const decided = !!tally?.clinched;
    const holesLeft = tally?.holesLeft ?? 0;
    const lead = tally?.lead ?? 0;
    const leaderIdx = tally?.leaderIdx ?? null;
    const leader = leaderIdx != null ? playerList[leaderIdx] : null;

    let status;
    if (decided && leader) {
      status = `${firstName(leader)} wins the match`;
    } else if (lead > 0 && leader) {
      status = `${firstName(leader)} leads by ${lead} · ${holesLeft} to play`;
    } else {
      status = `All square · ${holesLeft} to play`;
    }

    const chips = ordered.map((p) => ({
      id: p.id,
      name: firstName(p),
      points: totals.get(p.id)?.pts ?? 0,
      isLeader: leader ? p.id === leader.id : false,
      isMe: p.id === meId,
      isWinner: decided && !!leader && p.id === leader.id,
    }));
    return { variant: 'players', eyebrow: 'MATCH PLAY', chips, status, decided };
  }

  // --- pairs (best ball only) --------------------------------------------
  if (mode === 'bestball') {
    const roundPairs = round?.pairs ?? [];
    const [pair1 = [], pair2 = []] = roundPairs;
    const bbVal = cfg.bestBallValue ?? 1;
    const wbVal = cfg.worstBallValue ?? 1;
    const fullPairs = pair1.length >= 2 && pair2.length >= 2;

    let p1Hole = null;
    let p2Hole = null;
    let p1Round = 0;
    let p2Round = 0;
    let decided = false;
    let holesRemaining = round?.holes?.length ?? 0;

    if (fullPairs) {
      // Best Ball — port MatchPanel exactly off calcBestWorstBall.
      const bb = calcBestWorstBall(liveRound, playerList);
      if (bb) {
        const holeData = bb.holes.find((h) => h.number === currentHole);
        p1Hole = holeTeamPts(holeData, 1, bbVal, wbVal);
        p2Hole = holeTeamPts(holeData, 2, bbVal, wbVal);
        p1Round = roundTeamPts(bb, 1, bbVal, wbVal);
        p2Round = roundTeamPts(bb, 2, bbVal, wbVal);
        holesRemaining = bb.holes.filter((h) => h.bestWinner === null).length;
      }
      decided = roundPairClinched(liveRound, playerList, cfg, 'bestball') != null;
    }

    const roundWinner = p1Round > p2Round ? 1 : p2Round > p1Round ? 2 : 0;
    const lead = Math.abs(p1Round - p2Round);
    const maxCatchup = holesRemaining * (bbVal + wbVal);
    if (!decided) decided = roundWinner !== 0 && lead > maxCatchup;

    const p1Name = pairLabel(pair1);
    const p2Name = pairLabel(pair2);
    const winnerName = roundWinner === 1 ? p1Name : roundWinner === 2 ? p2Name : null;

    let status;
    if (decided && winnerName) {
      status = `${winnerName} have won the round`;
    } else if (roundWinner === 0) {
      status = `All square · ${holesRemaining} to play`;
    } else {
      status = `${winnerName} lead by ${lead} · ${holesRemaining} to play`;
    }

    return {
      variant: 'pairs',
      eyebrow: 'BEST BALL',
      pairs: [
        {
          index: 0,
          name: p1Name,
          holePts: p1Hole,
          roundPts: p1Round,
          isWinner: decided && roundWinner === 1,
        },
        {
          index: 1,
          name: p2Name,
          holePts: p2Hole,
          roundPts: p2Round,
          isWinner: decided && roundWinner === 2,
        },
      ],
      status,
      decided,
    };
  }

  // --- players (stableford / sindicato) ----------------------------------
  const totals = roundTotals({ mode, round, players: playerList, scores });
  const ordered = playersMeFirst(playerList, meId);

  if (mode === 'sindicato') {
    const tally = sindicatoRoundTally(liveRound, playerList);
    const leader = tally && tally.leaderIdx != null
      ? tally.totals[tally.leaderIdx].player
      : null;
    const decided = !!tally?.clinched;
    const holesLeft = tally?.holesLeft ?? 0;
    let status;
    if (decided && leader) {
      status = `${firstName(leader)} has clinched`;
    } else if (leader) {
      status = `${firstName(leader)} leads by ${tally.lead}`
        + (holesLeft > 0 ? ` · ${holesLeft} to play` : '');
    } else {
      status = `All level${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;
    }
    const chips = ordered.map((p) => ({
      id: p.id,
      name: firstName(p),
      points: totals.get(p.id)?.pts ?? 0,
      isLeader: leader ? p.id === leader.id : false,
      isMe: p.id === meId,
      isWinner: decided && !!leader && p.id === leader.id,
    }));
    return { variant: 'players', eyebrow: 'SINDICATO', chips, status, decided };
  }

  // Stableford — leader is the sole points leader, null when tied.
  const ranked = [...playerList]
    .map((p) => ({ p, pts: totals.get(p.id)?.pts ?? 0 }))
    .sort((a, b) => b.pts - a.pts);
  const tiedTop = ranked.length > 1 && ranked[0].pts === ranked[1].pts;
  const leaderEntry = tiedTop ? null : ranked[0] ?? null;
  const leaderId = leaderEntry?.p.id ?? null;
  const leadAmount = ranked.length > 1 ? ranked[0].pts - ranked[1].pts : ranked[0]?.pts ?? 0;

  // Decided only when every player has scored every hole.
  const holes = round?.holes ?? [];
  const decided = playerList.length > 0 && holes.length > 0
    && playerList.every((p) => holes.every((h) => scores?.[p.id]?.[h.number] != null));

  const roundPairs = round?.pairs ?? [];
  const hasTwoPairs = roundPairs.length >= 2;

  // Winner — top pair when 2 pairs exist (random-partner Stableford), else
  // the top chip. Null on a tie.
  let winnerLabel = null;
  let winnerIds = [];
  if (hasTwoPairs) {
    const lb = roundPairLeaderboard(liveRound, playerList);
    if (lb.length >= 2 && lb[0].combinedPoints !== lb[1].combinedPoints) {
      winnerLabel = lb[0].members.map((m) => firstName(m.player)).join(' & ');
      winnerIds = lb[0].members.map((m) => m.player.id);
    }
  } else if (!tiedTop && leaderEntry) {
    winnerLabel = firstName(leaderEntry.p);
    winnerIds = [leaderEntry.p.id];
  }

  let status;
  if (decided) {
    if (winnerLabel) {
      const isPair = winnerIds.length > 1;
      status = `${winnerLabel} ${isPair ? 'have' : 'has'} won`;
    } else {
      status = 'All level';
    }
  } else if (hasTwoPairs) {
    // Live random-partner Stableford — name the leading pair.
    const lb = roundPairLeaderboard(liveRound, playerList);
    const holesLeft = holes.filter((h) => (
      !playerList.every((p) => scores?.[p.id]?.[h.number] != null)
    )).length;
    if (lb.length >= 2 && lb[0].combinedPoints !== lb[1].combinedPoints) {
      const lbLead = lb[0].combinedPoints - lb[1].combinedPoints;
      const lbName = lb[0].members.map((m) => firstName(m.player)).join(' & ');
      status = `${lbName} lead by ${lbLead} · ${holesLeft} to play`;
    } else {
      status = `All level · ${holesLeft} to play`;
    }
  } else {
    const holesLeft = holes.filter((h) => (
      !playerList.every((p) => scores?.[p.id]?.[h.number] != null)
    )).length;
    if (leaderEntry && !tiedTop) {
      status = `${firstName(leaderEntry.p)} leads by ${leadAmount} · ${holesLeft} to play`;
    } else {
      status = `All level · ${holesLeft} to play`;
    }
  }

  const chips = ordered.map((p) => ({
    id: p.id,
    name: firstName(p),
    points: totals.get(p.id)?.pts ?? 0,
    isLeader: leaderId ? p.id === leaderId : false,
    isMe: p.id === meId,
    isWinner: decided && winnerIds.includes(p.id),
  }));

  return { variant: 'players', eyebrow: 'STABLEFORD', chips, status, decided };
}
