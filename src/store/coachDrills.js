// Deterministic practice-drill catalog (spec §2.1). Every drill has a
// measurable pass target so a session is objectively passed or failed.
// Areas use coach vocabulary; 'driving' insights map to 'offTheTee'.

export const DRILLS = [
  // ── Putting ──
  {
    id: 'putt-lag-ladder', area: 'putting', bucket: '6+', title: 'Lag ladder',
    instruction: 'Take 10 putts from 8 m to one hole. Focus only on pace — pick a 1 m circle around the cup as your target.',
    passTarget: '7 of 10 finish inside 1 m of the hole', location: 'green',
  },
  {
    id: 'putt-circle-4m', area: 'putting', bucket: '3-6', title: 'Circle drill 4 m',
    instruction: 'Place 4 balls at 4 m around one hole (N/S/E/W). Putt all 4, repeat 3 circuits (12 putts).',
    passTarget: 'Hole 3+, and none finish outside 1 m', location: 'green',
  },
  {
    id: 'putt-clock-2m', area: 'putting', bucket: '2-3', title: 'Clock drill 2.5 m',
    instruction: '12 putts from 2.5 m, moving between 4 stations around the hole so the break changes every putt.',
    passTarget: '9 of 12 holed', location: 'green',
  },
  {
    id: 'putt-gate-short', area: 'putting', bucket: '1-2', title: 'Gate drill',
    instruction: 'Build a gate of two tees just wider than the ball, 30 cm ahead. 15 putts from 1.5 m through the gate.',
    passTarget: '12 of 15 holed through the gate', location: 'green',
  },
  {
    id: 'putt-tap-in-pressure', area: 'putting', bucket: '0-1', title: 'Around the world',
    instruction: '12 putts from 1 m around one hole. Start over if you miss two in a row.',
    passTarget: '12 of 12 holed', location: 'green',
  },
  {
    id: 'putt-mixed-ladder', area: 'putting', bucket: null, title: 'Three-distance ladder',
    instruction: '9 putts alternating 3 m, 6 m and 9 m — never two in a row from the same spot.',
    passTarget: '8 of 9 finish inside 1 m (or holed)', location: 'green',
  },
  // ── Approach ──
  {
    id: 'appr-wedge-ladder', area: 'approach', bucket: '0-50', title: 'Wedge ladder',
    instruction: '12 balls alternating 20 / 30 / 40 m targets with your most lofted wedge. Land, do not run, the ball to the target.',
    passTarget: '8 of 12 inside 5 m', location: 'range',
  },
  {
    id: 'appr-distance-windows', area: 'approach', bucket: '50-100', title: 'Distance windows',
    instruction: '12 balls: 4 each at 60 / 80 / 100 m. Call the number before each swing.',
    passTarget: '8 of 12 inside 8 m of the called number', location: 'range',
  },
  {
    id: 'appr-green-reps-125', area: 'approach', bucket: '100-150', title: 'Green reps 125 m',
    instruction: '15 balls to a 125 m target with the club you actually use from that distance on course.',
    passTarget: '9 of 15 inside a green-sized 12 m circle', location: 'range',
  },
  {
    id: 'appr-long-iron-reps', area: 'approach', bucket: '150-200', title: 'Long-iron reps',
    instruction: '12 balls to a 175 m target. Swing at 80% — the goal is the circle, not distance.',
    passTarget: '6 of 12 inside 15 m', location: 'range',
  },
  {
    id: 'appr-layup-ladder', area: 'approach', bucket: '200+', title: 'Lay-up ladder',
    instruction: 'Alternate 5 full-length shots and 5 lay-ups to your favourite wedge distance. Commit to the number before each lay-up.',
    passTarget: 'All 5 lay-ups finish inside 10 m of the chosen number', location: 'range',
  },
  {
    id: 'appr-call-your-half', area: 'approach', bucket: null, title: 'Call your half',
    instruction: '9 balls at one target. Before each, call which half of the green you are hitting (left/right or front/back).',
    passTarget: '6 of 9 finish on the called half', location: 'range',
  },
  // ── Off the tee ──
  {
    id: 'tee-fairway-window', area: 'offTheTee', bucket: null, title: 'Fairway window',
    instruction: 'Pick two range markers about 30 m apart as an imaginary fairway. 10 drivers through the window.',
    passTarget: '7 of 10 inside the window', location: 'range',
  },
  {
    id: 'tee-club-comparison', area: 'offTheTee', bucket: null, title: 'Driver vs 3-wood test',
    instruction: '6 drivers and 6 3-woods (or hybrid) at the same 30 m window. Count each club\'s hits and note the carry gap.',
    passTarget: 'A written verdict: which club keeps 5+ of 6 in the window, and the distance it costs',
    location: 'range',
  },
  {
    id: 'tee-tempo-80', area: 'offTheTee', bucket: null, title: '80% tempo reps',
    instruction: '10 drives at what feels like 80% effort, same window as the fairway drill.',
    passTarget: '8 of 10 in the window while losing no more than ~10 m', location: 'range',
  },
  // ── Short game ──
  {
    id: 'sg-updown-circle', area: 'shortGame', bucket: null, title: 'Up-and-down circle',
    instruction: '9 balls around one green from 3 different lies (fringe, rough, tight). Chip on and putt out every ball.',
    passTarget: '5 of 9 up-and-down (2 strokes total)', location: 'green',
  },
  {
    id: 'sg-landing-towel', area: 'shortGame', bucket: null, title: 'Landing-spot chips',
    instruction: 'Lay a towel where your chips should land (not finish). 10 chips aiming to carry onto the towel.',
    passTarget: '6 of 10 land on or within a club-length of the towel', location: 'green',
  },
  {
    id: 'sg-bunker-first-out', area: 'shortGame', bucket: null, title: 'Bunker first-out',
    instruction: '10 bunker shots. Priority one is escaping on the first swing; priority two is finishing close.',
    passTarget: '10 of 10 out first time, 5 of 10 inside 3 m', location: 'green',
  },
  // ── Penalties ──
  {
    id: 'pen-name-the-trouble', area: 'penalties', bucket: null, title: 'Name the trouble',
    instruction: 'Next round: before every tee shot, say out loud where the penalty trouble is and pick a target 20 m away from it.',
    passTarget: 'Zero tee penalties across 9 consecutive holes', location: 'course',
  },
  {
    id: 'pen-smart-drop-review', area: 'penalties', bucket: null, title: 'Smart-drop review',
    instruction: 'Review your last 3 penalty holes. For each, decide the recovery you will take next time (punch out sideways, drop zone, provisional).',
    passTarget: 'A written next-time plan for all 3 holes', location: 'course',
  },
  // ── Round shape ──
  {
    id: 'shape-closing-routine', area: 'roundShape', bucket: null, title: 'Closing-3 routine',
    instruction: 'On the final 3 holes: pick the conservative target and run your full pre-shot routine on every single shot, no exceptions.',
    passTarget: 'No worse than bogey on each of the last 3 holes', location: 'course',
  },
  // ── Scoring (generic fallback) ──
  {
    id: 'scoring-one-shot-reset', area: 'scoring', bucket: null, title: 'One-shot reset',
    instruction: 'After any double bogey or worse, the next tee shot is automatically your safest club at the widest target. No hero shots.',
    passTarget: 'Bogey or better on every hole that follows a blow-up, for one full round', location: 'course',
  },
];

