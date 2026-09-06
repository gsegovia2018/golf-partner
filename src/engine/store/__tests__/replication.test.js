// Replication: push with backoff, pull, realtime, reconnect (plan §4).
// Covers acceptance scenarios S5, S7, S11 and S14.

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
  publishHole, resolve, setDraftEntry,
} = require('../actions');
const {
  _resetReplicatorForTests,
  _setReplicatorClientForTests,
  closeLive,
  getLastError,
  getSyncStatus,
  onSynced,
  openLive,
  pull,
  pushAll,
  setRoundExistsResolver,
  startReplication,
} = require('../replicator');
const {
  _resetRoundStateForTests, dropRound, getRoundState, loadRound, subscribeRound,
} = require('../roundState');
const { isResolutionValid } = require('../../cards');
const { _setCardStorageForTests, cardKeys } = require('../storage');
const { createFakeSupabase, createMemoryStorage } = require('./fakeSupabase');

const { __setOnline } = require('../../../lib/connectivity');

const TID = 't1';
const RID = 'r1';
const PEER = 'dev-guille';

let memory;
let fake;

// Storage and the fake client resolve on microtasks only, so draining the
// microtask queue is enough to settle a fire-and-forget replication cycle.
const flush = async (ticks = 50) => {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
};

// The failure cases below deliberately drive errorReporting's console.error.
const silenceReporting = () => jest.spyOn(console, 'error').mockImplementation(() => {});

function peerCard(holes) {
  return { scorer: { playerId: null, userId: null }, holes };
}

function peerRow(holes, { tid = TID, roundId = RID, authorId = PEER } = {}) {
  return { tournament_id: tid, round_id: roundId, author_id: authorId, card: peerCard(holes) };
}

async function mine(tid = TID, roundId = RID) {
  return JSON.parse(memory.map.get(cardKeys.mine(tid, roundId)));
}

beforeEach(() => {
  memory = createMemoryStorage();
  _setCardStorageForTests(memory);
  _resetRoundStateForTests();
  _resetReplicatorForTests();
  fake = createFakeSupabase();
  _setReplicatorClientForTests(fake.client);
  __setOnline(true);
});

afterEach(() => {
  _resetReplicatorForTests();
  __setOnline(true);
  jest.restoreAllMocks();
});

