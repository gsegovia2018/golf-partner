// Plain-language explainer copy for the My Stats (i) buttons. Each entry feeds
// StatDetailSheet's title / subtitle / explainer props. Keyed by a stable
// string used as `infoKey` on SectionCard / MetricRow / FormMetricBlock.

const strokesGainedExplainer = (targetHandicap) => {
  const isScratch = targetHandicap == null || targetHandicap === 0;
  const title = isScratch
    ? 'Strokes Gained'
    : `Strokes Gained vs handicap ${targetHandicap}`;
  const subtitle = isScratch
    ? 'How you compare to a scratch golfer'
    : `How you compare to a handicap-${targetHandicap} golfer`;
  const reference = isScratch ? 'a scratch golfer' : `a handicap-${targetHandicap} golfer`;
  const positiveCmp = isScratch ? 'scratch' : `your target`;
  return {
    title,
    subtitle,
    explainer: `Strokes Gained tells you how your game compares to ${reference} from the same spots `
      + `on the course. Positive means you played that part of the game better than ${positiveCmp}; `
      + 'negative means worse.\n\n'
      + 'Five categories: Off the tee compares each logged drive (distance + lie) against the typical '
      + 'drive for your target on a standard-length hole — no course measurements needed. Approach, '
      + 'short game and putting use the distance buckets you log; penalties compare your penalty count with the typical count for '
      + `${reference}.\n\n`
      + 'Recovery shots and lay-ups between the drive and the approach are not attributed to a '
      + 'category — the "Where your strokes go" card shows them honestly as "In-between & untracked" '
      + 'so everything always adds up to your real scores.\n\n'
      + 'A category only shows a number once it has enough logged holes behind it. Because you log '
      + "buckets instead of exact yardage, numbers are estimates built on Mark Broadie's published "
      + 'baselines — accurate to about ±0.2 strokes per round.',
  };
};

