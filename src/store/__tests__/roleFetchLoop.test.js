// Regression: on the Tournament screen (HomeScreen, focused) get_my_game_tournaments
// and get_game_tournament fired in a tight alternating loop.
//
// HomeScreen.reload runs on every store change while focused. It reads the
// tournament with getTournament/loadTournament (whose background refresh is
// _fetchAndOverlay → get_game_tournament) and the list with
// loadAllTournamentsWithFallback (→ get_my_game_tournaments). Both overlay and
// save the SAME tournament id, but the list entry carries `_role` (the RPC's
// role, added by tournamentRepo.fetchMyTournaments) and the single fetch does
// not. _overlayAndSave replaced the blob wholesale, so the two saves flipped
// `_role` in and out: each save changed the stored JSON, saveLocal emitted, and
// the reload ran again — forever.
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseStub = {
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
  },
};

function fixture() {
  return {
    id: 't1',
    name: 'Abama Golf · 14 Oct',
    kind: 'game',
    createdAt: '2026-10-14T08:00:00.000Z',
    players: [{ id: 'p1', name: 'A', user_id: 'u1' }],
    rounds: [{ id: 'r1', holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: {}, shotDetails: {} }],
    currentRound: 0,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Home reload: list + single fetch of the same tournament settle', () => {
  beforeEach(() => {
    jest.resetModules();
    AsyncStorage.clear();
  });

  test('a store change causes a bounded number of fetches, not a loop', async () => {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));
    const fetchTournament = jest.fn(() => Promise.resolve(fixture()));
    const fetchMyTournaments = jest.fn(() => Promise.resolve([{ ...fixture(), _role: 'owner' }]));
    jest.doMock('../tournamentRepo', () => ({ fetchTournament, fetchMyTournaments }));
    jest.doMock('../../lib/supabase', () => supabaseStub);

    const {
      saveLocal, getTournament, loadAllTournamentsWithFallback, subscribeTournamentChanges,
    } = require('../tournamentStore');
    await saveLocal(fixture(), { makeActive: false });

    // HomeScreen.reload, coalesced like the screen: serial, one trailing rerun.
    let inFlight = null;
    let pending = false;
    let reloads = 0;
    const reload = async () => {
      if (inFlight) { pending = true; return inFlight; }
      inFlight = (async () => {
        reloads += 1;
        await Promise.all([getTournament('t1'), loadAllTournamentsWithFallback()]);
        await settle(); // let the background single fetch land
      })();
      try { await inFlight; } finally { inFlight = null; }
      if (pending && reloads < 50) { pending = false; await reload(); }
      return undefined;
    };
    const unsub = subscribeTournamentChanges(() => { reload(); });

    await reload();
    for (let i = 0; i < 20; i++) await settle();
    unsub();

    // First reload: one of each. The writes it causes may trigger one more
    // reload, after which the blob is stable and nothing else fires.
    expect(reloads).toBeLessThanOrEqual(3);
    expect(fetchTournament.mock.calls.length).toBeLessThanOrEqual(3);
    expect(fetchMyTournaments.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test('the single fetch keeps the role the list stored', async () => {
    jest.doMock('../../lib/connectivity', () => ({
      isOnline: () => true,
      subscribeConnectivity: () => () => {},
    }));
    jest.doMock('../tournamentRepo', () => ({
      fetchTournament: jest.fn(() => Promise.resolve(fixture())),
      fetchMyTournaments: jest.fn(() => Promise.resolve([{ ...fixture(), _role: 'owner' }])),
    }));
    jest.doMock('../../lib/supabase', () => supabaseStub);
    const { saveLocal, readLocal, loadAllTournaments, refreshTournamentFromRemote } = require('../tournamentStore');
    await saveLocal(fixture(), { makeActive: false });
    await loadAllTournaments();
    expect((await readLocal('t1'))._role).toBe('owner');
    await refreshTournamentFromRemote('t1');
    expect((await readLocal('t1'))._role).toBe('owner');
  });
});
