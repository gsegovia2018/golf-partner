// Deterministic practice-drill catalog (spec §2.1, §3.3). Every drill has a
// measurable pass target so a session is objectively passed or failed.
// Areas use coach vocabulary; 'driving' insights map to 'offTheTee'.
// causes: coach cause ids the drill serves (coachCauses.js). kind: where the
// session happens. minutes: 10-25. levels: three pass targets, level 1 is passTarget.

export const DRILLS = [
  // ── Putting ──
  {
    id: 'putt-lag-ladder', area: 'putting', bucket: '6+', title: 'Lag ladder',
    instruction: 'Take 10 putts from 8 m to one hole. Focus only on pace — pick a 1 m circle around the cup as your target.',
    passTarget: '7 of 10 finish inside 1 m of the hole', location: 'green',
    causes: ['cause:putting:lag'], kind: 'putting', minutes: 15,
    levels: [
      { passTarget: '7 of 10 finish inside 1 m of the hole' },
      { passTarget: '8 of 10 finish inside 1 m of the hole' },
      { passTarget: '8 of 10 finish inside 1 m of the hole, from 10 m' },
    ],
  },
  {
    id: 'putt-circle-4m', area: 'putting', bucket: '3-6', title: 'Circle drill 4 m',
    instruction: 'Place 4 balls at 4 m around one hole (N/S/E/W). Putt all 4, repeat 3 circuits (12 putts).',
    passTarget: 'Hole 3+, and none finish outside 1 m', location: 'green',
    causes: ['cause:putting:lag'], kind: 'putting', minutes: 10,
    levels: [
      { passTarget: 'Hole 3+, and none finish outside 1 m' },
      { passTarget: 'Hole 4+, and none finish outside 1 m' },
      { passTarget: 'Hole 5+, and none finish outside 1 m' },
    ],
  },
  {
    id: 'putt-clock-2m', area: 'putting', bucket: '2-3', title: 'Clock drill 2.5 m',
    instruction: '12 putts from 2.5 m, moving between 4 stations around the hole so the break changes every putt.',
    passTarget: '9 of 12 holed', location: 'green',
    causes: ['cause:putting:short'], kind: 'putting', minutes: 15,
    levels: [
      { passTarget: '9 of 12 holed' },
      { passTarget: '10 of 12 holed' },
      { passTarget: '11 of 12 holed' },
    ],
  },
  {
    id: 'putt-gate-short', area: 'putting', bucket: '1-2', title: 'Gate drill',
    instruction: 'Build a gate of two tees just wider than the ball, 30 cm ahead. 15 putts from 1.5 m through the gate.',
    passTarget: '12 of 15 holed through the gate', location: 'green',
    causes: ['cause:putting:short'], kind: 'putting', minutes: 15,
    levels: [
      { passTarget: '12 of 15 holed through the gate' },
      { passTarget: '13 of 15 holed through the gate' },
      { passTarget: '14 of 15 holed through the gate' },
    ],
  },
  {
    id: 'putt-tap-in-pressure', area: 'putting', bucket: '0-1', title: 'Around the world',
    instruction: '12 putts from 1 m around one hole. Start over if you miss two in a row.',
    passTarget: '12 of 12 holed', location: 'green',
    causes: ['cause:putting:short'], kind: 'putting', minutes: 10,
    levels: [
      { passTarget: '12 of 12 holed' },
      { passTarget: '12 of 12 holed, starting over only once' },
      { passTarget: '24 of 24 holed across two rounds, no reset' },
    ],
  },
  {
    id: 'putt-mixed-ladder', area: 'putting', bucket: null, title: 'Three-distance ladder',
    instruction: '9 putts alternating 3 m, 6 m and 9 m — never two in a row from the same spot.',
    passTarget: '8 of 9 finish inside 1 m (or holed)', location: 'green',
    causes: ['cause:putting:general'], kind: 'putting', minutes: 15,
    levels: [
      { passTarget: '8 of 9 finish inside 1 m (or holed)' },
      { passTarget: '8 of 9 holed or inside 0.5 m' },
      { passTarget: '9 of 9 holed or inside 0.5 m' },
    ],
  },
  {
    id: 'putt-short-circle-80pct', area: 'putting', bucket: null, title: '80% short-putt circle',
    instruction: '10 putts from 1.5 m around one hole, one ball from each of 10 positions. Holed or nothing counts; do not move the ball.',
    passTarget: '8 of 10 holed from 1.5 m', location: 'green',
    causes: ['cause:putting:short'], kind: 'putting', minutes: 10,
    levels: [
      { passTarget: '8 of 10 holed from 1.5 m' },
      { passTarget: '9 of 10 holed from 1.5 m' },
      { passTarget: '10 of 10 holed from 1.5 m' },
    ],
  },
  // ── Approach ──
  {
    id: 'appr-wedge-ladder', area: 'approach', bucket: '0-50', title: 'Wedge ladder',
    instruction: '12 balls alternating 20 / 30 / 40 m targets with your most lofted wedge. Land, do not run, the ball to the target.',
    passTarget: '8 of 12 inside 5 m', location: 'range',
    causes: ['cause:approach:distance'], kind: 'range', minutes: 20,
    levels: [
      { passTarget: '8 of 12 inside 5 m' },
      { passTarget: '9 of 12 inside 5 m' },
      { passTarget: '10 of 12 inside 4 m' },
    ],
  },
  {
    id: 'appr-distance-windows', area: 'approach', bucket: '50-100', title: 'Distance windows',
    instruction: '12 balls: 4 each at 60 / 80 / 100 m. Call the number before each swing.',
    passTarget: '8 of 12 inside 8 m of the called number', location: 'range',
    causes: ['cause:approach:distance'], kind: 'range', minutes: 20,
    levels: [
      { passTarget: '8 of 12 inside 8 m of the called number' },
      { passTarget: '9 of 12 inside 6 m of the called number' },
      { passTarget: '10 of 12 inside 5 m of the called number' },
    ],
  },
  {
    id: 'appr-green-reps-125', area: 'approach', bucket: '100-150', title: 'Green reps 125 m',
    instruction: '15 balls to a 125 m target with the club you actually use from that distance on course.',
    passTarget: '9 of 15 inside a green-sized 12 m circle', location: 'range',
    causes: ['cause:approach:short', 'cause:approach:distance'], kind: 'range', minutes: 25,
    levels: [
      { passTarget: '9 of 15 inside a green-sized 12 m circle' },
      { passTarget: '10 of 15 inside a green-sized 12 m circle' },
      { passTarget: '11 of 15 inside a 10 m circle' },
    ],
  },
  {
    id: 'appr-long-iron-reps', area: 'approach', bucket: '150-200', title: 'Long-iron reps',
    instruction: '12 balls to a 175 m target. Swing at 80% — the goal is the circle, not distance.',
    passTarget: '6 of 12 inside 15 m', location: 'range',
    causes: ['cause:approach:distance', 'cause:approach:short'], kind: 'range', minutes: 20,
    levels: [
      { passTarget: '6 of 12 inside 15 m' },
      { passTarget: '7 of 12 inside 15 m' },
      { passTarget: '8 of 12 inside 12 m' },
    ],
  },
  {
    id: 'appr-layup-ladder', area: 'approach', bucket: '200+', title: 'Lay-up ladder',
    instruction: 'Alternate 5 full-length shots and 5 lay-ups to your favourite wedge distance. Commit to the number before each lay-up.',
    passTarget: 'All 5 lay-ups finish inside 10 m of the chosen number', location: 'range',
    causes: ['cause:approach:distance'], kind: 'range', minutes: 25,
    levels: [
      { passTarget: 'All 5 lay-ups finish inside 10 m of the chosen number' },
      { passTarget: 'All 5 lay-ups finish inside 8 m of the chosen number' },
      { passTarget: 'All 5 lay-ups finish inside 5 m of the chosen number' },
    ],
  },
  {
    id: 'appr-call-your-half', area: 'approach', bucket: null, title: 'Call your half',
    instruction: '9 balls at one target. Before each, call which half of the green you are hitting (left/right or front/back).',
    passTarget: '6 of 9 finish on the called half', location: 'range',
    causes: ['cause:approach:side:left', 'cause:approach:side:right'], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '6 of 9 finish on the called half' },
      { passTarget: '7 of 9 finish on the called half' },
      { passTarget: '8 of 9 finish on the called half' },
    ],
  },
  {
    id: 'appr-club-up-back-half', area: 'approach', bucket: null, title: 'Club up to the target',
    instruction: '12 balls to a 150 m target. Take one club more than your number and swing at 80%. Note each ball as short or long.',
    passTarget: '8 of 12 inside 10 m of the target', location: 'range',
    causes: ['cause:approach:short'], kind: 'range', minutes: 20,
    levels: [
      { passTarget: '8 of 12 inside 10 m of the target' },
      { passTarget: '9 of 12 inside 10 m of the target' },
      { passTarget: '9 of 12 inside 8 m, with at most 2 short' },
    ],
  },
  {
    id: 'appr-start-line-gate', area: 'approach', bucket: null, title: 'Start-line gate',
    instruction: 'Set two markers 1 m apart on the target line, 10 m in front of you. 9 balls through the gate with your normal shape. Note any ball that starts outside it.',
    passTarget: '7 of 9 start inside the gate', location: 'range',
    causes: [
      'cause:approach:side:left', 'cause:approach:side:right',
      'cause:approach:why:swing:start:left', 'cause:approach:why:swing:start:right',
    ], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '7 of 9 start inside the gate' },
      { passTarget: '8 of 9 start inside the gate' },
      { passTarget: '9 of 9 start inside the gate' },
    ],
  },
  {
    id: 'appr-path-gate', area: 'approach', bucket: null, title: 'Path gate',
    instruction: 'Set a headcover just outside the ball, on the far side from you. 10 balls with a mid-iron: swing through without touching the headcover.',
    passTarget: '8 of 10 swings miss the headcover', location: 'range',
    causes: ['cause:approach:why:swing:curve:left', 'cause:approach:why:swing:curve:right'], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '8 of 10 swings miss the headcover' },
      { passTarget: '9 of 10 swings miss the headcover' },
      { passTarget: '10 of 10 swings miss the headcover' },
    ],
  },
  {
    id: 'appr-low-point-line', area: 'approach', bucket: null, title: 'Low-point line',
    instruction: 'Draw a chalk line (or lay a tee line) on the ground and put the ball just behind it. 10 shots: strike the ball first, then the ground in front of the line.',
    passTarget: '7 of 10 take the ground in front of the line', location: 'range',
    causes: ['cause:approach:why:swing:lowPoint'], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '7 of 10 take the ground in front of the line' },
      { passTarget: '8 of 10 take the ground in front of the line' },
      { passTarget: '9 of 10 take the ground in front of the line' },
    ],
  },
  {
    id: 'appr-strike-tape', area: 'approach', bucket: null, title: 'Strike tape',
    instruction: 'Put face tape or impact spray on a mid-iron. Hit 10 balls and check the mark after each one. Count the strikes in the centre of the face.',
    passTarget: '7 of 10 strikes in the centre of the face', location: 'range',
    causes: ['cause:approach:why:swing:strike:left', 'cause:approach:why:swing:strike:right'], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '7 of 10 strikes in the centre of the face' },
      { passTarget: '8 of 10 strikes in the centre of the face' },
      { passTarget: '9 of 10 strikes in the centre of the face' },
    ],
  },
  // ── Off the tee ──
  {
    id: 'tee-fairway-window', area: 'offTheTee', bucket: null, title: 'Fairway window',
    instruction: 'Pick two range markers about 30 m apart as an imaginary fairway. 10 drivers through the window.',
    passTarget: '7 of 10 inside the window', location: 'range',
    causes: ['cause:tee:side:left', 'cause:tee:side:right'], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '7 of 10 inside the window' },
      { passTarget: '8 of 10 inside the window' },
      { passTarget: '8 of 10 inside a 20 m window' },
    ],
  },
  {
    id: 'tee-club-comparison', area: 'offTheTee', bucket: null, title: 'Driver vs 3-wood test',
    instruction: '6 drivers and 6 3-woods (or hybrid) at the same 30 m window. Count each club\'s hits and note the carry gap.',
    passTarget: 'A written verdict: which club keeps 5+ of 6 in the window, and the distance it costs',
    location: 'range',
    causes: ['cause:tee:trouble:driver', 'cause:tee:distance'], kind: 'range', minutes: 25,
    levels: [
      { passTarget: 'A written verdict: which club keeps 5+ of 6 in the window, and the distance it costs' },
      { passTarget: 'A written verdict: which club keeps 6 of 6 in the window, and the distance it costs' },
      { passTarget: 'A written verdict on 6 of 6 in a 20 m window, with the carry gap in metres' },
    ],
  },
  {
    id: 'tee-tempo-80', area: 'offTheTee', bucket: null, title: '80% tempo reps',
    instruction: '10 drives at what feels like 80% effort, same window as the fairway drill.',
    passTarget: '8 of 10 in the window while losing no more than ~10 m', location: 'range',
    causes: ['cause:tee:distance'], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '8 of 10 in the window while losing no more than ~10 m' },
      { passTarget: '8 of 10 in the window while losing no more than ~5 m' },
      { passTarget: '9 of 10 in the window while losing no more than ~5 m' },
    ],
  },
  {
    id: 'tee-shape-window', area: 'offTheTee', bucket: null, title: 'Start-line shape',
    instruction: '10 drives aimed at the outside edge of the window, letting the shot curve back in. Count the ones that finish inside.',
    passTarget: '6 of 10 finish inside the window', location: 'range',
    causes: [
      'cause:tee:side:left', 'cause:tee:side:right',
      'cause:tee:why:swing:start:left', 'cause:tee:why:swing:start:right',
    ], kind: 'range', minutes: 15,
    levels: [
      { passTarget: '6 of 10 finish inside the window' },
      { passTarget: '7 of 10 finish inside the window' },
      { passTarget: '8 of 10 finish inside the window' },
    ],
  },
  // ── Short game ──
  {
    id: 'sg-updown-circle', area: 'shortGame', bucket: null, title: 'Up-and-down circle',
    instruction: '9 balls around one green from 3 different lies (fringe, rough, tight). Chip on and putt out every ball.',
    passTarget: '5 of 9 up-and-down (2 strokes total)', location: 'green',
    causes: ['cause:short:sand', 'cause:short:chip'], kind: 'shortGame', minutes: 20,
    levels: [
      { passTarget: '5 of 9 up-and-down (2 strokes total)' },
      { passTarget: '6 of 9 up-and-down (2 strokes total)' },
      { passTarget: '7 of 9 up-and-down (2 strokes total)' },
    ],
  },
  {
    id: 'sg-landing-towel', area: 'shortGame', bucket: null, title: 'Landing-spot chips',
    instruction: 'Lay a towel where your chips should land (not finish). 10 chips aiming to carry onto the towel.',
    passTarget: '6 of 10 land on or within a club-length of the towel', location: 'green',
    causes: ['cause:short:chip', 'cause:short:why:swing:lowPoint'], kind: 'shortGame', minutes: 15,
    levels: [
      { passTarget: '6 of 10 land on or within a club-length of the towel' },
      { passTarget: '7 of 10 land on or within a club-length of the towel' },
      { passTarget: '8 of 10 land on the towel' },
    ],
  },
  {
    id: 'sg-bunker-first-out', area: 'shortGame', bucket: null, title: 'Bunker first-out',
    instruction: '10 bunker shots. Priority one is escaping on the first swing; priority two is finishing close.',
    passTarget: '10 of 10 out first time, 5 of 10 inside 3 m', location: 'green',
    causes: ['cause:approach:bunker', 'cause:short:sand'], kind: 'shortGame', minutes: 15,
    levels: [
      { passTarget: '10 of 10 out first time, 5 of 10 inside 3 m' },
      { passTarget: '10 of 10 out first time, 6 of 10 inside 3 m' },
      { passTarget: '10 of 10 out first time, 7 of 10 inside 3 m' },
    ],
  },
  {
    id: 'sg-chip-landing-ladder', area: 'shortGame', bucket: null, title: 'Chip landing ladder',
    instruction: 'Towels 5, 10 and 15 m from you. 4 chips to each towel, in order. Land the ball on the towel; let it run out.',
    passTarget: '8 of 12 land on their towel', location: 'green',
    causes: ['cause:short:chip'], kind: 'shortGame', minutes: 20,
    levels: [
      { passTarget: '8 of 12 land on their towel' },
      { passTarget: '9 of 12 land on their towel' },
      { passTarget: '10 of 12 land on their towel' },
    ],
  },
  // ── Penalties ──
  {
    id: 'pen-name-the-trouble', area: 'penalties', bucket: null, title: 'Name the trouble',
    instruction: 'Next round: before every tee shot, say out loud where the penalty trouble is and pick a target 20 m away from it.',
    passTarget: 'Zero tee penalties across 9 consecutive holes', location: 'course',
    causes: ['cause:penalty:tee'], kind: 'course', minutes: 15,
    levels: [
      { passTarget: 'Zero tee penalties across 9 consecutive holes' },
      { passTarget: 'Zero tee penalties across 18 holes' },
      { passTarget: 'Zero tee penalties across 18 holes, with the target named out loud on every tee' },
    ],
  },
  {
    id: 'pen-smart-drop-review', area: 'penalties', bucket: null, title: 'Smart-drop review',
    instruction: 'Review your last 3 penalty holes. For each, decide the recovery you will take next time (punch out sideways, drop zone, provisional).',
    passTarget: 'A written next-time plan for all 3 holes', location: 'course',
    causes: ['cause:penalty:tee', 'cause:penalty:other'], kind: 'course', minutes: 10,
    levels: [
      { passTarget: 'A written next-time plan for all 3 holes' },
      { passTarget: 'A written next-time plan for all 3 holes, with a named drop zone for each' },
      { passTarget: 'A written next-time plan for all 3 holes, tested in the next round' },
    ],
  },
  {
    id: 'pen-provisional-plan', area: 'penalties', bucket: null, title: 'Provisional on trouble holes',
    instruction: 'Next round: on every tee where penalty trouble is in play, hit a provisional ball before you walk forward. Decide before you walk which one you will play.',
    passTarget: 'A provisional ball on every hole with penalty trouble in play, for one round', location: 'course',
    causes: ['cause:penalty:other'], kind: 'course', minutes: 15,
    levels: [
      { passTarget: 'A provisional ball on every hole with penalty trouble in play, for one round' },
      { passTarget: 'A provisional ball on every such hole, and no lost-ball penalties, for one round' },
      { passTarget: 'A provisional ball on every such hole, and no lost-ball penalties, for two rounds' },
    ],
  },
  // ── Round shape ──
  {
    id: 'shape-closing-routine', area: 'roundShape', bucket: null, title: 'Closing-3 routine',
    instruction: 'On the final 3 holes: pick the conservative target and run your full pre-shot routine on every single shot, no exceptions.',
    passTarget: 'No worse than bogey on each of the last 3 holes', location: 'course',
    causes: [], kind: 'course', minutes: 25,
    levels: [
      { passTarget: 'No worse than bogey on each of the last 3 holes' },
      { passTarget: 'No worse than bogey on each of the last 6 holes' },
      { passTarget: 'No worse than bogey on each of the last 9 holes' },
    ],
  },
  // ── Scoring (generic fallback) ──
  {
    id: 'scoring-one-shot-reset', area: 'scoring', bucket: null, title: 'One-shot reset',
    instruction: 'After any double bogey or worse, the next tee shot is automatically your safest club at the widest target. No hero shots.',
    passTarget: 'Bogey or better on every hole that follows a blow-up, for one full round', location: 'course',
    causes: [], kind: 'course', minutes: 20,
    levels: [
      { passTarget: 'Bogey or better on every hole that follows a blow-up, for one full round' },
      { passTarget: 'Bogey or better on every hole that follows a blow-up, for two full rounds' },
      { passTarget: 'Par or better on every hole that follows a blow-up, for one full round' },
    ],
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

// cause id segment → drill area ('cause:approach:side:left' → 'approach').
const CAUSE_TO_DRILL_AREA = {
  putting: 'putting',
  approach: 'approach',
  tee: 'offTheTee',
  short: 'shortGame',
  penalty: 'penalties',
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

// Drills that serve a coach cause: cause-matched first (catalogue order), then
// the rest of the cause's area. Unknown or non-cause ids, and the strategy-only
// why causes (lie, decision), return [].
export function drillsForCause(causeId) {
  // Lie and decision misses are fixed on the course, not on the range: no drills.
  if (/^cause:(approach|tee|short):why:(lie|decision)$/.test(String(causeId ?? ''))) return [];
  const [prefix, segment] = String(causeId ?? '').split(':');
  const area = prefix === 'cause' ? CAUSE_TO_DRILL_AREA[segment] : undefined;
  if (!area) return [];
  const matched = DRILLS.filter((d) => d.causes.includes(causeId));
  const rest = DRILLS.filter((d) => d.area === area && !matched.includes(d));
  return [...matched, ...rest];
}
