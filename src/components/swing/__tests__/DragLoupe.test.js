// The loupe component on its own (D20): imperative show / update / hide / flash, drawn from shared
// values (no React render per move), decorative for screen readers, and no fade for people who asked
// for reduced motion.
import React, { createRef } from 'react';
import { Image, StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { useReducedMotion, withTiming } from 'react-native-reanimated';
import DragLoupe from '../DragLoupe';
import { loupeImage, loupePlacement } from '../../../swing/loupe';

jest.mock('react-native-reanimated', () => {
  const live = require('../../../swing/__tests__/liveReanimated');
  return {
    ...live,
    useReducedMotion: jest.fn(() => false),
    withTiming: jest.fn(live.withTiming),
  };
});

const RECT = { w: 300, h: 500 };
const opts = { includeHiddenElements: true };
const mount = (props = {}) => {
  const ref = createRef();
  let renders = 0;
  const Probe = (p) => { renders += 1; return <DragLoupe ref={ref} rect={RECT} uri="file:///still.jpg" {...p} />; };
  const utils = render(<Probe {...props} />);
  const ring = () => utils.getByTestId('edit-loupe', opts);
  const flat = (el) => StyleSheet.flatten(el.props.style);
  const at = (el) => { const { transform } = flat(el); return { left: transform[0].translateX, top: transform[1].translateY }; };
  return {
    ref, ring, flat, at, renders: () => renders, ...utils, visible: () => flat(ring()).opacity === 1,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  useReducedMotion.mockReturnValue(false);
});

describe('DragLoupe', () => {
  test('is mounted once and hidden by opacity until shown; then the still at 3x and the crosshair, hidden again after hide', () => {
    const { ref, ring, flat, at, visible } = mount();
    expect(visible()).toBe(false);
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(visible()).toBe(true);
    expect(flat(ring())).toMatchObject({ width: 120, height: 120, borderRadius: 60 });
    expect(at(ring())).toEqual({ left: loupePlacement([150, 300], RECT).left, top: loupePlacement([150, 300], RECT).top });
    const img = ring().findByType(Image);
    expect(img.props.source).toEqual({ uri: 'file:///still.jpg' });
    const photo = img.parent;
    const want = loupeImage([0.4, 0.6], RECT);
    expect(flat(photo)).toMatchObject({ width: want.width, height: want.height });
    expect(flat(photo).transform).toEqual([{ translateX: want.left }, { translateY: want.top }]);
    act(() => ref.current.hide());
    expect(visible()).toBe(false);
  });

  test('update moves the ring and the image offset without a single React render', () => {
    const {
      ref, ring, flat, at, renders,
    } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    const before = at(ring());
    const rendersBefore = renders();
    for (let k = 1; k <= 60; k += 1) ref.current.update({ finger: [150 + k, 300 + k / 2], mark: [0.4 + k / 1000, 0.6] });
    const after = at(ring());
    expect(after.left).toBe(before.left + 60);
    expect(after.top).toBe(before.top + 30);
    expect(flat(ring().findByType(Image).parent).transform[0].translateX).toBe(loupeImage([0.46, 0.6], RECT).left);
    expect(renders()).toBe(rendersBefore);
  });

  test('flash puts it off the mark itself and takes it away after 600 ms', () => {
    jest.useFakeTimers();
    try {
      const { ref, ring, at, visible } = mount();
      act(() => ref.current.flash({ mark: [0.5, 0.5] }));
      expect(at(ring())).toEqual({ left: loupePlacement([150, 250], RECT).left, top: loupePlacement([150, 250], RECT).top });
      act(() => { jest.advanceTimersByTime(599); });
      expect(visible()).toBe(true);
      act(() => { jest.advanceTimersByTime(1); });
      expect(visible()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the label follows the ring (above it, below near the top) and carries the mark colour', () => {
    const { ref, flat, getByTestId } = mount({ label: 'Placing · Hands', color: '#abc' });
    const label = () => getByTestId('edit-loupe-label', opts);
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(flat(label())).toMatchObject({ backgroundColor: '#abc', opacity: 1 });
    expect(flat(label()).transform[1].translateY).toBe(loupePlacement([150, 300], RECT).top - 24);
    act(() => ref.current.update({ finger: [150, 2], mark: [0.4, 0.004] }));
    expect(flat(label()).transform[1].translateY).toBe(loupePlacement([150, 2], RECT).top + 120 + 4);
  });

  test('a dragged mark kind draws that mark at the mark position until clearMark; the loupe going does not take it', () => {
    const { ref, flat, getByTestId } = mount();
    const dragged = () => getByTestId('edit-loupe-mark', opts);
    expect(flat(dragged()).opacity).toBe(0);
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6], kind: 'head' }));
    expect(flat(dragged())).toMatchObject({ opacity: 1, transform: [{ translateX: 120 }, { translateY: 300 }] });
    act(() => ref.current.update({ finger: [160, 310], mark: [0.5, 0.62] }));
    expect(flat(dragged()).transform).toEqual([{ translateX: 150 }, { translateY: 310 }]);
    act(() => ref.current.hide());
    expect(flat(dragged()).opacity).toBe(1);
    act(() => ref.current.clearMark());
    expect(flat(dragged()).opacity).toBe(0);
  });

  test('is decorative: no accessibility element, no touches', () => {
    const { ref, ring } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(ring().props).toMatchObject({
      accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', pointerEvents: 'none',
    });
  });

  test('fades in over a moment normally', () => {
    const { ref } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(withTiming).toHaveBeenCalledTimes(1);
  });

  test('reduced motion: no fade, it is simply there', () => {
    useReducedMotion.mockReturnValue(true);
    const { ref, visible } = mount();
    act(() => ref.current.show({ finger: [150, 300], mark: [0.4, 0.6] }));
    expect(visible()).toBe(true);
    expect(withTiming).not.toHaveBeenCalled();
  });

  test('has no size to draw into: nothing', () => {
    const { queryByTestId } = mount({ rect: { w: 0, h: 0 } });
    expect(queryByTestId('edit-loupe', opts)).toBeNull();
  });
});

