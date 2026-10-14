// User-facing checkpoint definitions (plan D15), ported from the swing lab editor's
// checkpoints.js (the owner used it and liked its flow). Down-the-line view, right-handed
// text; cueFor(key, handedness) mirrors left and right for left-handed golfers.
//
// The ten definitions follow the P-system (P1-P10; P8 added by D22). `stop` is the marking
// canvas's always-visible stop line (D26): FIRST or LAST frame, the condition in a few words,
// what to watch, and the before / after captions of the fine strip; derived from `stopWhen`.
// The three internal frames (lateBackswing, preImpact, postImpact) are reachable from a check's
// "Place clubhead" button, so they get a short cue of their own (and no stop line).
//
// The text lives in the catalogues (locales/*/swingCues.js, 'swing.cue.<key>.<field>'); every
// text field here is a getter, so it follows the active language when it is read.
import { t, getLanguage } from '../i18n';

const cueText = (key, field) => t(`swing.cue.${key}.${field}`);

function def(key, p, stopKind) {
  const d = { key, p };
  ['name', 'what', 'stopWhen', 'markTips'].forEach((f) => {
    Object.defineProperty(d, f, { enumerable: true, get: () => cueText(key, f) });
  });
  if (stopKind) {
    Object.defineProperty(d, 'stop', {
      enumerable: true,
      get: () => ({
        kind: stopKind,
        short: cueText(key, 'stop.short'),
        watch: cueText(key, 'stop.watch'),
        before: cueText(key, 'stop.before'),
        after: cueText(key, 'stop.after'),
      }),
    });
  }
  return d;
}

export const CHECKPOINT_DEFS = [
  def('address', 'P1', 'last'),
  def('takeaway', 'P2', 'first'),
  def('leadArm', 'P3', 'first'),
  def('top', 'P4', 'last'),
  def('transition', 'P5', 'first'),
  def('shaftDown', 'P6', 'first'),
  def('impact', 'P7', 'last'),
  def('shaftThrough', 'P8', 'first'),
  def('trailArm', 'P9', 'first'),
  def('finish', 'P10', 'first'),
];

// Internal frames: not on the timeline, still markable (the clubhead-on-plane check reads preImpact).
const INTERNAL_DEFS = [
  def('lateBackswing', ''),
  def('preImpact', ''),
  def('postImpact', ''),
];

const flip = (word, other) => (m) => {
  const o = m.toLowerCase().startsWith(word) ? other : word;
  return m[0] === m[0].toUpperCase() ? o[0].toUpperCase() + o.slice(1) : o;
};
const swapLR = (text) => (getLanguage() === 'es'
  ? text.replace(/\b(izquierd|derech)([oa]s?)\b/gi, (m, stem, end) => flip('izquierd', 'derech')(stem) + end)
  : text.replace(/\b(left|right)\b/gi, (m) => flip('left', 'right')(m)));

/** The cue card for a checkpoint, mirrored for left-handers; null for an unknown key. */
export function cueFor(key, handedness = 'right') {
  const d = [...CHECKPOINT_DEFS, ...INTERNAL_DEFS].find((c) => c.key === key);
  if (!d) return null;
  if (handedness !== 'left') return { ...d };
  const s = d.stop;
  const stop = s ? { ...s, short: swapLR(s.short), watch: swapLR(s.watch) } : undefined;
  return {
    ...d, what: swapLR(d.what), stopWhen: swapLR(d.stopWhen), markTips: swapLR(d.markTips), stop,
  };
}
