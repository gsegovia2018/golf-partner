// On-course strategy tips (spec §2.3): exactly five deterministic rules,
// each firing only when its data threshold is met, each quantified from the
// player's own numbers in ≈ Stableford points per round (1 SG ≈ 1 pt).

const round2 = (n) => Math.round(n * 100) / 100;

function layUpRule(stats) {
  const long = stats.approachTarget?.buckets?.['150-200'];
  const short = stats.approachTarget?.buckets?.['50-100'];
  const rounds = stats.strokesGained?.roundsByCategory?.approach ?? 0;
  if (!long || !short || rounds <= 0) return null;
  if (long.holes < 8 || short.holes < 8) return null;
  if (!(long.avgSg <= -0.25 && short.avgSg >= long.avgSg + 0.3)) return null;
  const payoff = (short.avgSg - long.avgSg) * (long.holes / rounds);
  return {
    id: 'layup-150-200',
    title: 'Lay up from 150-200 m',
    reason: `From 150-200 m you average ${long.avgSg} SG per shot, but from 50-100 m you average ${short.avgSg}. Laying up to wedge range turns your worst distance into one of your best.`,
    payoffPointsPerRound: round2(payoff),
    sample: long.holes + short.holes,
    basis: 'your approach buckets',
  };
}

function clubDownRule(stats) {
  const lies = stats.driveLies;
  const teeSg = stats.strokesGained?.byCategory?.offTheTee;
  if (!lies || lies.drives < 15 || lies.troubleRate == null) return null;
  if (!(lies.troubleRate >= 0.25 && Number.isFinite(teeSg) && teeSg <= -0.3)) return null;
  // Assume clubbing down rescues about half the tee leak — stated approximation.
  const payoff = Math.abs(teeSg) * 0.5;
  return {
    id: 'tee-club-down',
    title: 'Club down on tight tee shots',
    reason: `${Math.round(lies.troubleRate * 100)}% of your tracked drives finish in sand or trouble, and the tee game costs ${round2(teeSg)} SG per round. A 3-wood that stays dry keeps roughly half of that.`,
    payoffPointsPerRound: round2(payoff),
    sample: lies.drives,
    basis: 'your drive lies',
  };
}

function lagFirstRule(stats) {
  const lag = stats.puttingTarget?.buckets?.['6+'];
  const rounds = stats.strokesGained?.roundsByCategory?.putting ?? 0;
  if (!lag || lag.attempts < 10 || rounds <= 0) return null;
  if (!(lag.threePuttRate >= 25 && Number.isFinite(lag.sgPerPutt) && lag.sgPerPutt < 0)) return null;
  const payoff = Math.abs(lag.sgPerPutt) * (lag.attempts / rounds);
  return {
    id: 'lag-first-6plus',
    title: 'Lag first from 6+ m',
    reason: `You three-putt ${lag.threePuttRate}% of putts from 6+ m. From that range the only goal is a tap-in: pick a 1 m circle, not the hole.`,
    payoffPointsPerRound: round2(payoff),
    sample: lag.attempts,
    basis: 'your long putts',
  };
}

function missSideRule(stats) {
  const buckets = stats.driveImpact?.buckets;
  const roundCount = stats.roundCount ?? 0;
  if (!buckets || roundCount <= 0) return null;
  const left = buckets.left ?? { holes: 0, avgPoints: 0 };
  const right = buckets.right ?? { holes: 0, avgPoints: 0 };
  const fairway = buckets.fairway;
  const missTotal = left.holes + right.holes;
  if (missTotal < 10 || !fairway || fairway.holes < 8) return null;
  const dominant = left.holes >= right.holes ? { side: 'left', ...left } : { side: 'right', ...right };
  const other = dominant.side === 'left' ? right : left;
  if (dominant.holes < 2 * Math.max(1, other.holes)) return null;
  const perHoleCost = Math.max(0, fairway.avgPoints - dominant.avgPoints);
  if (perHoleCost <= 0) return null;
  const payoff = perHoleCost * (dominant.holes / roundCount);
  return {
    id: 'tee-miss-side',
    title: `Guard the ${dominant.side} miss`,
    reason: `${dominant.holes} of your ${missTotal} tracked misses go ${dominant.side}, costing ${round2(perHoleCost)} pts per hole versus a fairway hit. Aim at the ${dominant.side === 'left' ? 'right' : 'left'} half of the fairway and let the miss find the middle.`,
    payoffPointsPerRound: round2(payoff),
    sample: missTotal,
    basis: 'your miss pattern',
  };
}

function avoidSandRule(stats) {
  const sand = stats.upAndDown?.byLie?.sand;
  const nonSand = stats.upAndDown?.byLie?.nonSand;
  const visits = stats.bunkerVisits?.avgPerRound ?? 0;
  if (!sand || !nonSand || sand.attempts < 6 || nonSand.attempts < 6) return null;
  if (sand.rate == null || nonSand.rate == null) return null;
  if (!(sand.rate <= nonSand.rate - 0.2 && visits > 0)) return null;
  const payoff = (nonSand.rate - sand.rate) * visits;
  return {
    id: 'avoid-short-side-sand',
    title: 'Take bunkers out of play',
    reason: `You convert ${Math.round(nonSand.rate * 100)}% of up-and-downs from grass but only ${Math.round(sand.rate * 100)}% from sand, and you visit ${visits} bunkers per round. Aim to the fat side of the green — long or wide beats short-sided sand.`,
    payoffPointsPerRound: round2(payoff),
    sample: sand.attempts + nonSand.attempts,
    basis: 'your up-and-down split',
  };
}

const RULES = [layUpRule, clubDownRule, lagFirstRule, missSideRule, avoidSandRule];

export function buildStrategyTips(stats) {
  if (!stats) return [];
  return RULES
    .map((rule) => rule(stats))
    .filter(Boolean)
    .sort((a, b) => b.payoffPointsPerRound - a.payoffPointsPerRound);
}
