// Draft, publication and snapshot behaviour of the card store (plan §3, §4).

jest.mock('../../../store/deviceId', () => ({
  getDeviceAuthorId: () => 'dev-me',
  initDeviceAuthorId: () => Promise.resolve('dev-me'),
}));

jest.mock('../../../lib/connectivity', () => {
  let online = true;
  const subs = new Set();
  return {
    isOnline: () => online,
    subscribeConnectivity: (fn) => {
      subs.add(fn);
      fn(online);
      return () => subs.delete(fn);
    },
    __setOnline: (next) => {
      if (next === online) return;
      online = next;
      subs.forEach((fn) => fn(online));
    },
  };
});

const {
  identify, publishHole, resetRound, resolve, restoreRound, setDraftEntry, setDraftShot,
} = require('../actions');
const {
  _resetReplicatorForTests,
  _setReplicatorClientForTests,
  getSyncStatus,
} = require('../replicator');
const {
  _resetRoundStateForTests, applyRound, getRoundState, loadRound, subscribeRound,
} = require('../roundState');
const { _setCardStorageForTests, cardKeys, getCardStorage } = require('../storage');
const { createFakeSupabase, createMemoryStorage } = require('./fakeSupabase');

const { __setOnline } = require('../../../lib/connectivity');

const TID = 't1';
const RID = 'r1';

let memory;
let fake;

function mineWrites() {
  return memory.setItem.mock.calls.filter(([k]) => k === cardKeys.mine(TID, RID));
}

beforeEach(() => {
  memory = createMemoryStorage();
  _setCardStorageForTests(memory);
  _resetRoundStateForTests();
  _resetReplicatorForTests();
  fake = createFakeSupabase();
  _setReplicatorClientForTests(fake.client);
  __setOnline(false); // keep the network out of these cases
});

afterEach(() => {
  _resetReplicatorForTests();
  __setOnline(true);
});

describe('draft', () => {
  it('round-trips through storage and survives a reload', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await setDraftEntry(TID, RID, 3, 'p2', 4);
    await setDraftShot(TID, RID, 3, 'p1', { club: '7i' });

    expect(getRoundState(TID, RID).draft).toEqual({
      3: { entries: { p1: 5, p2: 4 }, shots: { p1: { club: '7i' } } },
    });

    _resetRoundStateForTests();
    await loadRound(TID, RID);
    expect(getRoundState(TID, RID).draft[3].entries).toEqual({ p1: 5, p2: 4 });
    expect(getRoundState(TID, RID).loaded).toBe(true);
  });

  it('keeps a cleared cell as an explicit null, not an absence', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await setDraftEntry(TID, RID, 3, 'p1', null);
    const { draft } = getRoundState(TID, RID);
    expect(Object.prototype.hasOwnProperty.call(draft[3].entries, 'p1')).toBe(true);
    expect(draft[3].entries.p1).toBeNull();
  });

  it('never leaves the device: nothing is upserted while drafting (R1, R2)', async () => {
    __setOnline(true);
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    expect(fake.upserts).toHaveLength(0);
  });
});

describe('publishHole', () => {
  it('writes card and pending in ONE storage write and clears the draft (R7)', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await setDraftEntry(TID, RID, 3, 'p2', 4);
    memory.setItem.mockClear();

    await expect(publishHole(TID, RID, 3, 1000)).resolves.toBe(true);

    const writes = mineWrites();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1])).toEqual({
      card: {
        scorer: { playerId: null, userId: null },
        holes: { 3: { v: 1, entries: { p1: 5, p2: 4 }, ts: 1000 } },
      },
      pending: true,
    });

    const state = getRoundState(TID, RID);
    expect(state.draft[3]).toBeUndefined();
    expect(state.cardsByAuthor['dev-me'].holes[3].v).toBe(1);
    expect(state.pending.cards).toBe(true);
    expect(getSyncStatus()).toBe('pending');
  });

  it('is a no-op with no draft for the hole', async () => {
    memory.setItem.mockClear();
    await expect(publishHole(TID, RID, 7)).resolves.toBe(false);
    expect(mineWrites()).toHaveLength(0);
    expect(getRoundState(TID, RID).pending.cards).toBe(false);
  });

  it('consumes an all-blank draft without publishing an empty version', async () => {
    await setDraftEntry(TID, RID, 4, 'p1', null);
    await expect(publishHole(TID, RID, 4, 1000)).resolves.toBe(false);
    expect(getRoundState(TID, RID).draft[4]).toBeUndefined();
    expect(mineWrites()).toHaveLength(0);
  });

  it('bumps the version when the same hole is republished (S8)', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await setDraftEntry(TID, RID, 3, 'p1', 4);
    await publishHole(TID, RID, 3, 2000);

    const hole = getRoundState(TID, RID).cardsByAuthor['dev-me'].holes[3];
    expect(hole).toEqual({ v: 2, entries: { p1: 4 }, ts: 2000 });
  });

  it('registers the tournament in the pending index exactly once', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await setDraftEntry(TID, RID, 4, 'p1', 4);
    await publishHole(TID, RID, 4, 2000);
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([TID]);
  });
});

