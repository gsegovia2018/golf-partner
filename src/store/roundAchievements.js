// Round achievements — the "what was special about this round" strip shown
// under the summary card when a round finishes.
//
// Pure module, sibling to roundReportCard.js. Two independent families, both
// producing the SAME candidate shape so one selector can rank them together:
//
//   buildRoundHighlights(tournament, roundIndex)  — this round only. Every
//     player in the group, no history, no async load: the caller already has
//     the tournament in memory.
//   buildPersonalRecords(myRounds, roundKey)      — the viewer's career "ever"
//     records. Needs collectMyRounds over every tournament (one async load).
//
// selectAchievements ranks the pool and caps it. Every number here is
// delegated to statsEngine/personalStats — this module only detects, phrases
// and ranks, exactly as roundReportCard only selects and shapes.
//
// A candidate is:
//   { id, tone, rarity, title, subtitle, playerId, playerName, holes }
// `tone` drives colour and the mix rule in selectAchievements; `rarity` is
// the ranking weight (higher wins); `holes` is the hole numbers the claim is
// about, for the UI to highlight.
import {
  playerStreaks, playerScoreDistribution, playerRoundHistory,
  chaosHoles, frontBackSplit, bounceBackRate, pairCarryRatio,
} from './statsEngine';
import {
  buildSyntheticTournament, careerMilestones, courseMastery, CANON_ID,
} from './personalStats';
import { roundCourseKey, filterRoundsToCourse } from './courseBreakdown';
import {
  isScrambleMode, roundScoringMode, holeCountOf, isFullLengthRound,
} from './scoring';

// Stableford points a player scores by playing exactly to handicap over a
// full round — 2 per hole. Scaled by hole count so a 9-hole round is judged
// against 18, not 36.
const PLAYED_TO_HANDICAP = 2;

// A par-or-better run needs at least this many holes to be worth a card.
const MIN_PAR_STREAK = 3;
// A hole must split the group by at least this many strokes to be "chaos".
const MIN_CHAOS_RANGE = 3;
// Back-nine charge: at least this many more points on the back than the front.
const MIN_NINE_SWING = 4;
// One partner must hold at least this share of the pair's points to have
// "carried" it (0.3 imbalance = a 65/35 split).
const MIN_CARRY_IMBALANCE = 0.3;
// Bounce-back only reads as a feat with enough chances to fail.
const MIN_BOUNCE_OPPORTUNITIES = 3;
// A hole this far over par is the round's disaster.
const MIN_BLOWUP_VS_PAR = 3;

// "Best ever" is a lie on your third round: a career record needs this many
// prior COMPLETE rounds behind it before it is allowed to fire at all.
const MIN_RECORD_HISTORY = 3;
// A course record needs its own, smaller, history at that course.
const MIN_COURSE_HISTORY = 2;
// Round counts worth celebrating on their own.
const ROUND_MILESTONES = [10, 25, 50, 100, 250];
const COURSE_MILESTONES = [5, 10, 25, 50];

function candidate(id, tone, rarity, title, subtitle, extra = {}) {
  return {
    id,
    tone,
    rarity,
    title,
    subtitle,
    playerId: extra.playerId ?? null,
    playerName: extra.playerName ?? null,
    holes: extra.holes ?? [],
  };
}

// Hole numbers out of a statsEngine entry list ({ holeNumber, … }[]).
function holeNumbers(entries) {
  return (entries ?? []).map((e) => e.holeNumber).filter((n) => n != null);
}

// "holes 6-9" / "hole 7" — the span a CONTIGUOUS run covers. Only valid for
// streak holes (longestAdjacentRun guarantees they are consecutive); a
// scattered list needs holeListLabel, or "holes 1-6" would claim a clean run
// where there were six separate holes.
function holeSpanLabel(holes) {
  if (holes.length === 0) return '';
  if (holes.length === 1) return `hole ${holes[0]}`;
  return `holes ${holes[0]}-${holes[holes.length - 1]}`;
}

