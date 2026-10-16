// English catalogue: Coach v2 (causes, swing link, weekly plan). See docs/i18n.md.
// Cause sentences continue a lead-in (lead.likely / lead.consistent / lead.possible),
// so each body is a noun phrase that reads after "Most of this comes from",
// "Consistent with" and "One possibility:".
export default {
  // ── Causes: lead-ins ───────────────────────────────────────────────────
  'stats.my.coach.cause.lead.likely': 'Most of this comes from',
  'stats.my.coach.cause.lead.consistent': 'Consistent with',
  'stats.my.coach.cause.lead.possible': 'One possibility:',

  // ── Causes: putting ────────────────────────────────────────────────────
  'stats.my.coach.cause.putting.lag': 'putts from {bucket} m that three-putt ({count} of {total}, {pct}%), averaging {avgPutts} putts.',
  'stats.my.coach.cause.putting.lag.bench': 'putts from {bucket} m that three-putt ({count} of {total}, {pct}%), averaging {avgPutts} putts (a {hcp} handicap averages {expected}).',
  'stats.my.coach.cause.putting.short': 'short putts from {bucket} m, averaging {avgPutts} putts across {total} tries.',
  'stats.my.coach.cause.putting.short.bench': 'short putts from {bucket} m, averaging {avgPutts} putts across {total} tries (a {hcp} handicap averages {expected}).',
  'stats.my.coach.cause.putting.general.bench': 'putting overall, at {per18} putts per 18 holes (a {hcp} handicap averages {benchPer18}) and {threePutts} three-putts (average {benchThreePutts}).',

  // ── Causes: approach ───────────────────────────────────────────────────
  'stats.my.coach.cause.approach.short': 'approach shots from {bucket} m that finish short ({count} of {total} misses, {pct}%; {missPct}% of approaches from there miss the green).',
  'stats.my.coach.cause.approach.side': 'approach shots from {bucket} m that miss {side} ({count} of {total} misses, {pct}%).',
  'stats.my.coach.cause.approach.side.cost': 'approach shots from {bucket} m that miss {side} ({count} of {total} misses, {pct}%; a miss {side} scores {cost} Stableford points fewer than one on the green).',
  'stats.my.coach.cause.approach.bunker': 'approach shots from {bucket} m that finish in a bunker ({count} of {total} misses, {pct}%; your sand saves are {sandPct}% over {sandAttempts} tries).',
  'stats.my.coach.cause.approach.distance': 'approach shots from {bucket} m, costing {cost} strokes each across {shots} shots.',
  'stats.my.coach.cause.approach.distance.bench': 'approach shots from {bucket} m, costing {cost} strokes each across {shots} shots (more than a {hcp} handicap usually loses there).',

  // ── Causes: off the tee ────────────────────────────────────────────────
  'stats.my.coach.cause.tee.trouble.driver': 'drives that finish in sand or trouble ({count} of {total}, {pct}%).',
  'stats.my.coach.cause.tee.penalty.driver': 'driver tee shots that end in a penalty ({count} of {total} holes, {pct}%).',
  'stats.my.coach.cause.tee.penalty.driver.bench': 'driver tee shots that end in a penalty ({count} of {total} holes, {pct}%; a {hcp} handicap averages {benchPct}%).',
  'stats.my.coach.cause.tee.side': 'drives that miss {side} ({count} of {misses} misses, {pct}% of all drives).',
  'stats.my.coach.cause.tee.side.bench': 'drives that miss {side} ({count} of {misses} misses, {pct}% of all drives; a {hcp} handicap misses {benchPct}% that way).',
  'stats.my.coach.cause.tee.distance.bench': 'short drives: {distance} m against {benchDistance} m for a {hcp} handicap, over {drives} drives.',

  // ── Causes: short game and penalties ───────────────────────────────────
  'stats.my.coach.cause.short.sand': 'sand saves ({sandPct}% in {sandAttempts} tries, against {nonSandPct}% from other lies in {nonSandAttempts} tries).',
  'stats.my.coach.cause.short.chip.bench': 'up-and-downs ({pct}% over {attempts} tries, against {expectedPct}% expected for a {hcp} handicap).',
  'stats.my.coach.cause.penalty.tee': 'penalties off the tee ({count} of your {total} penalties).',
  'stats.my.coach.cause.penalty.tee.bench': 'penalties off the tee ({count} of your {total} penalties, {perRound} a round against {benchPerRound} for a {hcp} handicap).',
  'stats.my.coach.cause.penalty.other': 'penalties from other shots ({count} of your {total} penalties).',
  'stats.my.coach.cause.penalty.other.bench': 'penalties from other shots ({count} of your {total} penalties, {perRound} a round against {benchPerRound} for a {hcp} handicap).',

  // ── Swing link ─────────────────────────────────────────────────────────
  'stats.my.coach.swing.linked.consistent': 'Your {club} swing recorded {date} shows {fault}, the fault that usually causes this.',
  'stats.my.coach.swing.linked.possible': 'Your {club} swing recorded {date} may show {fault}, which can cause this.',
  'stats.my.coach.swing.stale.consistent': 'Your {club} swing recorded {date} showed {fault}, but it is old now.',
  'stats.my.coach.swing.stale.possible': 'Your {club} swing recorded {date} may have shown {fault}, but it is old now.',
  'stats.my.coach.swing.wrongClub': 'Your last swing was with the {lastClub}. Record one with the {club} to test this.',
  'stats.my.coach.swing.none': 'No swing recorded with the {club} yet.',
  'stats.my.coach.swing.swingOnly': 'Your {club} swing recorded {date} showed {fault}. That is not part of this leak, but worth a look.',
  'stats.my.coach.swing.secondSignal': 'The same swing also shows {fault}, which can add to this leak.',
  'stats.my.coach.swing.cta.record': 'Record a swing with the {club}',

  // ── Weekly plan: areas and sessions ────────────────────────────────────
  'stats.my.coach.plan.area.offTheTee': 'Off the tee',
  'stats.my.coach.plan.area.approach': 'Approach',
  'stats.my.coach.plan.area.aroundGreen': 'Short game',
  'stats.my.coach.plan.area.putting': 'Putting',
  'stats.my.coach.plan.area.penalties': 'Penalties',
  'stats.my.coach.plan.session.range': {
    one: 'Range, {minutes} min, {count} drill',
    other: 'Range, {minutes} min, {count} drills',
  },
  'stats.my.coach.plan.session.shortGame': {
    one: 'Short game, {minutes} min, {count} drill',
    other: 'Short game, {minutes} min, {count} drills',
  },
  'stats.my.coach.plan.session.putting': {
    one: 'Putting, {minutes} min, {count} drill',
    other: 'Putting, {minutes} min, {count} drills',
  },
  'stats.my.coach.plan.session.course': {
    one: 'On the course, {minutes} min, {count} drill',
    other: 'On the course, {minutes} min, {count} drills',
  },

  // ── Weekly plan: why a session is there ────────────────────────────────
  'stats.my.coach.plan.why.focus': '{area} is your focus, the biggest leak right now.',
  'stats.my.coach.plan.why.tie': '{area} is level with the second leak, so it gets equal time.',
  'stats.my.coach.plan.why.second': '{area} is the second biggest leak.',
  'stats.my.coach.plan.why.keep': '{area} already helps, so it gets less time.',
  'stats.my.coach.plan.why.swing': 'Swing work alongside {area}, for the fault your swing shows.',
  'stats.my.coach.plan.why.collect.insufficient': 'Not enough tracked data yet to choose a focus.',
  'stats.my.coach.plan.why.collect.noLeak': 'No clear leak yet, so this week is about collecting data.',

  // ── Weekly plan: the on-course task for the next round ─────────────────
  'stats.my.coach.plan.course.putting.lag': 'On the course, track every putt from {bucket} m and count the three-putts.',
  'stats.my.coach.plan.course.putting.short': 'On the course, track every putt from {bucket} m and count the misses.',
  'stats.my.coach.plan.course.putting.general': 'On the course, count your putts on every hole.',
  'stats.my.coach.plan.course.approach.short': 'On the course, note each approach from {bucket} m that finishes short.',
  'stats.my.coach.plan.course.approach.bunker': 'On the course, note each approach from {bucket} m that finds a bunker.',
  'stats.my.coach.plan.course.approach.distance': 'On the course, note the club and the result of each approach from {bucket} m.',
  'stats.my.coach.plan.course.approach.side': 'On the course, note each approach from {bucket} m that misses {side}.',
  'stats.my.coach.plan.course.tee.trouble': 'On the course, note each drive that finds sand or trouble.',
  'stats.my.coach.plan.course.tee.distance': 'On the course, note the distance of each drive and whether it finished in the fairway.',
  'stats.my.coach.plan.course.tee.side': 'On the course, note each drive that misses {side}.',
  'stats.my.coach.plan.course.short.sand': 'On the course, note each bunker shot and whether you got up and down.',
  'stats.my.coach.plan.course.short.chip': 'On the course, note each chip and whether you got up and down.',
  'stats.my.coach.plan.course.penalty.tee': 'Before each tee shot, say out loud the trouble you want to avoid.',
  'stats.my.coach.plan.course.penalty.other': 'On the course, pick the safe option before each shot that could cost a penalty.',
  'stats.my.coach.plan.course.area.offTheTee': 'On the course, note where each drive finishes.',
  'stats.my.coach.plan.course.area.approach': 'On the course, note the distance and result of each approach.',
  'stats.my.coach.plan.course.area.aroundGreen': 'On the course, note whether each chip and bunker shot gets up and down.',
  'stats.my.coach.plan.course.area.putting': 'On the course, count your putts on every green.',
  'stats.my.coach.plan.course.area.penalties': 'On the course, name the trouble before each shot that could cost a penalty.',
  'stats.my.coach.plan.course.collect': 'On the course, keep score with shot detail so the next plan has data.',

  // ── Weekly plan: what to log next ──────────────────────────────────────
  'stats.my.coach.plan.log.possible': 'Log {rounds} more rounds with shot detail to confirm this.',
  'stats.my.coach.plan.log.insufficient': '{area}: not enough shot data yet to rank it.',
  'stats.my.coach.plan.log.collect': 'Log more shots to see where you lose strokes.',

  // ── Weekly plan: what changed on re-plan ───────────────────────────────
  'stats.my.coach.plan.replanned': 'Plan updated after your round on {date}. {what}.',
  'stats.my.coach.plan.changed.topLeak': 'New top leak: {area}',
  'stats.my.coach.plan.changed.cause': 'New cause for {area}',
  'stats.my.coach.plan.changed.second': 'New second leak: {area}',
  'stats.my.coach.plan.changed.keep': 'New block to keep: {area}',
  'stats.my.coach.plan.changed.level': 'Focus level {level} of 3',
  'stats.my.coach.plan.changed.tieStarted': 'Two leaks are level, so both get time',
  'stats.my.coach.plan.changed.tieEnded': 'One leak is clearly ahead again',
  'stats.my.coach.plan.changed.swingAdded': 'Swing drill added',
  'stats.my.coach.plan.changed.swingRemoved': 'Swing drill removed',
  'stats.my.coach.plan.changed.collect': 'Not enough data to pick a focus yet',
  'stats.my.coach.plan.changed.leakFound': 'A clear leak has appeared to practise',
  'stats.my.coach.plan.changed.and': '{a}; {b}',
};