describe('push', () => {
  it('upserts my whole card row and clears pending', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await pushAll();

    const [upsert] = fake.upsertsFor('scorer_cards');
    expect(upsert.options).toEqual({ onConflict: 'tournament_id,round_id,author_id' });
    expect(upsert.row).toEqual({
      tournament_id: TID,
      round_id: RID,
      author_id: 'dev-me',
      card: {
        scorer: { playerId: null, userId: null },
        holes: { 3: { v: 1, entries: { p1: 5 }, ts: 1000 } },
      },
    });
    expect((await mine()).pending).toBe(false);
    expect(getRoundState(TID, RID).pending.cards).toBe(false);
    expect(getSyncStatus()).toBe('idle');
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([]);
  });

  it('S7: a failed upsert stays pending, retries after backoff, and always sends the whole card', async () => {
    jest.useFakeTimers();
    silenceReporting();
    try {
      __setOnline(false);
      await setDraftEntry(TID, RID, 3, 'p1', 5);
      await publishHole(TID, RID, 3, 1000);
      await setDraftEntry(TID, RID, 4, 'p1', 4);
      await publishHole(TID, RID, 4, 2000);
      expect(getSyncStatus()).toBe('pending');

      fake.failUpserts('scorer_cards', 1, { message: 'network down', code: 'PGRST000' });
      __setOnline(true);
      await pushAll();

      expect(fake.tables.scorer_cards).toHaveLength(0);
      expect((await mine()).pending).toBe(true);
      expect(getSyncStatus()).toBe('error');
      expect(getLastError()).toEqual({ message: 'network down', code: 'PGRST000' });

      await jest.advanceTimersByTimeAsync(1000);

      const attempts = fake.upsertsFor('scorer_cards');
      expect(attempts).toHaveLength(2);
      // Never a partial hole: both attempts carry every published hole.
      for (const attempt of attempts) {
        expect(Object.keys(attempt.row.card.holes).sort()).toEqual(['3', '4']);
      }
      expect(fake.tables.scorer_cards).toHaveLength(1);
      expect((await mine()).pending).toBe(false);
      expect(getSyncStatus()).toBe('idle');
    } finally {
      jest.useRealTimers();
    }
  });

  it('S11: concurrent pushAll calls coalesce into one upsert per row', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    fake.upserts.length = 0;

    const a = pushAll();
    const b = pushAll();
    expect(a).toBe(b);
    await Promise.all([a, b]);

    expect(fake.upsertsFor('scorer_cards')).toHaveLength(1);
  });

  it('S14: pushes both tournaments; a failure in A does not block B, and neither state touches the other', async () => {
    jest.useFakeTimers();
    silenceReporting();
    try {
      __setOnline(false);
      await setDraftEntry('tA', RID, 3, 'p1', 5);
      await publishHole('tA', RID, 3, 1000);
      await setDraftEntry('tB', RID, 3, 'p1', 2);
      await publishHole('tB', RID, 3, 1000);
      expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual(['tA', 'tB']);

      // Only the first upsert (tournament A's) fails.
      fake.failUpserts('scorer_cards', 1);
      __setOnline(true);
      await pushAll();

      expect((await mine('tA')).pending).toBe(true);
      expect((await mine('tB')).pending).toBe(false);
      expect(fake.tables.scorer_cards.map((r) => r.tournament_id)).toEqual(['tB']);
      expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual(['tA']);

      expect(getRoundState('tA', RID).cardsByAuthor['dev-me'].holes[3].entries.p1).toBe(5);
      expect(getRoundState('tB', RID).cardsByAuthor['dev-me'].holes[3].entries.p1).toBe(2);

      await jest.advanceTimersByTimeAsync(1000);
      expect(fake.tables.scorer_cards.map((r) => r.tournament_id).sort()).toEqual(['tA', 'tB']);
      expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('S14: backoff and last error are per tournament — a stuck game does not pin another at the cap', async () => {
    jest.useFakeTimers();
    silenceReporting();
    const tACards = () => fake.upsertsFor('scorer_cards').filter((u) => u.row.tournament_id === 'tA');
    try {
      __setOnline(false);
      await setDraftEntry('tA', RID, 3, 'p1', 5);
      await publishHole('tA', RID, 3, 1000);
      __setOnline(true);

      // tA cannot land at all. It walks its own backoff: 1s, 2s, then 4s.
      fake.failUpsertsMatching('scorer_cards', { tournament_id: 'tA' }, 99, { message: 'A is stuck', code: 'PGRST000' });
      await pushAll();
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      expect(tACards()).toHaveLength(3);

      // tB now has one bad write of its own, four seconds into tA's wait.
      __setOnline(false);
      await setDraftEntry('tB', RID, 3, 'p1', 2);
      await publishHole('tB', RID, 3, 1000);
      __setOnline(true);
      fake.failUpsertsMatching('scorer_cards', { tournament_id: 'tB' }, 1, { message: 'B blipped', code: 'PGRST000' });
      await pushAll();

      expect((await mine('tB')).pending).toBe(true);
      // Each game keeps its own failure; neither speaks for the other.
      expect(getLastError('tA').message).toBe('A is stuck');
      expect(getLastError('tB').message).toBe('B blipped');

      // tB retries on ITS first step (1s), not on tA's. Under a shared counter
      // this write would have waited for tA's timer instead.
      const tABefore = tACards().length;
      await jest.advanceTimersByTimeAsync(1000);
      expect((await mine('tB')).pending).toBe(false);
      expect(tACards()).toHaveLength(tABefore);
      expect(getSyncStatus()).toBe('error');
      expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual(['tA']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('blocked by setup', () => {
  const FK = { message: 'game_scores violates foreign key constraint', code: '23503' };

  const publishOffline = async (tid = TID, roundId = RID) => {
    __setOnline(false);
    await setDraftEntry(tid, roundId, 3, 'p1', 5);
    await publishHole(tid, roundId, 3, 1000);
    __setOnline(true);
  };

  it('keeps retrying at the cap, and stays quiet, while the round still exists', async () => {
    jest.useFakeTimers();
    silenceReporting();
    try {
      setRoundExistsResolver(() => true);
      await publishOffline();
      fake.failUpsertsMatching('scorer_cards', { tournament_id: TID }, 99, FK);
      await pushAll();

      expect((await mine()).pending).toBe(true);
      // The setup queue simply has not landed the round row yet. That is not
      // something to alarm the scorer about.
      expect(getSyncStatus()).toBe('syncing');
      expect(fake.upsertsFor('scorer_cards')).toHaveLength(1);

      // Straight to the 60 s cap: there is nothing a fast retry could fix.
      await jest.advanceTimersByTimeAsync(59000);
      expect(fake.upsertsFor('scorer_cards')).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(fake.upsertsFor('scorer_cards')).toHaveLength(2);

      // Still blocked four minutes in — still quiet.
      await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
      expect(getSyncStatus()).toBe('syncing');

      // Past five minutes this stopped being a race and became a fault.
      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(getSyncStatus()).toBe('error');
      expect(getLastError(TID).code).toBe('23503');
      expect((await mine()).pending).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('an RLS rejection is treated the same way as the FK one', async () => {
    silenceReporting();
    setRoundExistsResolver(() => true);
    await publishOffline();
    fake.failUpsertsMatching('scorer_cards', { tournament_id: TID }, 1, { message: 'denied', code: '42501' });
    await pushAll();

    expect(getSyncStatus()).toBe('syncing');
    expect((await mine()).pending).toBe(true);
  });

  it('drops the card when the round is gone instead of failing on it forever', async () => {
    silenceReporting();
    setRoundExistsResolver(() => false);
    await publishOffline();
    fake.failUpsertsMatching('scorer_cards', { tournament_id: TID }, 99, FK);
    await pushAll();

    expect(memory.map.has(cardKeys.mine(TID, RID))).toBe(false);
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([]);
    expect(getRoundState(TID, RID).cardsByAuthor).toEqual({});
    expect(getRoundState(TID, RID).pending.cards).toBe(false);
    // Nothing left to retry, so nothing left to report.
    expect(getSyncStatus()).toBe('idle');
  });

  it('keeps the card when the resolver cannot say — never destroys scores on a guess', async () => {
    silenceReporting();
    setRoundExistsResolver(() => null);
    await publishOffline();
    fake.failUpsertsMatching('scorer_cards', { tournament_id: TID }, 1, FK);
    await pushAll();

    expect((await mine()).pending).toBe(true);
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([TID]);
  });

  it('a plain transient error is still a plain transient error', async () => {
    silenceReporting();
    setRoundExistsResolver(() => false);
    await publishOffline();
    fake.failUpsertsMatching('scorer_cards', { tournament_id: TID }, 1, { message: 'network down', code: 'PGRST000' });
    await pushAll();

    expect((await mine()).pending).toBe(true);
    expect(getSyncStatus()).toBe('error');
  });

  it('dropRound forgets the round: my card, the peers, the draft, the agreements and the pending flag', async () => {
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 900 } }));
    await pull(TID);
    __setOnline(false);
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 4, now: 5000 });
    await setDraftEntry(TID, RID, 4, 'p1', 3); // still unpublished
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([TID]);

    const spy = jest.fn();
    subscribeRound(TID, RID, spy);
    await dropRound(TID, RID);

    expect(memory.map.has(cardKeys.mine(TID, RID))).toBe(false);
    expect(memory.map.has(cardKeys.peer(TID, RID, PEER))).toBe(false);
    expect(JSON.parse(memory.map.get(cardKeys.draft(TID)))).toEqual({});
    expect(JSON.parse(memory.map.get(cardKeys.resolutions(TID)))).toEqual({});
    const meta = JSON.parse(memory.map.get(cardKeys.meta(TID)));
    expect(meta.rounds).toEqual([]);
    expect(meta.peers).toEqual({});
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([]);

    // A screen still mounted on the round is told, and sees nothing.
    expect(spy).toHaveBeenCalled();
    const st = getRoundState(TID, RID);
    expect(st.cardsByAuthor).toEqual({});
    expect(st.resolutions).toEqual({});
    expect(st.draft).toEqual({});
    expect(st.pending).toEqual({ cards: false, resolutions: false });
  });

  it('dropRound leaves another round of the same tournament pending', async () => {
    __setOnline(false);
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await setDraftEntry(TID, 'r2', 3, 'p1', 4);
    await publishHole(TID, 'r2', 3, 1000);

    await dropRound(TID, RID);

    expect(memory.map.has(cardKeys.mine(TID, 'r2'))).toBe(true);
    expect(JSON.parse(memory.map.get('@cards:pending'))).toEqual([TID]);
    expect(JSON.parse(memory.map.get(cardKeys.meta(TID))).rounds).toEqual(['r2']);
  });
});

describe('pull', () => {
  it('S5: seven holes of a peer card land in one go, with one notification for the round', async () => {
    const holes = {};
    for (let h = 3; h <= 9; h += 1) holes[h] = { v: 1, entries: { p1: 4, p2: 5 }, ts: 1000 + h };
    fake.seed('scorer_cards', peerRow(holes));

    await loadRound(TID, RID);
    const spy = jest.fn();
    subscribeRound(TID, RID, spy);

    await pull(TID);

    expect(spy).toHaveBeenCalledTimes(1);
    const state = getRoundState(TID, RID);
    expect(Object.keys(state.cardsByAuthor[PEER].holes).sort((a, b) => a - b))
      .toEqual(['3', '4', '5', '6', '7', '8', '9']);
    expect(state.lastPulledAt).toEqual(expect.any(Number));
    // The peer index is what a later reload hydrates from.
    expect(JSON.parse(memory.map.get(cardKeys.meta(TID))).peers[RID]).toEqual([PEER]);
  });

  it('S11: skips my own row — the local copy stays authoritative', async () => {
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await pushAll();

    // A stale server echo of my own row must not come back in.
    fake.seed('scorer_cards', {
      tournament_id: TID,
      round_id: RID,
      author_id: 'dev-me',
      card: peerCard({ 3: { v: 1, entries: { p1: 99 }, ts: 1 } }),
    });
    await pull(TID);

    expect(memory.map.has(cardKeys.peer(TID, RID, 'dev-me'))).toBe(false);
    expect(getRoundState(TID, RID).cardsByAuthor['dev-me'].holes[3].entries.p1).toBe(5);
  });

  it('restricts to one round when a roundId is given', async () => {
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 1 } }));
    fake.seed('scorer_cards', peerRow({ 1: { v: 1, entries: { p1: 3 }, ts: 1 } }, { roundId: 'r2' }));

    await pull(TID, RID);
    expect(getRoundState(TID, RID).cardsByAuthor[PEER]).toBeTruthy();
    expect(getRoundState(TID, 'r2').cardsByAuthor[PEER]).toBeUndefined();
  });

  it('a pull that brings nothing new writes nothing and keeps the snapshot identity', async () => {
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 900 } }));
    fake.seed('score_resolutions', {
      tournament_id: TID,
      round_id: RID,
      player_id: 'p1',
      hole: 3,
      value: 4,
      resolved_by: PEER,
      basis: { [PEER]: 1 },
      resolved_at: '2026-09-05T00:00:00.000Z',
    });
    await loadRound(TID, RID);
    await pull(TID);

    const first = getRoundState(TID, RID);
    const spy = jest.fn();
    subscribeRound(TID, RID, spy);
    memory.setItem.mockClear();

    // The scorecard polls this every 20 seconds. Identical rows must cost
    // nothing: no storage write, no new snapshot, no re-render.
    await pull(TID);

    expect(memory.setItem).not.toHaveBeenCalled();
    expect(getRoundState(TID, RID)).toBe(first);
    expect(spy).not.toHaveBeenCalled();

    // A real change still lands, and still stamps the pull.
    fake.seed('scorer_cards', peerRow({ 3: { v: 2, entries: { p1: 5 }, ts: 2000 } }));
    await pull(TID);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getRoundState(TID, RID).cardsByAuthor[PEER].holes[3].entries.p1).toBe(5);
    expect(getRoundState(TID, RID).lastPulledAt).toEqual(expect.any(Number));
  });

  it('an empty pull is not a change either', async () => {
    await loadRound(TID, RID);
    const first = getRoundState(TID, RID);
    const spy = jest.fn();
    subscribeRound(TID, RID, spy);
    memory.setItem.mockClear();

    await pull(TID, RID);

    expect(memory.setItem).not.toHaveBeenCalled();
    expect(getRoundState(TID, RID)).toBe(first);
    expect(spy).not.toHaveBeenCalled();
  });

  it('hydrates peer cards from storage after a reload (R5)', async () => {
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 1 } }));
    await pull(TID);

    _resetRoundStateForTests();
    await loadRound(TID, RID);
    expect(getRoundState(TID, RID).cardsByAuthor[PEER].holes[3].entries.p1).toBe(4);
  });
});

