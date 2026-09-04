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

const { publishHole, resolve, setDraftEntry } = require('../actions');
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
  startReplication,
} = require('../replicator');
const { _resetRoundStateForTests, getRoundState, loadRound, subscribeRound } = require('../roundState');
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

  it('pushes the agreement with its version basis', async () => {
    await seedTwoOpinions();
    await resolve(TID, RID, { playerId: 'p1', hole: 3, value: 5, now: 5000 });
    await pushAll();

    const [upsert] = fake.upsertsFor('score_resolutions');
    expect(upsert.options).toEqual({ onConflict: 'tournament_id,round_id,player_id,hole' });
    expect(upsert.row).toEqual({
      tournament_id: TID,
      round_id: RID,
      player_id: 'p1',
      hole: 3,
      value: 5,
      resolved_by: 'dev-me',
      basis: { 'dev-me': 1, [PEER]: 1 },
    });
    expect(getRoundState(TID, RID).pending.resolutions).toBe(false);
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
