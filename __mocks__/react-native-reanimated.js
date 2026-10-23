// Minimal mock for react-native-reanimated in Jest
const Reanimated = require('react-native-reanimated/mock');

// The upstream mock (react-native-reanimated/src/mock.ts) doesn't implement
// useReducedMotion — it's explicitly left as a TODO there. Stub it so
// components can call the real hook unconditionally (satisfying
// react-hooks/rules-of-hooks) instead of feature-detecting it at runtime.
// The upstream mock stubs useAnimatedScrollHandler to a no-op factory, so a
// handler that drives real state (not just shared values) can never be
// exercised in tests. Return an invokable handler instead. Reanimated hands
// the worklet the unwrapped native payload, so unwrap it the same way.
const useAnimatedScrollHandler = (handlers) => {
  const onScroll = typeof handlers === 'function' ? handlers : handlers?.onScroll;
  if (!onScroll) return () => {};
  return (event) => onScroll(event?.nativeEvent ?? event);
};

// The upstream mock leaves useFrameCallback out ("ADD ME IF NEEDED"). Frames never tick
// in Jest, so components render their first frame from the shared values they start with.
const useFrameCallback = () => ({ setActive: () => {}, isActive: false, callbackId: -1 });

module.exports = {
  ...Reanimated,
  useReducedMotion: () => false,
  useAnimatedScrollHandler,
  useFrameCallback,
};
