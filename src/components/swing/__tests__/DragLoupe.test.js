// The loupe component on its own (D20): imperative show / update / hide / flash, decorative for
// screen readers, and no fade for people who asked for reduced motion.
import React, { createRef } from 'react';
import { Image, StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import DragLoupe from '../DragLoupe';
import { loupeImage, loupePlacement } from '../../../swing/loupe';

jest.mock('react-native-reanimated', () => {
  const real = jest.requireActual('react-native-reanimated');
  return {
    ...real,
    useReducedMotion: jest.fn(() => false),
    useSharedValue: jest.fn(real.useSharedValue),
    withTiming: jest.fn(real.withTiming),
  };
});

const RECT = { w: 300, h: 500 };
const opts = { includeHiddenElements: true };
const mount = (props = {}) => {
  const ref = createRef();
  const utils = render(<DragLoupe ref={ref} rect={RECT} uri="file:///still.jpg" {...props} />);
  return { ref, ...utils, loupe: () => utils.queryByTestId('edit-loupe', opts) };
};

beforeEach(() => {
  jest.clearAllMocks();
  useReducedMotion.mockReturnValue(false);
});

describe('DragLoupe', () => {
  test('renders nothing until shown, then the still at 3x and the crosshair, and nothing after hide', () => {
    const { ref, loupe } = mount();
    expect(loupe()).toBeNull();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    const el = loupe();
    expect(StyleSheet.flatten(el.props.style)).toMatchObject({ width: 120, height: 120, borderRadius: 60, ...pick(loupePlacement([150, 300], RECT)) });
    const img = el.findByType(Image);
    expect(img.props.source).toEqual({ uri: 'file:///still.jpg' });
    expect(StyleSheet.flatten(img.props.style)).toMatchObject(loupeImage([0.4, 0.6], RECT));
    act(() => ref.current.hide());
    expect(loupe()).toBeNull();
  });

  test('update moves it without remounting', () => {
    const { ref, loupe } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    const before = StyleSheet.flatten(loupe().props.style);
    act(() => ref.current.update({ finger: [200, 320], mark: [0.5, 0.62] }));
    const after = StyleSheet.flatten(loupe().props.style);
    expect(after.left).toBe(before.left + 50);
    expect(after.top).toBe(before.top + 20);
  });

  test('flash puts it off the mark itself and takes it away after 600 ms', () => {
    jest.useFakeTimers();
    try {
      const { ref, loupe } = mount();
      act(() => ref.current.flash({ mark: [0.5, 0.5] }));
      const style = StyleSheet.flatten(loupe().props.style);
      expect(style).toMatchObject(pick(loupePlacement([150, 250], RECT)));
      act(() => { jest.advanceTimersByTime(599); });
      expect(loupe()).not.toBeNull();
      act(() => { jest.advanceTimersByTime(1); });
      expect(loupe()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('is decorative: no accessibility element, no touches', () => {
    const { ref, loupe } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(loupe().props).toMatchObject({
      accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', pointerEvents: 'none',
    });
  });

  test('fades in over a moment normally', () => {
    const { ref } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(useSharedValue).toHaveBeenCalledWith(0);
    expect(withTiming).toHaveBeenCalledTimes(1);
  });

  test('reduced motion: no fade, it is simply there', () => {
    useReducedMotion.mockReturnValue(true);
    const { ref, loupe } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(loupe()).not.toBeNull();
    expect(useSharedValue).toHaveBeenCalledWith(1);
    expect(withTiming).not.toHaveBeenCalled();
  });

  test('has no size to draw into: nothing', () => {
    const { ref, loupe } = mount({ rect: { w: 0, h: 0 } });
    act(() => ref.current.show({ finger: [0, 0], mark: [0.5, 0.5] }));
    expect(loupe()).toBeNull();
  });
});

function pick({ left, top }) { return { left, top }; }
