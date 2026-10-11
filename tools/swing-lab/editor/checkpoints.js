// User-facing checkpoint definitions (plan D15). Down-the-line view, right-handed text;
// use cueFor(key, handedness) to mirror left/right for left-handed golfers.
export const CHECKPOINT_DEFS = [
  { key: 'address', p: 'P1', name: 'Address',
    what: 'Set up and still, club resting behind the ball.',
    stopWhen: 'the last frame before the clubhead starts moving back.',
    markTips: 'Hands: middle of the grip. Clubhead: club neck where the shaft meets the head. Ball: centre of the ball; if the clubhead hides it, scrub to after the takeaway (the ball does not move until impact) and mark it there.' },
  { key: 'takeaway', p: 'P2', name: 'Takeaway',
    what: 'Shaft parallel to the ground on the way back.',
    stopWhen: 'the first frame the shaft is level. From behind, the club now points along the target line, so it looks very short or disappears behind the hands — mark it hidden if you can\'t see the head.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or switch "Clubhead hidden" on if the shaft points at the camera.' },
  { key: 'leadArm', p: 'P3', name: 'Lead arm parallel',
    what: 'Left arm parallel to the ground in the backswing.',
    stopWhen: 'the first frame your left arm is level.',
    markTips: 'Hands: middle of the grip, between the two hands (not the wrists). Clubhead: centre of the head.' },
  { key: 'top', p: 'P4', name: 'Top of backswing',
    what: 'End of the backswing: the club stops going back.',
    stopWhen: 'the last frame before the club starts down. Watch the clubhead, not the hands — it keeps moving a little after the hands stop.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head (hidden if out of frame).' },
  { key: 'transition', p: 'P5', name: 'Transition',
    what: 'Left arm parallel to the ground on the way down.',
    stopWhen: 'the first frame your left arm is level again in the downswing.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head.' },
  { key: 'shaftDown', p: 'P6', name: 'Shaft parallel (down)',
    what: 'Shaft parallel to the ground in the downswing, hands around the right hip.',
    stopWhen: 'the first frame the shaft is level. From behind it often points at the camera — mark the clubhead hidden.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or hidden when the shaft points at the camera.' },
  { key: 'impact', p: 'P7', name: 'Impact',
    what: 'The clubface meets the ball.',
    stopWhen: 'the last frame where the ball is still sitting where it was (on the next frame it has gone or moved).',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head at the ball.' },
  { key: 'trailArm', p: 'P9', name: 'Trail arm parallel',
    what: 'Right arm parallel to the ground after impact.',
    stopWhen: 'the first frame your right arm is level in the follow-through.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head.' },
  { key: 'finish', p: 'P10', name: 'Finish',
    what: 'Swing complete and held.',
    stopWhen: 'the first frame where your body and the club have stopped moving.',
    markTips: 'Hands: middle of the grip. Clubhead: centre of the head, or hidden if out of frame.' },
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

export function cueFor(key, handedness = 'right') {
  const d = CHECKPOINT_DEFS.find((c) => c.key === key);
  if (!d) return null;
  if (handedness !== 'left') return { ...d };
  return { ...d, what: swapLR(d.what), stopWhen: swapLR(d.stopWhen), markTips: swapLR(d.markTips) };
}