// "hole 7" / "holes 3, 8 and 14" / "holes 3, 8, 14 and 2 more" — a scattered
// set, never implying the holes were consecutive.
function holeListLabel(holes) {
  if (holes.length === 0) return '';
  if (holes.length === 1) return `hole ${holes[0]}`;
  if (holes.length <= 3) {
    return `holes ${holes.slice(0, -1).join(', ')} and ${holes[holes.length - 1]}`;
  }
  return `holes ${holes.slice(0, 3).join(', ')} and ${holes.length - 3} more`;
}

// Every statsEngine detector below is tournament-wide; several take no
// `roundIndex` option at all. Rather than widen their signatures in a 3000-line
// shared module, scope them the way courseBreakdown does — hand them a
// tournament holding only the round in question. Their internal roundIndex is
// then always 0, which is fine: nothing here reads it, only hole numbers and
// players. Returns null when the round does not exist.
function roundSlice(tournament, roundIndex) {
  const round = tournament?.rounds?.[roundIndex];
  if (!round) return null;
  return { ...tournament, rounds: [round] };
}

// ── Tier A: this round only ───────────────────────────────────────

// Longest par-or-better run per player. The headline "consecutive pars" card.
function parStreakCandidates(tournament, roundIndex) {
  const out = [];
  (tournament.players ?? []).forEach((p) => {
    const streak = playerStreaks(tournament, p.id, { roundIndex });
    if (streak.bestParStreak < MIN_PAR_STREAK) return;
    const holes = holeNumbers(streak.parStreakHoles);
    // Capped: a streak is a round-local feat, and an 18-hole run of pars must
    // still not outrank a career record in selectAchievements.
    out.push(candidate(
      'parStreak', 'great', 40 + Math.min(streak.bestParStreak, 6) * 8,
      `${streak.bestParStreak} in a row`,
      `Net par or better on ${holeSpanLabel(holes)}`,
      { playerId: p.id, playerName: p.name, holes },
    ));
  });
  return out;
}

// Eagles first (rare enough to always outrank), then a birdie haul.
function scoringCandidates(tournament, roundIndex) {
  const out = [];
  (tournament.players ?? []).forEach((p) => {
    // Two different questions, two different metrics:
    //  - eagles/birdies are GROSS ('strokes'). A birdie is what is on the
    //    card; a net birdie is just a good hole for your handicap, and
    //    calling it a birdie would overclaim on every card.
    //  - the blow-up below is NET, so the roast is handicap-fair: a 7 on a
    //    par 4 is a normal hole for a 24-handicapper and must not be
    //    served up as a disaster every single round.
    const gross = playerScoreDistribution(tournament, p.id, { metric: 'strokes', roundIndex });
    const dist = playerScoreDistribution(tournament, p.id, { roundIndex });
    if (gross.eagles > 0) {
      const holes = holeNumbers(gross.eagleHoles);
      out.push(candidate(
        'eagle', 'great', 95,
        gross.eagles > 1 ? `${gross.eagles} eagles` : 'Eagle!',
        `On ${holeListLabel(holes)}`,
        { playerId: p.id, playerName: p.name, holes },
      ));
    }
    if (gross.birdies > 0) {
      const holes = holeNumbers(gross.birdieHoles);
      out.push(candidate(
        'birdies', 'great', gross.birdies >= 2 ? 44 + gross.birdies * 6 : 28,
        gross.birdies === 1 ? 'Birdie' : `${gross.birdies} birdies`,
        `On ${holeListLabel(holes)}`,
        { playerId: p.id, playerName: p.name, holes },
      ));
    }
    // Worst hole of the round — the roast half of the mix. vsPar here is net
    // (handicap shots already applied), so a hole only qualifies once the
    // player's own strokes could not rescue it.
    const wrecks = dist.worseHoles.filter((h) => h.vsPar >= MIN_BLOWUP_VS_PAR);
    if (wrecks.length > 0) {
      const worst = wrecks.reduce((a, b) => (b.vsPar > a.vsPar ? b : a));
      out.push(candidate(
        'blowUp', 'roast', 30 + worst.vsPar,
        `Hole ${worst.holeNumber} happened`,
        `${worst.strokes} strokes on a par ${worst.par}`,
        { playerId: p.id, playerName: p.name, holes: [worst.holeNumber] },
      ));
    }
  });
  return out;
}