describe('realtime', () => {
  it('S11: the same payload delivered twice leaves identical state', async () => {
    await loadRound(TID, RID);
    openLive(TID);

    const row = peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 1000 } });
    fake.emit('scorer_cards', row);
    await flush();
    const first = getRoundState(TID, RID);

    fake.emit('scorer_cards', row);
    await flush();
    const second = getRoundState(TID, RID);

    expect(second.cardsByAuthor).toEqual(first.cardsByAuthor);
    expect(second.cardsByAuthor[PEER].holes[3].entries.p1).toBe(4);
  });

  it('is idempotent per tournament and tears down the previous one', async () => {
    const first = openLive(TID);
    expect(openLive(TID)).toBe(first);
    expect(fake.channels).toHaveLength(1);
    expect(first.name).toBe('cards-t1');

    openLive('t2');
    expect(fake.channels).toHaveLength(1);
    expect(fake.channels[0].name).toBe('cards-t2');

    closeLive();
    expect(fake.channels).toHaveLength(0);
  });

  it('rejoins with backoff after a channel error', async () => {
    jest.useFakeTimers();
    try {
      openLive(TID);
      fake.emitStatus('CHANNEL_ERROR');
      expect(fake.channels).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(1000);
      // The old channel was removed and a fresh one built for the same tid.
      expect(fake.channels).toHaveLength(1);
      expect(fake.channels[0].name).toBe('cards-t1');
    } finally {
      closeLive();
      jest.useRealTimers();
    }
  });
});