describe('DragLoupe placement "corner" (D28)', () => {
  const { loupeCorner } = require('../../../swing/loupe');
  test('sits in the right-hand corner away from the mark, whatever the finger', () => {
    const { ref, ring, at } = mount({ placement: 'corner' });
    act(() => ref.current.show({ finger: [10, 10], mark: [0.4, 0.8] }));
    expect(at(ring())).toEqual(loupeCorner(0, RECT));
    act(() => ref.current.show({ finger: [10, 10], mark: [0.4, 0.2] }));
    expect(at(ring())).toEqual(loupeCorner(1, RECT));
  });

  test('takes shared values from its parent (a UI-thread gesture writes them)', () => {
    const Parent = () => {
      const v = require('../DragLoupe').useLoupeValues();
      Parent.v = v;
      return <DragLoupe values={v} placement="corner" rect={RECT} uri="file:///still.jpg" />;
    };
    const u = render(<Parent />);
    const flat = (el) => StyleSheet.flatten(el.props.style);
    act(() => { Parent.v.side.value = 1; Parent.v.opacity.value = 1; Parent.v.mx.value = 0.5; Parent.v.my.value = 0.3; });
    const r = u.getByTestId('edit-loupe', opts);
    expect(flat(r).opacity).toBe(1);
    expect(flat(r).transform).toEqual([{ translateX: loupeCorner(1, RECT).left }, { translateY: loupeCorner(1, RECT).top }]);
    expect(flat(r.findByType(Image).parent).transform).toEqual([{ translateX: loupeImage([0.5, 0.3], RECT).left }, { translateY: loupeImage([0.5, 0.3], RECT).top }]);
  });
});
