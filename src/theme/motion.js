import { Easing } from 'react-native-reanimated';

// The app's motion system: four speeds, one curve. Every animation picks its
// duration from here so the app moves with one rhythm.
//
//   touch   press-in, chips, steppers            fast enough to never feel laggy
//   state   switches, segmented pills, a number rolling over
//   place   screens, sheets, rows finding their new place
//   moment  a birdie ring, a save landing        rare by design
export const duration = {
  touch: 140,
  state: 240,
  place: 380,
  moment: 560,
};

// Bezier points shared by Reanimated (`ease.out`) and the navigation stack,
// which takes its own Easing (see App.js).
export const curves = {
  out: [0.23, 1, 0.32, 1],
  push: [0.32, 0.72, 0, 1],
};

export const ease = {
  out: Easing.bezier(...curves.out),
  push: Easing.bezier(...curves.push),
};

// withSpring configs. `snappy` settles with a small overshoot (switch knob,
// pills); `soft` has none (a pill that must not wobble past its edge).
export const spring = {
  snappy: { damping: 15, stiffness: 220, mass: 0.8 },
  soft: { damping: 22, stiffness: 240, mass: 0.9 },
};
