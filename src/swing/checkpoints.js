// User-facing checkpoint definitions (plan D15), ported from the swing lab editor's
// checkpoints.js (the owner used it and liked its flow). Down-the-line view, right-handed
// text; cueFor(key, handedness) mirrors left and right for left-handed golfers.
//
// The ten definitions follow the P-system (P1-P10; P8 added by D22). `stop` is the marking
// canvas's always-visible stop line (D26): FIRST or LAST frame, the condition in a few words,
// what to watch, and the before / after captions of the fine strip; derived from `stopWhen`.
// The three internal frames (lateBackswing, preImpact, postImpact) are reachable from a check's
// "Place clubhead" button, so they get a short cue of their own (and no stop line).

export const CHECKPOINT_DEFS = [
  {
    key: 'address', p: 'P1', name: 'Address',
    what: 'Set up and still, club resting behind the ball.',
    stopWhen: 'the last frame before the clubhead starts moving back.',
    markTips: 'Hands: middle of the grip. Clubhead: club neck where the shaft meets the head. Ball: centre of the ball; if the clubhead hides it, scrub to after the takeaway (the ball does not move until impact) and mark it there.',
    stop: { kind: 'last', short: 'before the clubhead moves back', watch: 'the clubhead', before: 'still', after: 'moving' },
  },
  {
    key: 'takeaway', p: 'P2', name: 'Takeaway',
    what: 'Shaft parallel to the ground on the way back.',
    stopWhen: "the first frame the shaft is level. From behind, the club now points along the target line, so it looks very short or disappears behind the hands — mark it hidden if you can't see the head.",
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or switch "Clubhead hidden" on if the shaft points at the camera.',
    stop: { kind: 'first', short: 'the shaft is level', watch: 'the shaft · it looks short from behind', before: 'not yet level', after: 'level' },
  },
  {
    key: 'leadArm', p: 'P3', name: 'Lead arm parallel',
    what: 'Left arm parallel to the ground in the backswing.',
    stopWhen: 'the first frame your left arm is level.',
    markTips: 'Hands: middle of the grip, between the two hands (not the wrists). Clubhead: centre of the head.',
    stop: { kind: 'first', short: 'the left arm is level', watch: 'the left arm', before: 'still rising', after: 'level' },
  },
  {
    key: 'top', p: 'P4', name: 'Top of backswing',
    what: 'End of the backswing: the club stops going back.',
    stopWhen: 'the last frame before the club starts down. Watch the clubhead, not the hands — it keeps moving a little after the hands stop.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head (hidden if out of frame).',
    stop: { kind: 'last', short: 'before the club starts down', watch: 'the clubhead, not the hands', before: 'going back', after: 'coming down' },
  },
  {
    key: 'transition', p: 'P5', name: 'Transition',
    what: 'Left arm parallel to the ground on the way down.',
    stopWhen: 'the first frame your left arm is level again in the downswing.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head.',
    stop: { kind: 'first', short: 'the left arm is level again, coming down', watch: 'the left arm', before: 'above level', after: 'level' },
  },
  {
    key: 'shaftDown', p: 'P6', name: 'Shaft parallel (down)',
    what: 'Shaft parallel to the ground in the downswing, hands around the right hip.',
    stopWhen: 'the first frame the shaft is level. From behind it often points at the camera — mark the clubhead hidden.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or hidden when the shaft points at the camera.',
    stop: { kind: 'first', short: 'the shaft is level, hands by the right hip', watch: 'the shaft · often points at the camera', before: 'not yet level', after: 'level' },
  },
  {
    key: 'impact', p: 'P7', name: 'Impact',
    what: 'The clubface meets the ball.',
    stopWhen: 'the last frame where the ball is still sitting where it was (on the next frame it has gone or moved).',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head at the ball.',
    stop: { kind: 'last', short: 'the ball is still sitting where it was', watch: 'the ball', before: 'ball there', after: 'ball gone' },
  },
  {
    key: 'shaftThrough', p: 'P8', name: 'Shaft parallel after impact',
    what: 'Shaft parallel to the ground after impact, hands around the left hip.',
    stopWhen: 'the first frame the shaft is level on the way through. From behind it often points away from the camera — mark the clubhead hidden if you cannot see it.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or hidden when the shaft points along the target line.',
    stop: { kind: 'first', short: 'the shaft is level after impact, hands by the left hip', watch: 'the shaft · often points away', before: 'not yet level', after: 'level' },
  },
  {
    key: 'trailArm', p: 'P9', name: 'Trail arm parallel',
    what: 'Right arm parallel to the ground after impact.',
    stopWhen: 'the first frame your right arm is level in the follow-through.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head.',
    stop: { kind: 'first', short: 'the right arm is level in the follow-through', watch: 'the right arm', before: 'below level', after: 'level' },
  },
  {
    key: 'finish', p: 'P10', name: 'Finish',
    what: 'Swing complete and held.',
    stopWhen: 'the first frame where your body and the club have stopped moving.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or hidden if out of frame.',
    stop: { kind: 'first', short: 'body and club have stopped', watch: 'the hands and the head', before: 'still moving', after: 'stopped' },
  },
];

// Internal frames: not on the timeline, still markable (the clubhead-on-plane check reads preImpact).
const INTERNAL_DEFS = [
  {
    key: 'lateBackswing', p: '', name: 'Late backswing',
    what: 'Halfway between the left arm parallel and the top of the backswing.',
    stopWhen: 'the frame in the middle of that stretch.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or hidden if the shaft points at the camera.',
  },
  {
    key: 'preImpact', p: '', name: 'Pre-impact',
    what: 'A moment before impact: about 25 ms (six frames at 240 fps) earlier.',
    stopWhen: 'the frame six frames before impact.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, on its way to the ball.',
  },
  {
    key: 'postImpact', p: '', name: 'Post-impact',
    what: 'Just after impact: about ten frames later.',
    stopWhen: 'the frame ten frames after impact.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head.',
  },
];

export const HOW_TO_MARK = [
  ['Hands', 'the middle of the grip, between the two hands (not the wrists).'],
  ['Clubhead', 'the centre of the clubhead. At address, the club neck where the shaft meets the head.'],
  ['Ball', 'the centre of the ball, marked at Address. If the clubhead hides it, scrub forward to after the takeaway (the ball does not move until impact) and mark it there.'],
  ['Clubhead hidden', 'the shaft points at the camera, or the head is out of frame.'],
];

const swapLR = (t) => t.replace(/\b(left|right)\b/gi, (m) => {
  const o = m.toLowerCase() === 'left' ? 'right' : 'left';
  return m[0] === m[0].toUpperCase() ? o[0].toUpperCase() + o.slice(1) : o;
});

/** The cue card for a checkpoint, mirrored for left-handers; null for an unknown key. */
export function cueFor(key, handedness = 'right') {
  const d = [...CHECKPOINT_DEFS, ...INTERNAL_DEFS].find((c) => c.key === key);
  if (!d) return null;
  if (handedness !== 'left') return { ...d };
  const stop = d.stop ? { ...d.stop, short: swapLR(d.stop.short), watch: swapLR(d.stop.watch) } : undefined;
  return {
    ...d, what: swapLR(d.what), stopWhen: swapLR(d.stopWhen), markTips: swapLR(d.markTips), stop,
  };
}

// The timeline has ten steps (D10, D22); an internal frame lives under the step it belongs to.
const STEP_OF = { lateBackswing: 'leadArm', preImpact: 'impact', postImpact: 'impact' };
export const timelineStep = (key) => STEP_OF[key] ?? key;