// coachInsights area vocabulary → drill area.
const AREA_TO_DRILL_AREA = {
  driving: 'offTheTee',
  approach: 'approach',
  putting: 'putting',
  shortGame: 'shortGame',
  penalties: 'penalties',
  roundShape: 'roundShape',
  scoring: 'scoring',
};

// "6+ m putts" → '6+'; "150-200 m approaches" → '150-200'.
function bucketFromTitle(title) {
  const match = /(\d+(?:-\d+)?\+?)\s*m\b/.exec(String(title ?? ''));
  return match ? match[1] : null;
}

// Bucket-matched drill first, then the area's generic drills. Unknown areas
// (and 'form', which has no physical drill) fall back to scoring drills.
export function drillsForInsight(insight) {
  if (!insight) return [];
  const area = AREA_TO_DRILL_AREA[insight.area] ?? 'scoring';
  const bucket = bucketFromTitle(insight.title);
  const areaDrills = DRILLS.filter((d) => d.area === area);
  const pool = areaDrills.length > 0 ? areaDrills : DRILLS.filter((d) => d.area === 'scoring');
  const bucketMatch = bucket ? pool.filter((d) => d.bucket === bucket) : [];
  const generic = pool.filter((d) => d.bucket == null);
  const rest = pool.filter((d) => !bucketMatch.includes(d) && !generic.includes(d));
  return [...bucketMatch, ...generic, ...rest];
}
