// Reanimated for the tests that watch a drag (DragLoupe, the marking canvas): the stock mock makes a
// fresh shared value on every render and evaluates a style once, so a value written from a gesture
// handler would be lost and never read back. Here a shared value persists, and an animated style is
// re-evaluated each time it is read, like the UI thread would. Used as
// `jest.mock('react-native-reanimated', () => require('<path>/liveReanimated'))`.
const React = require('react');

const real = jest.requireActual('react-native-reanimated');

function useSharedValue(init) {
  const ref = React.useRef(null);
  if (!ref.current) ref.current = { value: init };
  return ref.current;
}

function useAnimatedStyle(updater) {
  const fn = React.useRef(updater);
  fn.current = updater;
  const style = React.useRef(null);
  if (!style.current) {
    style.current = {};
    Object.keys(updater()).forEach((k) => {
      Object.defineProperty(style.current, k, { enumerable: true, get: () => fn.current()[k] });
    });
  }
  return style.current;
}

module.exports = { ...real, useSharedValue, useAnimatedStyle };