// Did anyone actually play to their handicap? 2 points a hole is the line.
function handicapCandidates(tournament, roundIndex) {
  const round = tournament.rounds[roundIndex];
  const holeCount = holeCountOf(round);
  const target = PLAYED_TO_HANDICAP * holeCount;
  const out = [];
  (tournament.players ?? []).forEach((p) => {
    const hist = playerRoundHistory(tournament, p.id)
      .find((h) => h.roundIndex === roundIndex);
    // Only a fully-scored round can be judged against the full-round target.
    if (!hist || hist.holesPlayed !== holeCount) return;
    if (hist.points < target) return;
    const over = hist.points - target;
    out.push(candidate(
      'playedToHandicap', 'good', 58 + Math.min(over, 12),
      over > 0 ? `Beat handicap by ${over}` : 'Played to handicap',
      `${hist.points} points off ${holeCount} holes`,
      { playerId: p.id, playerName: p.name },
    ));
  });
  return out;
}

// The hole that split the group — pure group fun, no winner.
function chaosCandidate(slice) {
  const worst = chaosHoles(slice)[0];
  if (!worst || worst.range < MIN_CHAOS_RANGE) return null;
  return candidate(
    'chaosHole', 'fun', 40 + worst.range * 3,
    `Hole ${worst.holeNumber} split the group`,
    `${worst.minStrokes} to ${worst.maxStrokes} strokes on a par ${worst.par}`,
    { holes: [worst.holeNumber] },
  );
}

// Strongest finisher. frontBackSplit only ever counts a round with both
// nines fully scored, so this is silently absent on 9-hole and partial rounds.
function nineSwingCandidate(slice) {
  const best = frontBackSplit(slice)[0];
  if (!best) return null;
  const swing = best.backTotal - best.frontTotal;
  if (swing < MIN_NINE_SWING) return null;
  return candidate(
    'backNineCharge', 'good', 45 + swing * 2,
    'Back-nine charge',
    `${best.frontTotal} points out, ${best.backTotal} points back`,
    { playerId: best.player.id, playerName: best.player.name },
  );
}

// Who carried the pair.
function carryCandidate(slice) {
  const top = pairCarryRatio(slice)[0];
  if (!top || top.imbalance < MIN_CARRY_IMBALANCE) return null;
  const leader = top.shares[0].share >= top.shares[1].share ? top.shares[0] : top.shares[1];
  // The name goes in playerName, never the title — the UI renders it once,
  // so a title that repeated it would read "Ana — Ana carried the pair".
  return candidate(
    'carriedThePair', 'fun', 42 + Math.round(top.imbalance * 30),
    'Carried the pair',
    `${Math.round(leader.share * 100)}% of the team's points`,
    { playerId: leader.player.id, playerName: leader.player.name },
  );
}

// Never let a bad hole become two.
function bounceBackCandidate(slice) {
  const top = bounceBackRate(slice)
    .filter((r) => r.opportunities >= MIN_BOUNCE_OPPORTUNITIES && r.rate === 100)[0];
  if (!top) return null;
  return candidate(
    'bounceBack', 'good', 62,
    'Never two in a row',
    `Answered all ${top.opportunities} dropped shots with par or better`,
    { playerId: top.player.id, playerName: top.player.name },
  );
}

