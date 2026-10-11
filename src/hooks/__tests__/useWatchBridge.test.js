import React from 'react';
import { render, act } from '@testing-library/react-native';
import { useWatchBridge } from '../useWatchBridge';
import { setWatchState, addWatchCommandListener } from '../../lib/watchBridge';

jest.mock('../../lib/watchBridge', () => ({
  setWatchState: jest.fn(),
  addWatchCommandListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../../lib/geo', () => ({ holeFeatures: () => null }));

function Probe(props) {
  useWatchBridge(props);
  return null;
}

const round = {
  id: 'r1',
  courseName: 'Lomas-Bosque',
  holes: [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 3, strokeIndex: 2 },
  ],
  playerHandicaps: { p1: 0 },
};
const base = {
  active: true,
  round,
  players: [{ id: 'p1', name: 'Marcos' }],
  meId: 'p1',
  scores: {},
  shotDetails: {},
  currentHole: 1,
  courseName: 'Lomas-Bosque',
  distances: { front: 131, center: 143, back: 156 },
  source: 'gps',
  units: 'meters',
  statGroups: { putting: true, teeShot: true, shortGame: true, penalties: true },
  blocked: null,
  onStrokes: jest.fn(),
  onShot: jest.fn(),
  onGoToHole: jest.fn(() => Promise.resolve()),
};

const pushed = () => setWatchState.mock.calls.map(([s]) => s);
let nextId = 0;
// A command as the watch builds it: a fresh id, based on the newest state.
const cmdJson = (obj) => JSON.stringify({
  v: 1, id: `c${++nextId}`, roundId: 'r1', baseRev: pushed().at(-1).rev, ...obj,
});
const listener = () => addWatchCommandListener.mock.calls.at(-1)[0];
const send = (obj) => act(async () => {
  await listener()(cmdJson(obj));
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('pushes state, then dedupes small distance moves but not big ones', () => {
  const { rerender } = render(<Probe {...base} />);
  expect(pushed()).toHaveLength(1);
  expect(pushed()[0]).toMatchObject({ active: true, roundId: 'r1', hole: { number: 1, par: 4 } });
  rerender(<Probe {...base} distances={{ front: 133, center: 146, back: 158 }} />);
  expect(pushed()).toHaveLength(1);
  rerender(<Probe {...base} distances={{ front: 140, center: 152, back: 165 }} />);
  expect(pushed()).toHaveLength(2);
  expect(pushed()[1].rev).toBeGreaterThan(pushed()[0].rev);
});

test('a score change pushes and carries points', () => {
  const { rerender } = render(<Probe {...base} />);
  rerender(<Probe {...base} scores={{ p1: { 1: 4 } }} />);
  expect(pushed()).toHaveLength(2);
  expect(pushed()[1].me).toMatchObject({ strokes: 4, points: 2, totalPoints: 2, thru: 1 });
});

test('inactive pushes active:false once', () => {
  const { rerender } = render(<Probe {...base} active={false} />);
  rerender(<Probe {...base} active={false} currentHole={2} />);
  expect(pushed()).toHaveLength(1);
  expect(pushed()[0]).toMatchObject({ active: false });
});

test('commands call the handlers and always republish', async () => {
  render(<Probe {...base} />);
  await send({ type: 'strokes', hole: 1, value: 5 });
  expect(base.onStrokes).toHaveBeenCalledWith(1, 5);
  await send({ type: 'shot', hole: 1, patch: { putts: 2 } });
  expect(base.onShot).toHaveBeenCalledWith(1, { putts: 2 });
  await send({ type: 'hole', to: 2 });
  expect(base.onGoToHole).toHaveBeenCalledWith(2);
  expect(pushed()).toHaveLength(4); // initial + one ack per command
});

test('a rejected command still republishes and touches nothing', async () => {
  render(<Probe {...base} />);
  await send({ type: 'strokes', hole: 2, value: 5 }); // not the current hole
  expect(base.onStrokes).not.toHaveBeenCalled();
  expect(pushed()).toHaveLength(2);
});

test('blocked state rejects writes', async () => {
  render(<Probe {...base} blocked="dispute" />);
  await send({ type: 'strokes', hole: 1, value: 5 });
  expect(base.onStrokes).not.toHaveBeenCalled();
  expect(pushed()[0].blocked).toBe('dispute');
});

test('unmount tells the watch there is no round', () => {
  const { unmount } = render(<Probe {...base} />);
  unmount();
  expect(pushed().at(-1)).toMatchObject({ active: false });
});

test('rev starts from the wall clock, so a new session never goes below the last one', () => {
  const before = Date.now();
  render(<Probe {...base} />);
  expect(pushed()[0].rev).toBeGreaterThanOrEqual(before);
});

test('a distance-only refresh is not urgent; content changes are', () => {
  const { rerender } = render(<Probe {...base} />);
  rerender(<Probe {...base} distances={{ front: 140, center: 152, back: 165 }} />);
  rerender(<Probe {...base} currentHole={2} />);
  expect(setWatchState.mock.calls.map(([, o]) => o.urgent)).toEqual([true, false, true]);
});

test('the ack waits for the write to land', async () => {
  const write = deferred();
  const onStrokes = jest.fn(() => write.promise);
  render(<Probe {...base} onStrokes={onStrokes} />);
  let done;
  await act(async () => { done = listener()(cmdJson({ type: 'strokes', hole: 1, value: 5 })); });
  expect(onStrokes).toHaveBeenCalledWith(1, 5);
  expect(pushed()).toHaveLength(1); // no ack yet: the write is still in flight
  await act(async () => { write.resolve(); await done; });
  expect(pushed()).toHaveLength(2);
});

test('a duplicate command id is acked but applied once', async () => {
  render(<Probe {...base} />);
  const json = cmdJson({ type: 'strokes', hole: 1, value: 5 });
  await act(async () => { await listener()(json); });
  await act(async () => { await listener()(json); });
  expect(base.onStrokes).toHaveBeenCalledTimes(1);
  expect(pushed()).toHaveLength(3);
});

describe('commands run one at a time, against the hole the phone is on now', () => {
  const nine = {
    ...round,
    holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
  };

  // A scorecard stand-in: the hole lives in a ref the move updates as soon as
  // it commits, the way ScorecardScreen.goToHole does; renders lag behind.
  function harness(start) {
    const hole = { current: start };
    const calls = [];
    const props = {
      ...base,
      round: nine,
      currentHole: start,
      getCurrentHole: () => hole.current,
      onStrokes: jest.fn(async (h, v) => { calls.push(['strokes', h, v]); }),
      onShot: jest.fn(async (h, p) => { calls.push(['shot', h, p]); }),
      onGoToHole: jest.fn(async (to) => {
        await Promise.resolve(); // publishing the hole being left
        calls.push(['hole', to]);
        hole.current = to;
      }),
    };
    return { hole, calls, props };
  }

  test('an offline catch-up burst replays in order and lands on the last hole', async () => {
    const { hole, calls, props } = harness(7);
    render(<Probe {...props} />);
    const baseRev = pushed()[0].rev; // the watch saw nothing newer while away
    const burst = [
      { type: 'strokes', hole: 7, value: 5 },
      { type: 'shot', hole: 7, patch: { putts: 2 } },
      { type: 'hole', to: 8 },
      { type: 'strokes', hole: 8, value: 4 },
      { type: 'shot', hole: 8, patch: { putts: 1 } },
      { type: 'hole', to: 9 },
    ];
    await act(async () => {
      // Delivered back to back; nothing re-renders in between.
      const all = burst.map((c) => listener()(cmdJson({ ...c, baseRev })));
      await Promise.all(all);
    });
    expect(calls).toEqual([
      ['strokes', 7, 5], ['shot', 7, { putts: 2 }], ['hole', 8],
      ['strokes', 8, 4], ['shot', 8, { putts: 1 }], ['hole', 9],
    ]);
    expect(hole.current).toBe(9);
  });

  test('two crown steps on the same baseRev both land: 7 -> 8 -> 9', async () => {
    const { hole, props } = harness(7);
    render(<Probe {...props} />);
    const baseRev = pushed()[0].rev;
    await act(async () => {
      await Promise.all([
        listener()(cmdJson({ type: 'hole', to: 8, baseRev })),
        listener()(cmdJson({ type: 'hole', to: 9, baseRev })),
      ]);
    });
    expect(props.onGoToHole.mock.calls).toEqual([[8], [9]]);
    expect(hole.current).toBe(9);
  });

  test('a stale hole command does not drag the pager back', async () => {
    const { hole, props } = harness(1);
    const { rerender } = render(<Probe {...props} />);
    const seenByWatch = pushed()[0].rev;
    // The phone moves on by itself and publishes it.
    hole.current = 2;
    rerender(<Probe {...props} currentHole={2} />);
    await send({ type: 'hole', to: 1, baseRev: seenByWatch });
    expect(props.onGoToHole).not.toHaveBeenCalled();
    expect(pushed().at(-1).hole.number).toBe(2);
    // Built on the state that showed hole 2, the same move is honoured.
    await send({ type: 'hole', to: 1 });
    expect(props.onGoToHole).toHaveBeenCalledWith(1);
  });

  test('a phone move not yet published makes every hole command stale', async () => {
    const { hole, props } = harness(1);
    render(<Probe {...props} />);
    hole.current = 3; // committed on the phone, not rendered yet
    await send({ type: 'hole', to: 2 });
    expect(props.onGoToHole).not.toHaveBeenCalled();
  });

  test('a write for the hole just left is refused once the move has committed', async () => {
    const { props } = harness(1);
    render(<Probe {...props} />);
    await act(async () => {
      const move = listener()(cmdJson({ type: 'hole', to: 2 }));
      const late = listener()(cmdJson({ type: 'strokes', hole: 1, value: 6 }));
      await Promise.all([move, late]);
    });
    expect(props.onGoToHole).toHaveBeenCalledWith(2);
    expect(props.onStrokes).not.toHaveBeenCalled();
  });
});

test('state acks the id of the last command processed, applied or rejected', async () => {
  render(<Probe {...base} />);
  expect(pushed()[0].ack).toBeNull();
  await act(async () => {
    await listener()(JSON.stringify({
      v: 1, id: 'ok1', roundId: 'r1', baseRev: pushed().at(-1).rev, type: 'strokes', hole: 1, value: 5,
    }));
  });
  expect(pushed().at(-1).ack).toBe('ok1');
  await act(async () => {
    await listener()(JSON.stringify({
      v: 1, id: 'no2', roundId: 'r1', baseRev: pushed().at(-1).rev, type: 'strokes', hole: 2, value: 5,
    }));
  });
  expect(pushed().at(-1).ack).toBe('no2');
  await act(async () => { await listener()('garbage'); });
  expect(pushed().at(-1).ack).toBe('no2');
});

test('a push before the write lands still carries the previous ack', async () => {
  let release;
  const onStrokes = jest.fn(() => new Promise((r) => { release = r; }));
  const { rerender } = render(<Probe {...base} onStrokes={onStrokes} />);
  let done;
  await act(async () => {
    done = listener()(JSON.stringify({
      v: 1, id: 'slow', roundId: 'r1', baseRev: pushed().at(-1).rev, type: 'strokes', hole: 1, value: 5,
    }));
  });
  rerender(<Probe {...base} onStrokes={onStrokes} distances={{ front: 140, center: 152, back: 165 }} />);
  expect(pushed().at(-1).ack).not.toBe('slow'); // a distance push is not the ack
  await act(async () => { release(); await done; });
  expect(pushed().at(-1).ack).toBe('slow');
});
