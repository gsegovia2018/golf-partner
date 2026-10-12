// Drill catalogue for the swing faults (plan 5.6). Original English text, same shape as
// store/coachDrills.js: every drill has a measurable pass target. `also` lists other faults
// the drill serves (after that fault's own drills); `checks` lists the checks it targets, so
// the drill leads when one of them is the main fault's evidence (D24). Every drill shows the
// same progression line under it (PROGRESSION). The ids are stable keys
// stored in analysis.json, so they are not translated.

export const PROGRESSION = 'Start slow with a 7-iron and film it from behind. Speed up only once the position holds on video, and build to full swings over a few sessions.';

export const DRILLS = [
  {
    id: 'su-brazos', fault: 'posture', checks: ['hands_under_shoulders'], title: 'Let the arms hang',
    instruction: 'Stand tall with the club held out in front, then tilt from the hips until the clubhead touches the ground. Let your arms hang loose and take your grip wherever the hands fall: straight below your shoulders, not pushed out toward the ball or pulled in to your legs.',
    passTarget: '10 setups with the hands under the shoulders on video',
  },
  {
    id: 'su-bisagra', fault: 'posture', checks: ['waist_bend'], title: 'Hinge, do not slump',
    instruction: 'Put your hands in the creases at the top of your thighs and push your hips back until your chest points at the ball, with a small flex in the knees. The bend comes from the hip joints, not from curling the back.',
    passTarget: '10 setups with the hip angle in the green band',
  },
  {
    id: 'su-palo-espalda', fault: 'posture', checks: ['back_line'], title: 'Club along the spine',
    instruction: 'Hold a club down your back so it touches the back of your head, between the shoulder blades and your tailbone. Tilt into your address keeping all three touching: head, upper back and hips stay in one straight line.',
    passTarget: '10 tilts keeping all three contacts',
  },
  {
    id: 'su-palmo', fault: 'posture', checks: ['hand_gap'], title: 'One hand of space',
    instruction: 'At address, spread your trail hand and fit it between the butt of the club and your lead thigh: thumb on the grip, little finger on the leg. Less is crowded, more is reaching.',
    passTarget: 'the hand fits before 10 balls in a row',
  },
  {
    id: 'pl-vidrio', fault: 'top_position', checks: ['lead_arm_shoulder_plane', 'hands_over_heels'], also: ['steep_backswing', 'across_the_line'],
    title: "Pane of glass (Hogan's image)",
    instruction: 'Rest an alignment stick (or picture a sheet of glass) on a line from the ball to about 5 cm above your trail shoulder. Swing to the top and stop: your hands, arms and club should all sit just under it, with the hands over the trail heel, never poking through.',
    passTarget: '8 of 10 tops under the stick',
  },
  {
    id: 'pl-palo-atras', fault: 'over_the_top', checks: ['shaft_down_shallow', 'downswing_path'], also: ['flat_backswing', 'flip'],
    title: 'Stick behind you',
    instruction: 'Push an alignment stick into the ground 60 to 90 cm behind you, angled so that from down the line it covers your hands at address. Going back, the hands travel inside the stick while the clubhead stays outside it; from the top, let the club drop under the stick on the way down.',
    passTarget: '8 of 10 swings without touching the stick',
  },
  {
    id: 'ee-silla', fault: 'early_extension', title: 'The chair',
    instruction: 'Place a chair (or your bag) so it touches your glutes at address. Swing at about 70 % speed and keep your glutes in contact with it until the ball is gone.',
    passTarget: '8 of 10 without losing contact',
  },
  {
    id: 'ee-pared', fault: 'early_extension', title: 'Glutes on the wall',
    instruction: 'Set up with your glutes lightly touching a wall. Make half swings up and down to impact without pulling away from the wall.',
    passTarget: '10 in a row touching',
  },
  {
    id: 'ee-palo-talones', fault: 'early_extension', title: 'Club behind the heels',
    instruction: 'Lay a club on the ground about 5 cm behind your heels. If your hips step on it on the way down, you have extended toward the ball.',
    passTarget: '8 of 10 without stepping on it',
  },
  {
    id: 'ott-toalla', fault: 'over_the_top', title: 'Towel under the arm',
    instruction: 'Hold a towel under your trail armpit for the whole swing. If it drops before impact, your arm moved away from your body and you came down from outside.',
    passTarget: '8 of 10 without dropping it',
  },
  {
    id: 'ott-caja', fault: 'over_the_top', title: 'Outside box',
    instruction: 'Put a box of balls (or a head cover) about 10 cm outside and just behind the ball. Hit the ball without touching the box.',
    passTarget: '8 of 10 clean',
  },
  {
    id: 'ott-pausa', fault: 'over_the_top', title: 'Pause at the top',
    instruction: 'Stop for one second at the top, then start down by letting your hands drop before you turn your chest.',
    passTarget: '10 swings with the pause',
  },
  {
    id: 'fl-freeze', fault: 'flip', title: 'Freeze past impact',
    instruction: 'Hit three-quarter shots and freeze when the shaft is level after the ball. From behind, the shaft should point between your toes and the ball, not out past it. Film a few to check.',
    passTarget: '8 of 10 frozen with the shaft pointing inside the ball',
  },
  {
    id: 'sb-plano', fault: 'steep_backswing', title: 'Club on the plane',
    instruction: 'Stick a club in the ground at the angle of your address shaft. Swing back to lead arm parallel: your shaft should be parallel to the club in the ground.',
    passTarget: '8 of 10 parallel',
  },
  {
    id: 'fb-codo', fault: 'flat_backswing', also: ['top_position'], title: 'Trail elbow up',
    instruction: 'Swing back to lead arm parallel with your trail elbow pointing at the ground and your hands in front of your chest.',
    passTarget: '8 of 10',
  },
  {
    id: 'atl-objetivo', fault: 'across_the_line', also: ['top_position'], title: 'Shaft at the target',
    instruction: 'At the top, pause and look: the shaft should point at the flag. Make short swings with a mirror behind you.',
    passTarget: '8 of 10',
  },
  {
    id: 'lo-objetivo', fault: 'laid_off', title: 'Shaft at the target',
    instruction: 'Same drill as for the crossed shaft: pause at the top and look. Here the shaft points left of the target, so feel it pointing at the flag.',
    passTarget: '8 of 10',
  },
  {
    id: 'hs-bola-cabeza', fault: 'head_sway', title: 'Ball on the head',
    instruction: 'Ask a partner to hold a ball resting on top of your head (or film yourself with a vertical line on screen). Make half backswings without moving it.',
    passTarget: '8 of 10',
  },
  {
    id: 'tf-tres-uno', fault: 'tempo_fast', title: 'Three to one',
    instruction: 'Count "one-two-three" on the backswing and "one" on the downswing. Record yourself and check the ratio.',
    passTarget: 'ratio of 2.5 or more in 3 of 5 swings',
  },
  {
    id: 'ts-suelta', fault: 'tempo_slow', title: 'Let the downswing go',
    instruction: 'Make a normal backswing, then let the downswing go without steering it. The target is a backswing no more than 3.5 times the length of the downswing.',
    passTarget: 'ratio of 3.5 or less in 3 of 5 swings',
  },
  {
    id: 'bal-tres-seg', fault: 'balance', title: 'Three seconds',
    instruction: 'End every swing and hold the finish for three seconds, standing on your lead leg.',
    passTarget: '10 of 10 held still',
  },
  {
    id: 'po-espejo', fault: 'posture', title: 'Address in the mirror',
    instruction: 'Set up side-on to a mirror: tilt from the hips about 30 degrees, soft knees, arms hanging under the shoulders.',
    passTarget: '10 repetitions',
  },
];

/** The main fault's drills: those aimed at its evidence checks first, then the fault's own (D24). */
export function drillsForMain(main) {
  if (!main) return [];
  const ev = new Set((main.evidence || []).map((c) => c.id));
  const all = drillsForFault(main.fault);
  const aimed = DRILLS.filter((d) => d.checks?.some((id) => ev.has(id)));
  return [...new Set([...aimed, ...all])];
}

export const DRILL_FAULTS = [...new Set(DRILLS.flatMap((d) => [d.fault, ...(d.also || [])]))];

/**
 * The catalogue rows for a fault: its own drills in order, then the ones it borrows from a
 * neighbouring fault (`also`). The results card shows the first two.
 */
export const drillsForFault = (fault) => [
  ...DRILLS.filter((d) => d.fault === fault),
  ...DRILLS.filter((d) => d.fault !== fault && d.also?.includes(fault)),
];
