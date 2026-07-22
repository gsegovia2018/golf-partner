import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  registerTourTarget, measureTourTarget, useTourTarget, __resetTourTargetsForTests,
  __getRegisteredTourKeysForTests,
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
  let capturedNode;
  function Probe() {
    const tourRef = useTourTarget('probe');
    // Capture the real registered node so the stub is attached to the SAME
    // object the hook holds — unregister is now node-identity-guarded, so
    // swapping in an unrelated object here would look like a different
    // owner took the key and unmount would (correctly) leave it alone.
    return <View ref={(node) => { capturedNode = node; tourRef(node); }} collapsable={false} />;
  }
  const { unmount } = render(<Probe />);
  // jsdom Views have no real measureInWindow — patch it onto the actual
  // registered node so presence is what we assert.
  capturedNode.measureInWindow = (cb) => cb(1, 2, 3, 4);
  await expect(measureTourTarget('probe')).resolves.toEqual({ x: 1, y: 2, width: 3, height: 4 });
  unmount();
  await expect(measureTourTarget('probe')).resolves.toBeNull();
});

it('useTourTarget(null) is inert', () => {
  function Probe() { return <View ref={useTourTarget(null)} />; }
  expect(() => render(<Probe />)).not.toThrow();
});

// Regression for the off-screen HolePage bug: 18 pages share the
// 'score-entry' key and swap which one is "active" as the pager swipes.
// React's commit order for a same-render key handoff is: instance A's
// ref-callback detach -> instance B's ref-callback attach -> instance A's
// PASSIVE effect cleanup (queued from the old render, so it runs last).
// A naive unconditional `registerTourTarget(key, null)` in that trailing
// cleanup deletes B's brand-new registration. This test renders two probes
// that swap 'k' between them in a single rerender and asserts the registry
// still holds 'k' afterward.
function SwapProbe({ activeKey }) {
  return <View ref={useTourTarget(activeKey)} collapsable={false} />;
}
function SwapHarness({ firstActive }) {
  return (
    <>
      <SwapProbe activeKey={firstActive ? 'k' : null} />
      <SwapProbe activeKey={firstActive ? null : 'k'} />
    </>
  );
}

it('handing a shared key from one instance to another in the same rerender keeps it registered', () => {
  const { rerender } = render(<SwapHarness firstActive />);
  expect(__getRegisteredTourKeysForTests()).toContain('k');

  rerender(<SwapHarness firstActive={false} />);

  expect(__getRegisteredTourKeysForTests()).toContain('k');
});
