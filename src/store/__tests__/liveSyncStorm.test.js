// Regression tests for the live multi-device "sync storm": with several
// players scoring at once, every peer keystroke used to cost ~4 full
// get_game_tournament fetches and ~4 whole-screen reloads on every other
// device, and the background refresh raced the realtime row handlers for the
// same cached blob. Symptoms in the field: constant flashing / hole jumps on
// the scorecard, and a roster that flickered (a claimed player reverting,
// reappearing, or losing their name) while someone joined mid-round.
//
// Three defects, one per describe block:
//   1. getTournament() always fired a background fetch, so a change event
//      caused by a fetch caused another fetch — a self-sustaining loop.
//   2. _overlayAndSave (fetch → replace blob) ran unserialized against
//      realtimeSync's row handlers, so whichever finished last won outright.
//   3. applyPlayerRow trusted row.body for the player id, so a body without
//      one produced a nameless player that the next event could not match —
//      and therefore duplicated.
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseStub = {
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
  },
};

function mockOnline() {
  jest.doMock('../../lib/connectivity', () => ({
    isOnline: () => true,
    subscribeConnectivity: () => () => {},
  }));
}

const ROSTER = [
  { id: 'p1', name: 'Yeyen', user_id: 'u1' },
  { id: 'p2', name: 'Labarga' },
  { id: 'p3', name: 'Rubio' },
  { id: 'p4', name: 'Victor' },
];

function tournamentFixture(players = ROSTER) {
  return {
    id: 't1',
    name: 'Saturday',
    kind: 'game',
    players: players.map((p) => ({ ...p })),
    rounds: [{
      id: 'r1',
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: {},
      shotDetails: {},
    }],
    currentRound: 0,
  };
}

describe('background refresh is opt-out (breaks the fetch → emit → fetch loop)', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  test('getTournament({ refreshRemote: false }) serves the cache without fetching', async () => {
    mockOnline();
    const fetchTournament = jest.fn(() => Promise.resolve(tournamentFixture()));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament,
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => supabaseStub);

    const { saveLocal, getTournament } = require('../tournamentStore');
    await saveLocal(tournamentFixture());
    fetchTournament.mockClear();

    const t = await getTournament('t1', { refreshRemote: false });
    await new Promise((r) => setTimeout(r, 0));

    expect(t).toMatchObject({ id: 't1' });
    expect(fetchTournament).not.toHaveBeenCalled();
  });

  test('getTournament() still refreshes in the background by default', async () => {
    mockOnline();
    const fetchTournament = jest.fn(() => Promise.resolve(tournamentFixture()));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament,
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => supabaseStub);

    const { saveLocal, getTournament } = require('../tournamentStore');
    await saveLocal(tournamentFixture());
    fetchTournament.mockClear();

    await getTournament('t1');
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchTournament).toHaveBeenCalledWith('t1');
  });
});

describe('change events identify the tournament that changed', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  test('subscribers receive the changed tournament id', async () => {
    jest.doMock('../../lib/supabase', () => supabaseStub);
    const { saveLocal, subscribeTournamentChanges } = require('../tournamentStore');

    const seen = [];
    const unsub = subscribeTournamentChanges((id) => seen.push(id));
    await saveLocal(tournamentFixture());
    await saveLocal({ ...tournamentFixture(), id: 't2', name: 'Other' });
    unsub();

    expect(seen).toEqual(['t1', 't2']);
  });
});

describe('a stale background refresh cannot clobber a newer realtime patch', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  // The field scenario: a joiner claims their slot (claim_tournament_player
  // sets game_players.user_id + body.user_id). The claim arrives on this
  // device as a realtime game_players UPDATE. Meanwhile a get_game_tournament
  // fetch that STARTED BEFORE the claim committed is still in flight — its
  // snapshot still shows the slot unclaimed. Whichever save lands last wins,
  // so without serialization the roster flips back to unclaimed.
  test('a claim applied by realtime survives a fetch that started before it', async () => {
    mockOnline();

    let releaseFetch;
    const fetchTournament = jest.fn(() => new Promise((resolve) => {
      // Resolves with the PRE-claim snapshot — this fetch read the server
      // before claim_tournament_player committed.
      releaseFetch = () => resolve(tournamentFixture());
    }));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament,
      fetchMyTournaments: jest.fn(() => Promise.resolve([])),
    }));
    jest.doMock('../../lib/supabase', () => supabaseStub);
    jest.doMock('../syncQueue', () => ({
      syncQueue: { all: jest.fn(() => Promise.resolve([])) },
    }));

    const { saveLocal, readLocal, refreshTournamentFromRemote } = require('../tournamentStore');
    const { applyPlayerRow } = require('../realtimeSync');
    const { runExclusiveForTournament } = require('../tournamentMutex');

    await saveLocal(tournamentFixture());

    // 1. Background refresh starts — its snapshot predates the claim.
    const refresh = refreshTournamentFromRemote('t1');
    await new Promise((r) => setTimeout(r, 0));

    // 2. The claim lands via realtime while that fetch is in flight. Model the
    //    realtime handler faithfully: take the shared per-tournament lock,
    //    then readLocal → patch → saveLocal.
    const claimed = { ...ROSTER[1], user_id: 'u2' };
    const handled = runExclusiveForTournament('t1', async () => {
      const cached = await readLocal('t1');
      const patched = applyPlayerRow(cached, {
        tournament_id: 't1', player_id: 'p2', user_id: 'u2', pos: 1, body: claimed,
      }, 'UPDATE');
      await saveLocal(patched, { makeActive: false });
    });

    // 3. Only now does the stale fetch resolve.
    releaseFetch();
    await refresh;
    await handled;

    const persisted = await readLocal('t1');
    expect(persisted.players).toHaveLength(4);
    expect(persisted.players.find((p) => p.id === 'p2')).toMatchObject({
      name: 'Labarga', user_id: 'u2',
    });
  });
});

describe('applyPlayerRow anchors identity on the row primary key', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../tournamentStore', () => ({
      readLocal: jest.fn(), saveLocal: jest.fn(() => Promise.resolve()),
    }));
    jest.doMock('../../lib/supabase', () => ({
      supabase: { channel: jest.fn(), removeChannel: jest.fn() },
    }));
  });

  test('a body missing id still yields an identifiable player', () => {
    const { applyPlayerRow } = require('../realtimeSync');

    const t = { id: 't1', players: [{ id: 'p1', name: 'Yeyen' }], rounds: [] };
    const out = applyPlayerRow(t, {
      tournament_id: 't1', player_id: 'p2', pos: 1, body: { name: 'Labarga' },
    }, 'INSERT');

    expect(out.players).toEqual([
      { id: 'p1', name: 'Yeyen' },
      { id: 'p2', name: 'Labarga' },
    ]);
  });

  test('a second event for the same player updates rather than duplicates', () => {
    const { applyPlayerRow } = require('../realtimeSync');

    const t = { id: 't1', players: [{ id: 'p1', name: 'Yeyen' }], rounds: [] };
    const once = applyPlayerRow(t, {
      tournament_id: 't1', player_id: 'p2', pos: 1, body: { name: 'Labarga' },
    }, 'INSERT');
    const twice = applyPlayerRow(once, {
      tournament_id: 't1', player_id: 'p2', pos: 1, body: { name: 'Labarga', user_id: 'u2' },
    }, 'UPDATE');

    expect(twice.players).toHaveLength(2);
    expect(twice.players[1]).toEqual({ id: 'p2', name: 'Labarga', user_id: 'u2' });
  });
});
