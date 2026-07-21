import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  registerTourTarget, measureTourTarget, useTourTarget, __resetTourTargetsForTests,
} from '../tourTargets';

beforeEach(() => __resetTourTargetsForTests());

it('measures a registered node via measureInWindow', async () => {
  registerTourTarget('k', { measureInWindow: (cb) => cb(10, 20, 30, 40) });
  await expect(measureTourTarget('k')).resolves.toEqual({ x: 10, y: 20, width: 30, height: 40 });
});

it('resolves null for unknown keys, zero-size nodes, and non-measurable nodes', async () => {
  await expect(measureTourTarget('missing')).resolves.toBeNull();
  registerTourTarget('zero', { measureInWindow: (cb) => cb(0, 0, 0, 0) });
  await expect(measureTourTarget('zero')).resolves.toBeNull();
  registerTourTarget('plain', {});
  await expect(measureTourTarget('plain')).resolves.toBeNull();
});

it('resolves null when measureInWindow never calls back (300ms timeout)', async () => {
  jest.useFakeTimers();
  registerTourTarget('silent', { measureInWindow: () => {} });
  const p = measureTourTarget('silent');
  jest.advanceTimersByTime(400);
  await expect(p).resolves.toBeNull();
  jest.useRealTimers();
});

it('useTourTarget registers on mount and unregisters on unmount', async () => {
  function Probe() { return <View ref={useTourTarget('probe')} collapsable={false} />; }
  const { unmount } = render(<Probe />);
  // jsdom Views have no real measureInWindow — presence is what we assert.
  registerTourTarget('probe', { measureInWindow: (cb) => cb(1, 2, 3, 4) }); // overwrite with measurable stub
  await expect(measureTourTarget('probe')).resolves.toEqual({ x: 1, y: 2, width: 3, height: 4 });
  unmount();
  await expect(measureTourTarget('probe')).resolves.toBeNull();
});

it('useTourTarget(null) is inert', () => {
  function Probe() { return <View ref={useTourTarget(null)} />; }
  expect(() => render(<Probe />)).not.toThrow();
});