// Tier A entry point: everything derivable from this round alone, for every
// player in the group. Scramble rounds carry one team ball under the captain
// rather than personal scores, so no per-player claim here would be true.
export function buildRoundHighlights(tournament, roundIndex) {
  const round = tournament?.rounds?.[roundIndex];
  if (!round || !round.scores) return [];
  if (isScrambleMode(roundScoringMode(tournament, round))) return [];

  const slice = roundSlice(tournament, roundIndex);
  return [
    ...parStreakCandidates(tournament, roundIndex),
    ...scoringCandidates(tournament, roundIndex),
    ...handicapCandidates(tournament, roundIndex),
    chaosCandidate(slice),
    nineSwingCandidate(slice),
    carryCandidate(slice),
    bounceBackCandidate(slice),
  ].filter(Boolean);
}

// ── Tier B: the viewer's career records ───────────────────────────

// Most birdies the player has ever made in a single round across `synthetic`.
// careerMilestones only reports the career TOTAL, so the per-round maximum is
// derived here — one distribution call per round, over history only.
function bestBirdiesInARound(synthetic) {
  let best = 0;
  (synthetic.rounds ?? []).forEach((_, ri) => {
    const dist = playerScoreDistribution(synthetic, CANON_ID, { roundIndex: ri });
    if (dist.birdies > best) best = dist.birdies;
  });
  return best;
}

// The milestone reached by playing this round, if any — `count` is the
// running total INCLUDING it.
function milestoneReached(count, ladder) {
  return ladder.includes(count) ? count : null;
}

// Tier B entry point. `myRounds` is collectMyRounds output (chronological);
// `roundKey` selects the round just finished. Records are judged against
// every OTHER completed round, exactly as roundReportCard builds its
// baseline. Returns [] whenever the round is unknown, still incomplete, or
// the history behind it is too thin to make an "ever" claim honest.
export function buildPersonalRecords(myRounds, roundKey) {
  const all = myRounds ?? [];
  const selected = all.find((r) => r.key === roundKey);
  if (!selected) return [];

  // A partial round cannot be a personal best: its totals are not comparable
  // with the full rounds they would be ranked against.
  if (!selected.isComplete) return [];

  const history = all.filter((r) => r.key !== roundKey && r.completed && r.isComplete);
  const out = [];

  const thisSynth = buildSyntheticTournament([selected]);
  const thisHist = playerRoundHistory(thisSynth, CANON_ID)[0];
  if (!thisHist) return [];
  const thisStreak = playerStreaks(thisSynth, CANON_ID).bestParStreak;
  const thisBirdies = playerScoreDistribution(thisSynth, CANON_ID).birdies;

  // ── Career records ──
  // Round-TOTAL records (points, birdie count) are only comparable between
  // rounds of the same length, and careerMilestones itself counts 18-hole
  // rounds only (countsForRoundTotals). A 9-hole round therefore makes no
  // round-total claim; its per-hole streak record below still stands, being
  // hole-count-neutral.
  const fullLength = isFullLengthRound(selected.round);
  if (history.length >= MIN_RECORD_HISTORY) {
    const histSynth = buildSyntheticTournament(history);
    const milestones = careerMilestones(histSynth);

    if (fullLength && milestones.bestRound != null && thisHist.points > milestones.bestRound) {
      out.push(candidate(
        'bestRoundEver', 'great', 100,
        'Best round ever',
        `${thisHist.points} points — beats your ${milestones.bestRound} at ${milestones.bestRoundCourse ?? 'your old best'}`,
      ));
    }
    if (milestones.longestParStreak != null && thisStreak > milestones.longestParStreak) {
      out.push(candidate(
        'longestStreakEver', 'great', 84,
        'Longest run of pars yet',
        `${thisStreak} holes — your best was ${milestones.longestParStreak}`,
      ));
    }
    const bestBirdies = bestBirdiesInARound(histSynth);
    if (fullLength && thisBirdies > bestBirdies && thisBirdies >= 2) {
      out.push(candidate(
        'mostBirdiesEver', 'great', 82,
        `${thisBirdies} birdies — a new best`,
        `Your record in one round was ${bestBirdies}`,
      ));
    }
  }

  // ── This course ──
  const courseKey = roundCourseKey(selected);
  const courseHistory = filterRoundsToCourse(history, courseKey);
  if (courseKey != null && courseHistory.length >= MIN_COURSE_HISTORY) {
    const mastery = courseMastery(buildSyntheticTournament(courseHistory))[0];
    // Both course records are round totals, so they only compare like with
    // like: a 9-hole round would beat any 18-hole record on raw stroke count.
    // mastery.holeCount is null when the course's own rounds disagree on
    // length, which fails this check and correctly claims nothing.
    const sameLength = mastery != null && mastery.holeCount === thisHist.holesPlayed;
    if (sameLength && thisHist.strokes < mastery.bestStrokes) {
      out.push(candidate(
        'courseRecord', 'great', 92,
        `Course record at ${selected.courseName}`,
        `${thisHist.strokes} strokes — your best here was ${mastery.bestStrokes}`,
      ));
    } else if (sameLength && thisHist.points > mastery.bestPoints) {
      out.push(candidate(
        'bestAtCourse', 'great', 78,
        `Best yet at ${selected.courseName}`,
        `${thisHist.points} points — beats your ${mastery.bestPoints} here`,
      ));
    }
  }

  // ── Milestones ──
  const roundNumber = milestoneReached(history.length + 1, ROUND_MILESTONES);
  if (roundNumber) {
    out.push(candidate(
      'roundMilestone', 'fun', 70,
      `Your ${roundNumber}th round`,
      'Logged in the app',
    ));
  }
  const courseNumber = courseKey != null
    ? milestoneReached(courseHistory.length + 1, COURSE_MILESTONES)
    : null;
  if (courseNumber) {
    out.push(candidate(
      'courseMilestone', 'fun', 66,
      `${courseNumber} rounds at ${selected.courseName}`,
      'A proper home course by now',
    ));
  }

  return out;
}

