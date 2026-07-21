// Minimal mock for react-native-reanimated in Jest
const Reanimated = require('react-native-reanimated/mock');

// The upstream mock (react-native-reanimated/src/mock.ts) doesn't implement
// useReducedMotion — it's explicitly left as a TODO there. Stub it so
// components can call the real hook unconditionally (satisfying
// react-hooks/rules-of-hooks) instead of feature-detecting it at runtime.
module.exports = {
  ...Reanimated,
  useReducedMotion: () => false,
};