describe('identify', () => {
  it('stamps the scorer on every existing card and re-marks it pending', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await setDraftEntry(TID, 'r2', 1, 'p1', 3);
    await publishHole(TID, 'r2', 1, 1100);

    await expect(identify(TID, { playerId: 'p1', userId: 'u-marcos' })).resolves.toBe(2);
    expect(getRoundState(TID, RID).cardsByAuthor['dev-me'].scorer)
      .toEqual({ playerId: 'p1', userId: 'u-marcos' });
    expect(getRoundState(TID, 'r2').cardsByAuthor['dev-me'].holes[1].v).toBe(1);
    expect(JSON.parse(memory.map.get(cardKeys.meta(TID))).scorer)
      .toEqual({ playerId: 'p1', userId: 'u-marcos' });
  });

  it('applies to cards published after it too', async () => {
    await identify(TID, { playerId: 'p1', userId: 'u-marcos' });
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    expect(getRoundState(TID, RID).cardsByAuthor['dev-me'].scorer.userId).toBe('u-marcos');
  });
});

describe('getRoundState reference stability', () => {
  it('returns the same object until something changes', async () => {
    await loadRound(TID, RID);
    const first = getRoundState(TID, RID);
    expect(getRoundState(TID, RID)).toBe(first);
    expect(getRoundState(TID, RID)).toBe(first);

    await setDraftEntry(TID, RID, 3, 'p1', 5);
    const second = getRoundState(TID, RID);
    expect(second).not.toBe(first);
    expect(getRoundState(TID, RID)).toBe(second);
  });

  it('notifies subscribers once per action', async () => {
    await loadRound(TID, RID);
    const spy = jest.fn();
    const unsubscribe = subscribeRound(TID, RID, spy);

    await setDraftEntry(TID, RID, 3, 'p1', 5);
    expect(spy).toHaveBeenCalledTimes(1);
    await publishHole(TID, RID, 3, 1000);
    expect(spy).toHaveBeenCalledTimes(2);

    unsubscribe();
    await setDraftEntry(TID, RID, 4, 'p1', 5);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps two tournaments apart (S14)', async () => {
    await setDraftEntry('tA', RID, 3, 'p1', 5);
    await publishHole('tA', RID, 3, 1000);
    await setDraftEntry('tB', RID, 3, 'p1', 2);
    await publishHole('tB', RID, 3, 1000);

    expect(getRoundState('tA', RID).cardsByAuthor['dev-me'].holes[3].entries.p1).toBe(5);
    expect(getRoundState('tB', RID).cardsByAuthor['dev-me'].holes[3].entries.p1).toBe(2);
  });
});

describe('resetRound / restoreRound (HomeScreen Reset Round, Undo, Restore)', () => {
  const PEER_CARD = {
    scorer: { playerId: 'p2', userId: null },
    holes: { 3: { v: 1, entries: { p1: 4 }, ts: 900 } },
  };

  it('wipes my card, peer cards, drafts and agreements, and records a pending reset marker', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);

    // A peer card, persisted and indexed the way a pull would leave it, so
    // the reset has a real row to delete rather than an in-memory ghost.
    const store = getCardStorage();
    await store.setPeer(TID, RID, 'dev-guille', PEER_CARD);
    await store.setMeta(TID, { ...(await store.getMeta(TID)), peers: { [RID]: ['dev-guille'] } });
    applyRound(TID, RID, { peers: { 'dev-guille': PEER_CARD } });

    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 4, now: 1200 });
    await setDraftEntry(TID, RID, 4, 'p1', 6);

    await resetRound(TID, RID, 7777);

    const state = getRoundState(TID, RID);
    expect(state.cardsByAuthor).toEqual({});
    expect(state.draft).toEqual({});
    expect(state.resolutions).toEqual({});
    expect(state.pending.cards).toBe(false);

    expect(memory.map.get(cardKeys.mine(TID, RID))).toBeUndefined();
    expect(memory.map.get(cardKeys.peer(TID, RID, 'dev-guille'))).toBeUndefined();
    expect(JSON.parse(memory.map.get(cardKeys.draft(TID)))[RID]).toBeUndefined();
    expect(JSON.parse(memory.map.get(cardKeys.resolutions(TID)))[RID]).toBeUndefined();

    const meta = JSON.parse(memory.map.get(cardKeys.meta(TID)));
    expect(meta.pendingResets).toEqual({ [RID]: 7777 });
    expect(meta.peers[RID]).toBeUndefined();
    // The reset is itself a pending write: the tournament stays in the index.
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([TID]);
  });

  it('leaves another round of the same tournament untouched', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await setDraftEntry(TID, 'r2', 1, 'p1', 3);
    await publishHole(TID, 'r2', 1, 1100);

    await resetRound(TID, RID, 7777);

    expect(getRoundState(TID, RID).cardsByAuthor).toEqual({});
    expect(getRoundState(TID, 'r2').cardsByAuthor['dev-me'].holes[1].entries.p1).toBe(3);
  });

  it('restoreRound republishes a merged snapshot as my card, versions bumped and pending', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await resetRound(TID, RID, 7777);

    await restoreRound(TID, RID, { p1: { 3: 5, 4: 4 }, p2: { 3: 6 } }, 8888);

    const card = getRoundState(TID, RID).cardsByAuthor['dev-me'];
    expect(card.holes[3]).toEqual({ v: 1, entries: { p1: 5, p2: 6 }, ts: 8888 });
    expect(card.holes[4]).toEqual({ v: 1, entries: { p1: 4 }, ts: 8888 });
    expect(getRoundState(TID, RID).pending.cards).toBe(true);
    expect(JSON.parse(memory.map.get(cardKeys.mine(TID, RID))).pending).toBe(true);
  });

  it('restoreRound onto a live card bumps that hole to a NEW version', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);

    await restoreRound(TID, RID, { p1: { 3: 4 } }, 8888);

    const card = getRoundState(TID, RID).cardsByAuthor['dev-me'];
    expect(card.holes[3]).toEqual({ v: 2, entries: { p1: 4 }, ts: 8888 });
  });
});