describe('resolutions', () => {
  const seedTwoOpinions = async () => {
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 900 } }));
    await pull(TID);
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    await pushAll();
  };

  it('pushes the agreement through put_score_resolution with its version basis', async () => {
    await seedTwoOpinions();
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 5, now: 5000 });
    await pushAll();

    const [call] = fake.rpcsFor('put_score_resolution');
    expect(call.params).toEqual({
      p_tournament_id: TID,
      p_round_id: RID,
      p_player_id: 'p1',
      p_hole: 3,
      p_value: 5,
      p_resolved_by: 'dev-me',
      p_basis: { 'dev-me': 1, [PEER]: 1 },
    });
    expect(fake.upsertsFor('score_resolutions')).toHaveLength(0);
    expect(getRoundState(TID, RID).pending.resolutions).toBe(false);
  });

  it('takes the agreed value onto my own card, anchored to the versions after it', async () => {
    await seedTwoOpinions();
    const res = await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 4, now: 5000 });

    const st = getRoundState(TID, RID);
    expect(st.cardsByAuthor['dev-me'].holes['3']).toEqual({ v: 2, entries: { p1: 4 }, ts: 5000 });
    expect(res.basis).toEqual({ 'dev-me': 2, [PEER]: 1 });
    expect(isResolutionValid(res, st.cardsByAuthor)).toBe(true);
    expect(st.pending.cards).toBe(true);
    expect((await mine()).pending).toBe(true);

    await pushAll();
    const [row] = fake.tables.scorer_cards.filter((r) => r.author_id === 'dev-me');
    expect(row.card.holes['3'].entries.p1).toBe(4);
  });

  it('leaves my card alone when it never marked the cell', async () => {
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 900 } }));
    await pull(TID);
    const res = await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 4, now: 5000 });

    const st = getRoundState(TID, RID);
    expect(st.cardsByAuthor['dev-me']).toBeUndefined();
    expect(res.basis).toEqual({ [PEER]: 1 });
    expect(st.pending.cards).toBe(false);
  });

  it('S8: revisiting the agreed hole keeps it agreed; a real edit re-opens it', async () => {
    await seedTwoOpinions();
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 4, now: 5000 });
    await pushAll();

    // The screen seeds a revisited hole's draft from my card; leaving it again
    // publishes an identical packet, which must not bump the version.
    await setDraftEntry(TID, RID, 3, 'p1', 4);
    expect(await publishHole(TID, RID, 3, 6000)).toBe(false);
    let st = getRoundState(TID, RID);
    expect(st.cardsByAuthor['dev-me'].holes['3'].v).toBe(2);
    expect(isResolutionValid(st.resolutions.p1['3'], st.cardsByAuthor)).toBe(true);

    // A genuine edit is a new opinion and does lapse the agreement.
    await setDraftEntry(TID, RID, 3, 'p1', 6);
    expect(await publishHole(TID, RID, 3, 7000)).toBe(true);
    st = getRoundState(TID, RID);
    expect(st.cardsByAuthor['dev-me'].holes['3'].v).toBe(3);
    expect(isResolutionValid(st.resolutions.p1['3'], st.cardsByAuthor)).toBe(false);
  });

  it('first agreement wins: a losing push adopts the standing server row', async () => {
    await seedTwoOpinions();
    // The peer agreed on 4 first, off the same card versions.
    fake.seed('score_resolutions', {
      tournament_id: TID,
      round_id: RID,
      player_id: 'p1',
      hole: 3,
      value: 4,
      resolved_by: PEER,
      basis: { 'dev-me': 1, [PEER]: 1 },
      resolved_at: '2026-09-05T00:00:00.000Z',
    });
    // My card already says 5, so agreeing on 5 does not bump it: same basis.
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 5, now: 5000 });
    await pushAll();

    const stored = getRoundState(TID, RID).resolutions.p1['3'];
    expect(stored.value).toBe(4);
    expect(stored.by).toBe(PEER);
    expect(stored.pending).toBeUndefined();
    expect(fake.tables.score_resolutions[0].value).toBe(4);
    expect(getSyncStatus()).toBe('idle');
  });

  it('replaces a standing agreement whose basis is stale', async () => {
    await seedTwoOpinions();
    // Agreed before my card existed: its basis no longer pins every marker.
    fake.seed('score_resolutions', {
      tournament_id: TID,
      round_id: RID,
      player_id: 'p1',
      hole: 3,
      value: 4,
      resolved_by: PEER,
      basis: { [PEER]: 1 },
      resolved_at: '2026-09-05T00:00:00.000Z',
    });
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 5, now: 5000 });
    await pushAll();

    const stored = getRoundState(TID, RID).resolutions.p1['3'];
    expect(stored.value).toBe(5);
    expect(stored.by).toBe('dev-me');
    expect(stored.basis).toEqual({ 'dev-me': 1, [PEER]: 1 });
    expect(fake.tables.score_resolutions[0].value).toBe(5);
  });

  it('a rejected agreement stays pending and keeps its value until it lands', async () => {
    silenceReporting();
    await seedTwoOpinions();
    fake.failRpc('put_score_resolution', 1);
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 5, now: 5000 });
    await pushAll();

    expect(getRoundState(TID, RID).resolutions.p1['3'].pending).toBe(true);
    expect(getSyncStatus()).toBe('error');
    expect(getLastError().message).toBe('network down');
    expect(await memory.map.get('@cards:pending')).toBe(JSON.stringify([TID]));

    await pushAll();
    expect(getRoundState(TID, RID).resolutions.p1['3'].pending).toBeUndefined();
    expect(getSyncStatus()).toBe('idle');
  });

  it('keeps a pending resolution through a pull, then takes the server copy once pushed', async () => {
    await seedTwoOpinions();
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 5, now: 5000 });
    expect(getRoundState(TID, RID).pending.resolutions).toBe(true);

    // An older server agreement must not overwrite mine before it is sent.
    fake.seed('score_resolutions', {
      tournament_id: TID,
      round_id: RID,
      player_id: 'p1',
      hole: 3,
      value: 4,
      resolved_by: PEER,
      basis: { [PEER]: 1 },
      resolved_at: '2026-01-01T00:00:00.000Z',
    });
    await pull(TID);

    let stored = getRoundState(TID, RID).resolutions.p1[3];
    expect(stored.value).toBe(5);
    expect(stored.pending).toBe(true);

    await pushAll();
    expect(getRoundState(TID, RID).resolutions.p1[3].pending).toBeUndefined();

    // Now that it has landed, the server row is the one that wins.
    fake.seed('score_resolutions', {
      tournament_id: TID,
      round_id: RID,
      player_id: 'p1',
      hole: 3,
      value: 5,
      resolved_by: 'dev-me',
      basis: { 'dev-me': 1, [PEER]: 1 },
      resolved_at: '2026-02-02T00:00:00.000Z',
    });
    await pull(TID);

    stored = getRoundState(TID, RID).resolutions.p1[3];
    expect(stored).toEqual({
      roundId: RID,
      playerId: 'p1',
      hole: 3,
      value: 5,
      by: 'dev-me',
      ts: Date.parse('2026-02-02T00:00:00.000Z'),
      basis: { 'dev-me': 1, [PEER]: 1 },
    });
  });

  it('refuses to resolve a cell nobody marked', async () => {
    await loadRound(TID, RID);
    await expect(resolve(TID, RID, { playerId: 'p1', hole: 3, value: 4, now: 1 }))
      .rejects.toThrow(/nothing to resolve/);
  });
});

describe('reconnect', () => {
  it('pushes, pulls, then announces synced when connectivity returns', async () => {
    __setOnline(false);
    await setDraftEntry(TID, RID, 3, 'p1', 5);
    await publishHole(TID, RID, 3, 1000);
    fake.seed('scorer_cards', peerRow({ 3: { v: 1, entries: { p1: 4 }, ts: 900 } }));

    await loadRound(TID, RID);
    openLive(TID);
    const synced = jest.fn();
    onSynced(synced);
    startReplication(); // fires immediately with online=false: no reconnect yet
    await flush();
    expect(fake.upserts).toHaveLength(0);

    __setOnline(true);
    await flush(200);

    expect(fake.upsertsFor('scorer_cards')).toHaveLength(1);
    expect(getRoundState(TID, RID).cardsByAuthor[PEER].holes[3].entries.p1).toBe(4);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(synced).toHaveBeenCalledWith({ tid: TID });
    expect(getSyncStatus()).toBe('idle');
  });
});