// ── Selection ─────────────────────────────────────────────────────

// Rank the pool and cap it. Two rules keep the strip from reading as a wall
// of the same thing, in the spirit of roundReportCard's selectCallouts:
//   - one card per detector id (the best instance of it), so a foursome does
//     not produce four "3 in a row" cards;
//   - at most one roast, and never as the leading card.
export function selectAchievements(candidates, { limit = 4 } = {}) {
  const bestPerId = new Map();
  (candidates ?? []).forEach((c) => {
    const prev = bestPerId.get(c.id);
    if (!prev || c.rarity > prev.rarity) bestPerId.set(c.id, c);
  });

  const ranked = [...bestPerId.values()].sort((a, b) => b.rarity - a.rarity);
  const roasts = ranked.filter((c) => c.tone === 'roast');
  const rest = ranked.filter((c) => c.tone !== 'roast');

  const picked = rest.slice(0, limit);
  // Slot the single best roast in last, trading out the weakest positive card
  // only when the strip is already full — a round with nothing good in it
  // still shows its roast rather than nothing at all.
  if (roasts.length > 0 && limit > 1) {
    if (picked.length >= limit) picked.splice(limit - 1, 1, roasts[0]);
    else picked.push(roasts[0]);
  }
  return picked.slice(0, limit);
}

// One call for the screen: highlights from the round in memory, plus career
// records when the viewer's history has been loaded (pass `myRounds`/`roundKey`
// only when the viewer actually played — a friend's round has no records of
// yours to beat).
export function buildRoundAchievements({
  tournament, roundIndex, myRounds = null, roundKey = null, limit = 4,
} = {}) {
  const highlights = buildRoundHighlights(tournament, roundIndex);
  const records = myRounds && roundKey
    ? buildPersonalRecords(myRounds, roundKey)
    : [];
  return selectAchievements([...records, ...highlights], { limit });
}