export const statExplainers = {
  recentForm: {
    title: 'Recent Form',
    subtitle: 'Are you trending up or down?',
    explainer: 'Compares your last few rounds against everything before them. '
      + 'The line shows points scored in each selected round, oldest to newest. '
      + 'Improving means your recent points-per-round average beats your earlier one.',
  },
  strengths: {
    title: 'Strengths & Pain Points',
    subtitle: 'Where you gain and lose points',
    explainer: 'Every part of your game is scored as net Stableford points per hole '
      + 'and compared to your overall average. Cells well above average are strengths; '
      + 'well below are pain points. Only buckets with at least 12 holes are ranked, '
      + 'so a couple of lucky holes will not show up here.',
  },
  pointsPerRound: {
    title: 'Points per round',
    subtitle: 'Total Stableford points each round',
    explainer: 'Net Stableford points for every selected round, oldest to newest. Higher is better.',
  },
  strokesVsPar: {
    title: 'Strokes vs par',
    subtitle: 'Gross strokes above or below par',
    explainer: 'Your total strokes minus the par of the holes you played. Lower is better; '
      + 'a negative number means under par.',
  },
  scoreMix: {
    title: 'Score mix',
    subtitle: 'Birdies, pars and bogeys over time',
    explainer: 'For each round, the share of holes that were birdie-or-better, par, or '
      + 'bogey-or-worse. A growing green band means more good holes.',
  },
  recentVsHistory: {
    title: 'Recent vs History',
    subtitle: 'Recent rounds vs everything earlier',
    explainer: 'Splits your selected rounds into the most recent few and all earlier ones, '
      + 'then compares each metric. The mini chart shows that metric for every selected round.',
  },
  fairwaysHit: {
    title: 'Fairways hit',
    subtitle: 'Tee-shot accuracy',
    explainer: 'The share of par-4 and par-5 tee shots that found the fairway. '
      + 'Needs shot tracking logged during the round.',
  },
  greensInReg: {
    title: 'Greens in regulation',
    subtitle: 'Reaching the green with putts to spare',
    explainer: 'A green is "in regulation" when you reach it with at least two strokes left '
      + 'for putting. Needs shot tracking logged during the round.',
  },
  putts: {
    title: 'Putts per round',
    subtitle: 'Putting workload',
    explainer: 'Total putts in the round. Fewer is better. Needs shot tracking logged during the round.',
  },
  threePutts: {
    title: '3-putts per round',
    subtitle: 'Costly putting holes',
    explainer: 'Holes where you took three or more putts. Needs shot tracking logged during the round.',
  },
  scoreDistribution: {
    title: 'Scoring patterns',
    subtitle: 'Good and bad results per round',
    explainer: 'Counts every scored hole by result — eagle-or-better through triple-bogey-or-worse — '
      + 'across all selected rounds. The card converts those counts into per-round patterns so '
      + 'you can see whether scoring chances or big numbers are driving the round.',
  },
  parType: {
    title: 'Course scoring patterns',
    subtitle: 'Where the course profile helps or hurts',
    explainer: 'Average net Stableford points per hole, split by par 3 / 4 / 5 and by stroke-index '
      + 'difficulty. Each row is compared with your own average points per hole.',
  },
  holeDifficulty: {
    title: 'Hole difficulty',
    subtitle: 'Net points by stroke index',
    explainer: 'Average net points per hole, split into thirds by the printed stroke index: the '
      + 'hardest third, the middle third, and the easiest third of holes (e.g. SI 1-6/7-12/13-18 '
      + 'on an 18-hole round, SI 1-3/4-6/7-9 on a 9-hole round).',
  },
  roundShape: {
    title: 'Round timing patterns',
    subtitle: 'Front vs back, openers vs closers',
    explainer: 'Average net points across the front and back nine, and across your opening and '
      + 'closing three holes — useful for spotting slow starts or fades.',
  },
  recovery: {
    title: 'Recovery patterns',
    subtitle: 'Bouncing back and scrambling',
    explainer: 'Bounce-back rate is how often you follow a bogey-or-worse with a birdie-or-better. '
      + 'Scrambling, sand saves, 1-putt saves, and bunker visits show how well you limit damage '
      + 'after missing the ideal route.',
  },
  teeShot: {
    title: 'Tee result patterns',
    subtitle: 'How tee outcomes change your points',
    explainer: 'Average net Stableford points after each tee result, compared with your own average '
      + 'points per hole. Good rows are outcomes that lift your scoring; bad rows are tee outcomes '
      + 'that drag the hole below your normal level.',
  },
  driveBuckets: {
    title: 'Drive bucket patterns',
    subtitle: 'Direction and penalty impact',
    explainer: 'Groups logged drives by result bucket and shows the average points, score versus par, '
      + 'penalty rate, and gap versus your own average. This is pattern data, not target-handicap '
      + 'benchmarking.',
  },
  approachDistance: {
    title: 'Approach distance patterns',
    subtitle: 'Which distances create scoring',
    explainer: 'Groups approach shots by distance bucket and compares the average points from those '
      + 'holes with your own scoring average. It highlights the distances that are producing points '
      + 'and the ones that need practice.',
  },
  teeShotImpact: {
    title: 'Tee shot impact',
    subtitle: 'What your drive costs you',
    explainer: 'Average net points on holes grouped by tee-shot result — fairway found, missed, '
      + 'or after a tee penalty. Needs shot tracking logged during the round.',
  },
  puttingDriving: {
    title: 'Putting & driving',
    subtitle: 'Shot-tracking detail',
    explainer: 'Putting and driving aggregates from holes where you logged shot detail.',
  },
  sgScoring: {
    title: 'Scoring metrics',
    subtitle: 'Score by hole type versus your target handicap',
    explainer: 'Par 3, par 4, and par 5 average score show your gross strokes on each hole type '
      + 'against the target-handicap benchmark. Birdies, pars, bogeys, and doubles+ are converted '
      + 'to per-round rates so the result mix is comparable across different sample sizes.',
  },
  sgDriving: {
    title: 'Driving vs target',
    subtitle: 'Accuracy, misses, penalties, and benchmark distance',
    explainer: 'Fairways hit, left misses, right misses, and tee penalties compare your logged '
      + 'tee shots with the target-handicap benchmark. Drive distance averages the distance '
      + 'buckets you log on the scorecard against the benchmark driver distance.',
  },
  sgApproach: {
    title: 'Approach vs target',
    subtitle: 'Regulation approach SG and green rate',
    explainer: 'Approach rows use the logged bucket: hole distance on par 3s, '
      + 'your 2nd shot on a par 4, or your 3rd shot on a par 5. Green rate uses '
      + 'the logged finish when present, so approach shots stay separate from '
      + 'short-game recovery shots.',
  },
  sgPutting: {
    title: 'Putting vs target',
    subtitle: 'Putting workload and distance-bucket strokes gained',
    explainer: 'Putts per round and 3-putts per round compare your putting volume with the '
      + 'target-handicap benchmark. Distance putting rows compare your average putts and '
      + '3-putt rate from each first-putt distance bucket with the target expectation.',
  },
  coachPractice: {
    title: 'Practice Plan',
    subtitle: 'Drills matched to your biggest leaks',
    explainer: 'Each block pairs your biggest measured leak with a specific drill and a pass '
      + 'target, so a practice session is objectively passed or failed. The "worth" line uses '
      + 'the approximation that 1 stroke gained ≈ 1 Stableford point per round.\n\n'
      + 'The order comes from the Coach board: fix-first leaks get the first block, a second '
      + 'area keeps practice balanced, and the on-course cue needs no range time at all.',
  },
  playSmarter: {
    title: 'Play Smarter',
    subtitle: 'Course decisions worth points without practice',
    explainer: 'These tips come from fixed rules over your own tracked shots — laying up when '
      + 'a distance band leaks, clubbing down when drives find trouble, lagging long putts, '
      + 'guarding a one-sided miss, and avoiding short-side bunkers. A tip only appears once '
      + 'there is enough data behind it, and each shows its payoff using the approximation '
      + 'that 1 stroke gained ≈ 1 Stableford point per round.',
  },
  strokesGained: strokesGainedExplainer,
  courseMastery: {
    title: 'Course Mastery',
    subtitle: 'How you score, course by course',
    explainer: 'Rounds, average points, and best points per round at each course you\'ve '
      + 'played — only fully-scored rounds count, so an early-finished game never drags '
      + 'a course average down. Rounds are grouped by the course itself, so renaming a '
      + 'course label keeps its history together. Trend compares your latest complete '
      + 'round there with the one before it; a course you\'ve only completed once shows '
      + 'no trend yet.',
  },
  careerMilestones: {
    title: 'Career Milestones',
    subtitle: 'Your best feats across every selected round',
    explainer: 'All counts are net (handicap-adjusted) Stableford results — the Strokes '
      + 'Gained tab\'s scoring mix counts gross, so the two can legitimately differ. '
      + 'Birdies, eagles, and your longest streak of par-or-better holes count every '
      + 'scored hole, including holes from an early-finished round. Best nine and best round '
      + 'only look at fully-scored rounds, so a partial game can never claim a personal best.',
  },

  // ── Course drill-down screen (CourseStatsScreen) ──
  courseRecord: {
    title: 'Course record',
    subtitle: 'Your rounds at this course',
    explainer: 'Rounds, average points, and best points count only fully-scored rounds '
      + 'here — a game called early never drags the average down. Points are net '
      + '(handicap-adjusted) Stableford totals per round; average strokes is your gross '
      + 'strokes per complete round. The trend arrow compares your latest complete round '
      + 'with the one before it — a swing under 2 points reads as flat. The front/back '
      + 'line is average points per hole on holes 1–9 vs 10–18, counting only rounds '
      + 'where both nines were fully scored.',
  },
  courseScoreMix: {
    title: 'Score mix',
    subtitle: 'What you actually shot, hole by hole',
    explainer: 'Every scored hole you\'ve played at this course, including holes from '
      + 'unfinished rounds. Each hole is classified by your GROSS score against par — '
      + 'your handicap is not considered: eagle+ is two or more under, then birdie, par, '
      + 'bogey, double, and worse. Bar heights compare how often each result happens; '
      + 'the number is the count of holes.',
  },
  courseHighlights: {
    title: 'Highlights',
    subtitle: 'Your nemesis and best hole here',
    explainer: 'Each hole\'s average gross strokes vs par, pooled across every round '
      + 'you\'ve played it. The nemesis is the hole with the worst average, the best '
      + 'hole the lowest. A hole only qualifies once you\'ve played it in at least two '
      + 'rounds — one bad day is noise, not a nemesis.',
  },
  courseShotDetail: {
    title: 'Shot detail',
    subtitle: 'From the shots you logged at this course',
    explainer: 'Only holes where you logged shot detail count — nothing is guessed for '
      + 'unlogged holes.\n\n'
      + 'Putts / 18 holes: total putts divided by holes with putts logged, scaled to 18 — '
      + 'so a half-logged round can\'t deflate it. 3-putts / 18 uses the same scaling for '
      + 'holes with three or more putts.\n\n'
      + 'Penalties / 18: tee and other penalty strokes divided by holes with any logged '
      + 'detail, scaled to 18.\n\n'
      + 'GIR: of the holes with a score and putts logged, the share where you reached '
      + 'the green in regulation (strokes minus putts is at least two under par).\n\n'
      + 'The bars split every logged drive (par 3s excluded) by result — each bar shows '
      + 'its percentage of all recorded drives, ordered short, left, fairway, super, right.',
  },
  courseHoleByHole: {
    title: 'Hole by hole',
    subtitle: 'Every hole, pooled across your rounds',
    explainer: 'One row per hole, combining every round you\'ve scored it ("3x" = played '
      + 'three times). Par and stroke index come from the most recent round, so course '
      + 'edits show current values. Avg is your average gross strokes with the difference '
      + 'to par under it; Best is your lowest gross score on the hole; Pts is your average '
      + 'net (handicap-adjusted) Stableford points. Where you logged them, the small line '
      + 'adds average putts (over the holes that logged putts) and total penalties.',
  },
};
