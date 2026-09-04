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
//
// GROSS vs NET, the rule this module follows throughout: anything named with
// a golf word — par, birdie, eagle, bogey — is read GROSS, off the card, the
// way it would be said out loud in the bar. Anything counted in points —
// playing to handicap, the nine splits, carrying a pair — stays NET, because
// that is what the leaderboard is actually made of. The blow-up roast is the
// one deliberate exception (see scoringCandidates).
import {
  playerStreaks, playerScoreDistribution, playerRoundHistory,
  chaosHoles, frontBackSplit, bounceBackRate, pairCarryRatio,
  parTypeSplit, clutchOnHardest, hotStretch, skinsLeaderboard,
  collectiveExtremes, playerConsistency, pickupChampion, zeroHero,
  par3Heartbreak, hallOfShame, nemesisEncore,
} from './statsEngine';
import {
  buildSyntheticTournament, careerMilestones, courseMastery,
  syntheticDifferential, CANON_ID,
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
// Two gross birdies in a row is already a story.
const MIN_BIRDIE_STREAK = 2;
// A run of nothing but bogeys is only funny once it is this long.
const MIN_BOGEY_TRAIN = 4;
// Par 5s: enough of them to mean something, and the average that earns a card.
const MIN_PAR5_HOLES = 3;
const MIN_PAR5_AVG = 2.5;
// The n hardest holes by stroke index, for the clutch card.
const CLUTCH_HOLES = 3;
// Best rolling window, and the points it takes to call it hot (2.5 a hole).
const HOT_STRETCH_HOLES = 6;
const MIN_HOT_STRETCH_POINTS = 15;
// Holes won outright before "skins" is worth saying.
const MIN_SKINS = 4;
// Per-hole points standard deviation at or under which a round reads as
// mechanical rather than merely steady.
const MAX_METRONOME_STDEV = 0.9;
// Roast thresholds: pickups, blank holes, the front-to-back points drop, and
// the average strokes on par 3s that turns the short holes into a punchline.
const MIN_PICKUPS = 3;
const MIN_NINE_DROP = 5;
const MIN_PAR3_AVG_STROKES = 5;
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
// Gross scores worth breaking for the first time, best claim first.
const GROSS_MILESTONES = [80, 90, 100];
// Career birdie counts worth a card.
const BIRDIE_MILESTONES = [10, 25, 50, 100, 250];
// Points above your average at a course before a round stands out there.
const MIN_ABOVE_COURSE_AVG = 4;
// A round summary is about the round, not a trophy cabinet: even a huge day
// shows at most this many of the viewer's own records, so the rest of the
// group still gets rows. Applied where the two families meet rather than
// inside selectAchievements, which cannot tell a record from a highlight.
const MAX_RECORDS = 3;

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

// Every run worth naming, from one gross pass per player: the par streak that
// is the headline card, the back-to-back birdies, and the bogey train.
//
// GROSS ('strokes'), so "3 in a row" means three actual pars. Under the net
// metric a 20-handicapper receiving a shot on twelve holes posts "par or
// better" almost everywhere, and the card became a participation award.
function streakCandidates(tournament, roundIndex) {
  const out = [];
  (tournament.players ?? []).forEach((p) => {
    const streak = playerStreaks(tournament, p.id, { metric: 'strokes', roundIndex });

    if (streak.bestParStreak >= MIN_PAR_STREAK) {
      const holes = holeNumbers(streak.parStreakHoles);
      // Capped: a streak is a round-local feat, and an 18-hole run of pars
      // must still not outrank a career record in selectAchievements.
      out.push(candidate(
        'parStreak', 'great', 40 + Math.min(streak.bestParStreak, 6) * 8,
        `${streak.bestParStreak} in a row`,
        `Par or better on ${holeSpanLabel(holes)}`,
        { playerId: p.id, playerName: p.name, holes },
      ));
    }

    if (streak.bestBirdieStreak >= MIN_BIRDIE_STREAK) {
      const holes = holeNumbers(streak.birdieStreakHoles);
      out.push(candidate(
        'birdieStreak', 'great', 62 + streak.bestBirdieStreak * 8,
        `${streak.bestBirdieStreak} birdies in a row`,
        `Straight through ${holeSpanLabel(holes)}`,
        { playerId: p.id, playerName: p.name, holes },
      ));
    }

    if (streak.bogeyOnlyStreak >= MIN_BOGEY_TRAIN) {
      const holes = holeNumbers(streak.bogeyOnlyStreakHoles);
      out.push(candidate(
        'bogeyTrain', 'fun', 38 + streak.bogeyOnlyStreak,
        'The bogey train',
        `${streak.bogeyOnlyStreak} bogeys in a row on ${holeSpanLabel(holes)}, nothing else`,
        { playerId: p.id, playerName: p.name, holes },
      ));
    }
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

// Par 5s are where a good round gets built. Net points, because points are
// what the hole actually paid out.
function par5Candidates(slice) {
  const out = [];
  (slice.players ?? []).forEach((p) => {
    const { par5 } = parTypeSplit(slice, p.id);
    if (par5.holes < MIN_PAR5_HOLES || par5.avgPoints < MIN_PAR5_AVG) return;
    out.push(candidate(
      'par5Playground', 'good', 46 + Math.round((par5.avgPoints - PLAYED_TO_HANDICAP) * 10),
      'Par 5s were a playground',
      `${par5.totalPoints} points off ${par5.holes} par 5s`,
      { playerId: p.id, playerName: p.name, holes: holeNumbers(par5.breakdown) },
    ));
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

// The three hardest holes on the card, and whoever refused to be bothered.
function clutchCandidate(slice) {
  const top = clutchOnHardest(slice, { topN: CLUTCH_HOLES })[0];
  if (!top || top.holesPlayed < CLUTCH_HOLES || top.avgPoints < PLAYED_TO_HANDICAP) return null;
  return candidate(
    'clutchOnHardest', 'good', 54 + Math.round((top.avgPoints - PLAYED_TO_HANDICAP) * 8),
    'Owned the hard holes',
    `${top.points} points across the ${CLUTCH_HOLES} toughest holes on the card`,
    { playerId: top.player.id, playerName: top.player.name, holes: holeNumbers(top.breakdown) },
  );
}

// The best six holes anyone strung together. hotStretch only ever returns
// physically adjacent windows, so the hole span is a real stretch of golf.
function hotStretchCandidate(slice) {
  const top = hotStretch(slice, { windowSize: HOT_STRETCH_HOLES })[0];
  if (!top || top.points < MIN_HOT_STRETCH_POINTS) return null;
  return candidate(
    'hotStretch', 'good', 50 + (top.points - MIN_HOT_STRETCH_POINTS) * 3,
    `${HOT_STRETCH_HOLES} holes on fire`,
    `${top.points} points from hole ${top.startHole} to ${top.endHole}`,
    { playerId: top.player.id, playerName: top.player.name },
  );
}

// Holes won outright — nobody level, no ties. Silent unless one player leads
// the skins count on their own, since "won 5 holes" is not true of two people.
function skinsCandidate(slice) {
  const board = skinsLeaderboard(slice).leaderboard;
  const top = board[0];
  if (!top || top.skins < MIN_SKINS) return null;
  if (board[1] && board[1].skins === top.skins) return null;
  return candidate(
    'skinsKing', 'good', 44 + top.skins * 2,
    `Won ${top.skins} holes outright`,
    'Best score on the hole, nobody alongside',
    { playerId: top.player.id, playerName: top.player.name, holes: holeNumbers(top.breakdown) },
  );
}

// The two holes the whole group agreed about. collectiveExtremes only counts
// a hole every single participant scored, so both claims cover everyone.
function collectiveCandidates(slice) {
  const { disasters, gimmes } = collectiveExtremes(slice);
  const out = [];
  if (disasters.length > 0) {
    const h = disasters[0];
    out.push(candidate(
      'everyoneBlanked', 'fun', 46,
      `Hole ${h.holeNumber} beat everyone`,
      `Not one point between ${h.scores.length} players on a par ${h.par}`,
      { holes: [h.holeNumber] },
    ));
  }
  if (gimmes.length > 0) {
    const h = gimmes[0];
    out.push(candidate(
      'everyoneScored', 'fun', 36,
      `Hole ${h.holeNumber} gave itself away`,
      `All ${h.scores.length} of you walked off with points`,
      { holes: [h.holeNumber] },
    ));
  }
  return out;
}

// The flattest card of the day — the same number, hole after hole. Only a
// fully-scored round qualifies: a handful of holes is not a metronome.
function metronomeCandidate(slice) {
  const holeCount = holeCountOf(slice.rounds[0]);
  const top = playerConsistency(slice).filter((r) => r.holesPlayed === holeCount)[0];
  if (!top || top.stdev == null || top.stdev > MAX_METRONOME_STDEV) return null;
  return candidate(
    'metronome', 'fun', 44,
    'Metronome',
    `${top.mean} points a hole, and barely a wobble all day`,
    { playerId: top.player.id, playerName: top.player.name },
  );
}

// Ball in the pocket. Ties are left alone — "picked up 4 times" names one
// person, and it must be the right one.
function pickupCandidate(slice) {
  const champ = pickupChampion(slice);
  if (!champ || champ.value < MIN_PICKUPS || champ.entries.length > 1) return null;
  const top = champ.entries[0];
  const holes = holeNumbers(top.breakdown);
  return candidate(
    'pickupKing', 'roast', 34 + champ.value,
    `Picked up ${champ.value} times`,
    `Pocket beat putter on ${holeListLabel(holes)}`,
    { playerId: top.player.id, playerName: top.player.name, holes },
  );
}

// Blank holes — zero Stableford points, net, so the shots were already given.
function zeroHeroCandidate(slice) {
  const z = zeroHero(slice);
  if (!z) return null;
  const top = z.entries[0];
  if (z.entries[1] && z.entries[1].count === top.count) return null;
  const holes = holeNumbers(top.breakdown);
  return candidate(
    'zeroHero', 'roast', 32 + top.count,
    `${top.count} holes worth nothing`,
    `Zero points on ${holeListLabel(holes)}`,
    { playerId: top.player.id, playerName: top.player.name, holes },
  );
}

// The mirror of the back-nine charge: whoever spent it all before the turn.
// hallOfShame's collapse needs both nines fully scored, so 9-hole and partial
// rounds silently claim nothing.
function fadeCandidate(slice) {
  const collapse = hallOfShame(slice).collapse;
  if (!collapse || collapse.value < MIN_NINE_DROP) return null;
  const top = collapse.entries[0];
  return candidate(
    'frontNineFade', 'roast', 36 + top.drop,
    'Ran out of golf',
    `${top.front} points on the front, ${top.back} on the back`,
    { playerId: top.player.id, playerName: top.player.name },
  );
}

// The short holes, which are supposed to be the free ones. par3Heartbreak
// already needs 3 par 3s played, and returns everyone tied for worst — a tie
// makes the roast arbitrary, so it stays quiet.
function par3Candidate(slice) {
  const worst = par3Heartbreak(slice);
  if (!worst || worst.value < MIN_PAR3_AVG_STROKES || worst.entries.length > 1) return null;
  const top = worst.entries[0];
  return candidate(
    'par3Trouble', 'roast', 30 + Math.round((worst.value - 4) * 4),
    'Par 3s were not the free ones',
    `${worst.value} strokes a hole across ${top.holes} of them`,
    { playerId: top.player.id, playerName: top.player.name, holes: holeNumbers(top.breakdown) },
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
    ...streakCandidates(tournament, roundIndex),
    ...scoringCandidates(tournament, roundIndex),
    ...handicapCandidates(tournament, roundIndex),
    ...par5Candidates(slice),
    ...collectiveCandidates(slice),
    chaosCandidate(slice),
    nineSwingCandidate(slice),
    carryCandidate(slice),
    bounceBackCandidate(slice),
    clutchCandidate(slice),
    hotStretchCandidate(slice),
    skinsCandidate(slice),
    metronomeCandidate(slice),
    pickupCandidate(slice),
    zeroHeroCandidate(slice),
    fadeCandidate(slice),
    par3Candidate(slice),
  ].filter(Boolean);
}

// ── Tier B: the viewer's career records ───────────────────────────

// Most birdies the player has ever made in a single round across `synthetic`.
// careerMilestones only reports the career TOTAL, so the per-round maximum is
// derived here — one distribution call per round, over history only. Gross,
// matching careerMilestones and the birdie card in Tier A.
function bestBirdiesInARound(synthetic) {
  let best = 0;
  (synthetic.rounds ?? []).forEach((_, ri) => {
    const dist = playerScoreDistribution(synthetic, CANON_ID, { metric: 'strokes', roundIndex: ri });
    if (dist.birdies > best) best = dist.birdies;
  });
  return best;
}

// The milestone reached by playing this round, if any — `count` is the
// running total INCLUDING it.
function milestoneReached(count, ladder) {
  return ladder.includes(count) ? count : null;
}

// The highest rung of `ladder` crossed going from `before` to `after`. Round
// counts step by one and can use milestoneReached, but a tally can jump
// several rungs at once (three birdies today can carry a career from 48 to
// 51), where exact equality would silently skip the milestone entirely.
function milestoneCrossed(before, after, ladder) {
  const hit = ladder.filter((m) => before < m && after >= m);
  return hit.length ? Math.max(...hit) : null;
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
  // Gross on both counts — careerMilestones measures its streak and birdie
  // records with metric 'strokes', and a net figure compared against a gross
  // record would hand out a "longest run of pars yet" most weeks.
  const thisStreak = playerStreaks(thisSynth, CANON_ID, { metric: 'strokes' }).bestParStreak;
  const thisGross = playerScoreDistribution(thisSynth, CANON_ID, { metric: 'strokes' });
  const thisBirdies = thisGross.birdies;

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

    const bestRoundEver = fullLength
      && milestones.bestRound != null && thisHist.points > milestones.bestRound;
    if (bestRoundEver) {
      out.push(candidate(
        'bestRoundEver', 'great', 100,
        'Best round ever',
        `${thisHist.points} points — beats your ${milestones.bestRound} at ${milestones.bestRoundCourse ?? 'your old best'}`,
      ));
    }

    // The handicap-neutral twin. Points drift as an index moves, so a round
    // played off 20 and a round played off 12 are not really comparable;
    // the differential is. Only when the points record did NOT fire —
    // two "best ever" cards about the same round is one too many, and the
    // points one is what the group actually talks about.
    if (!bestRoundEver) {
      const thisDiff = syntheticDifferential(thisSynth.rounds[0], thisSynth.players[0]);
      if (thisDiff && milestones.bestDifferential != null
        && thisDiff.differential < milestones.bestDifferential) {
        out.push(candidate(
          'bestDifferentialEver', 'great', 96,
          'Best round ever, handicap aside',
          `${thisDiff.differential} differential — your best was ${milestones.bestDifferential}`,
        ));
      }
    }

    // Breaking 100, 90 or 80 is a landmark rather than a comparison, and the
    // one number a golfer quotes for the rest of their life. It needs a real
    // gross total though: a card with a pickup on it has no true stroke
    // count (the pickup is the deterministic par + 2 + shots), so it stays
    // quiet rather than crediting a score that was never actually holed out.
    if (fullLength && !pickupChampion(thisSynth)) {
      const priorBest = playerRoundHistory(histSynth, CANON_ID)
        .filter((h) => h.holesPlayed === thisHist.holesPlayed)
        .reduce((best, h) => Math.min(best, h.strokes), Infinity);
      const broke = GROSS_MILESTONES.find((m) => thisHist.strokes < m && priorBest >= m);
      if (broke) {
        out.push(candidate(
          'brokeGross', 'great', 98,
          `Broke ${broke} for the first time`,
          `${thisHist.strokes} strokes — you had never been under ${broke}`,
        ));
      }
    }

    // A first eagle deserves the career phrasing, not the round-local one —
    // so it is deliberately filed under the SAME id as the Tier A eagle card
    // at a higher rarity, and selectAchievements swaps one for the other.
    if (thisGross.eagles > 0 && milestones.eagles === 0) {
      out.push(candidate(
        'eagle', 'great', 99,
        'Your first eagle',
        `Hole ${thisGross.eagleHoles[0].holeNumber} — there was not one on your card before today`,
        { holes: [thisGross.eagleHoles[0].holeNumber] },
      ));
    }
    if (milestones.longestParStreak != null && thisStreak > milestones.longestParStreak) {
      // A career of bogey golf has a longest par run of zero, and "your best
      // was 0" is not a sentence to put on a card — that round is a first,
      // and reads far better as one.
      out.push(candidate(
        'longestStreakEver', 'great', 84,
        'Longest run of pars yet',
        milestones.longestParStreak > 0
          ? `${thisStreak} holes — your best was ${milestones.longestParStreak}`
          : `${thisStreak} holes — the first run of pars on any card of yours`,
      ));
    }
    const bestBirdies = bestBirdiesInARound(histSynth);
    if (fullLength && thisBirdies > bestBirdies && thisBirdies >= 2) {
      out.push(candidate(
        'mostBirdiesEver', 'great', 82,
        `${thisBirdies} birdies — a new best`,
        bestBirdies > 0
          ? `Your record in one round was ${bestBirdies}`
          : 'You had never made more than one in a round',
      ));
    }

    // Best single nine ever. frontBackSplit only returns a round with both
    // nines fully scored, so a nine-hole or partial round claims nothing.
    const nine = frontBackSplit(thisSynth)[0];
    if (nine && milestones.bestNine != null) {
      const backWasBetter = nine.backTotal >= nine.frontTotal;
      const bestSide = backWasBetter ? nine.backTotal : nine.frontTotal;
      if (bestSide > milestones.bestNine) {
        out.push(candidate(
          'bestNineEver', 'great', 80,
          'Best nine you have played',
          `${bestSide} points on the ${backWasBetter ? 'back' : 'front'} — your best was ${milestones.bestNine}`,
        ));
      }
    }

    // The career birdie tally ticking past a round number. A per-hole feat,
    // so nine-hole rounds count towards it like any other.
    const birdiesBefore = milestones.birdies;
    const rung = milestoneCrossed(birdiesBefore, birdiesBefore + thisBirdies, BIRDIE_MILESTONES);
    if (rung) {
      out.push(candidate(
        'birdieMilestone', 'fun', 68,
        `Career birdie number ${rung}`,
        `${thisBirdies} today, ${birdiesBefore + thisBirdies} in the book`,
      ));
    }
  }

  // ── This course ──
  const courseKey = roundCourseKey(selected);
  const courseHistory = filterRoundsToCourse(history, courseKey);
  if (courseKey != null && courseHistory.length === 0) {
    out.push(candidate(
      'newCourse', 'fun', 64,
      `First time at ${selected.courseName}`,
      'A new course in the book',
    ));
  }
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
    } else if (sameLength && thisHist.points >= mastery.avgPoints + MIN_ABOVE_COURSE_AVG) {
      // Not a record, but well clear of what this course usually gets out of
      // you — the card that has something to say on an ordinary good day.
      out.push(candidate(
        'aboveCourseAverage', 'good', 60,
        `Well above your ${selected.courseName} average`,
        `${thisHist.points} points against your usual ${mastery.avgPoints} here`,
      ));
    }

    // A hole that has left you with nothing here before, finally answered.
    // nemesisEncore needs two blanks on the same physical hole, and the
    // course history is already filtered to this course, so every entry it
    // returns is about a hole played today.
    const scoredToday = new Map();
    const net = playerScoreDistribution(thisSynth, CANON_ID);
    [
      ...net.eagleHoles, ...net.birdieHoles, ...net.parHoles,
      ...net.bogeyHoles, ...net.doubleHoles, ...net.worseHoles,
    ].forEach((h) => scoredToday.set(h.holeNumber, h.points));
    const slain = (nemesisEncore(buildSyntheticTournament(courseHistory)) ?? [])
      .find((n) => (scoredToday.get(n.holeNumber) ?? 0) > 0);
    if (slain) {
      out.push(candidate(
        'nemesisSlain', 'great', 76,
        `Hole ${slain.holeNumber} finally paid out`,
        `It had left you with nothing ${slain.rounds.length} times here`,
        { holes: [slain.holeNumber] },
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

// At most this many cards about the same player. Group facts (no playerId)
// are exempt — they are about the round, not about anyone.
const MAX_PER_PLAYER = 2;

// Rank the pool and cap it. Four rules keep the strip from reading as a wall
// of the same thing, in the spirit of roundReportCard's selectCallouts:
//   - one card per detector id (the best instance of it), so a foursome does
//     not produce four "3 in a row" cards;
//   - at most MAX_PER_PLAYER cards about one player, so the day's hot hand
//     does not take every seat and leave the group looking absent;
//   - one guaranteed seat for a 'fun' card, so the strip is not four earnest
//     scoring facts in a row;
//   - at most one roast, and never as the leading card.
export function selectAchievements(candidates, { limit = 6 } = {}) {
  const bestPerId = new Map();
  (candidates ?? []).forEach((c) => {
    const prev = bestPerId.get(c.id);
    if (!prev || c.rarity > prev.rarity) bestPerId.set(c.id, c);
  });

  const perPlayer = new Map();
  const ranked = [];
  [...bestPerId.values()].sort((a, b) => b.rarity - a.rarity).forEach((c) => {
    if (c.playerId == null) { ranked.push(c); return; }
    const used = perPlayer.get(c.playerId) ?? 0;
    if (used >= MAX_PER_PLAYER) return;
    perPlayer.set(c.playerId, used + 1);
    ranked.push(c);
  });

  // A single card is the headline — the feed chip. Never a roast: a card that
  // exists to make someone open the round should not open with an insult.
  if (limit <= 1) return ranked.filter((c) => c.tone !== 'roast').slice(0, limit);

  // Every roast is held out of the main pool, not just the one that gets in —
  // otherwise a bad enough round out-ranks its way to a strip of nothing but
  // insults, which is the opposite of the mix. The roast takes the last seat.
  const positives = ranked.filter((c) => c.tone !== 'roast');
  const roast = ranked.find((c) => c.tone === 'roast') ?? null;
  const picked = positives.slice(0, roast ? limit - 1 : limit);

  // Guaranteed fun seat: trade the weakest card in for the best fun one, but
  // only when the ranking happened to hold none — a strip that is already
  // fun must not have its leading card demoted to make room for itself.
  const fun = positives.find((c) => c.tone === 'fun');
  if (fun && picked.length > 0 && !picked.includes(fun)) picked[picked.length - 1] = fun;

  if (roast) picked.push(roast);
  return picked.slice(0, limit);
}

// One call for the screen: highlights from the round in memory, plus career
// records when the viewer's history has been loaded (pass `myRounds`/`roundKey`
// only when the viewer actually played — a friend's round has no records of
// yours to beat).
export function buildRoundAchievements({
  tournament, roundIndex, myRounds = null, roundKey = null, limit = 6,
} = {}) {
  const highlights = buildRoundHighlights(tournament, roundIndex);
  const records = (myRounds && roundKey ? buildPersonalRecords(myRounds, roundKey) : [])
    .sort((a, b) => b.rarity - a.rarity)
    .slice(0, MAX_RECORDS);
  return selectAchievements([...records, ...highlights], { limit });
}
