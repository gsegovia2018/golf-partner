// Plain-language explainer copy for the My Stats (i) buttons. Each entry feeds
// StatDetailSheet's title / subtitle / explainer props. Keyed by a stable
// string used as `infoKey` on SectionCard / MetricRow / FormMetricBlock.
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
    title: 'Score distribution',
    subtitle: 'How your holes break down',
    explainer: 'Counts every scored hole by result — eagle-or-better through triple-bogey-or-worse — '
      + 'across all selected rounds.',
  },
  parType: {
    title: 'Par type',
    subtitle: 'Net points by hole length',
    explainer: 'Average net Stableford points per hole, split by par 3 / 4 / 5. The "played" '
      + 'figure is how many holes of that type are in the sample.',
  },
  holeDifficulty: {
    title: 'Hole difficulty',
    subtitle: 'Net points by stroke index',
    explainer: 'Average net points per hole, split by the printed stroke index: hard (SI 1-6), '
      + 'mid (SI 7-12), easy (SI 13-18).',
  },
  roundShape: {
    title: 'Round shape',
    subtitle: 'Front vs back, openers vs closers',
    explainer: 'Average net points across the front and back nine, and across your opening and '
      + 'closing three holes — useful for spotting slow starts or fades.',
  },
  recovery: {
    title: 'Recovery',
    subtitle: 'Bouncing back and scrambling',
    explainer: 'Bounce-back rate is how often you follow a bogey-or-worse with a birdie-or-better. '
      + 'Scrambling is how often you still make par after missing the green.',
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
};
