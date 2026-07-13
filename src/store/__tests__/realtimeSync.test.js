// jest.mock calls are hoisted above these imports by babel-jest, so the
// mocks are in place before ../realtimeSync and its dependencies load.
import {
  applyScoreRow, applyShotDetailRow, applyNoteRow, applyRoundRow,
  applyPlayerRow, applyTournamentRow,
  ensureRealtimeForTournament, stopRealtime,
} from '../realtimeSync';
import { readLocal, saveLocal } from '../tournamentStore';
import { applyPendingMutations, preserveLocalConflictState } from '../mutate';
import { syncQueue } from '../syncQueue';
import { supabase } from '../../lib/supabase';

jest.mock('../tournamentStore', () => ({
  readLocal: jest.fn(),
  saveLocal: jest.fn(() => Promise.resolve()),
}));

jest.mock('../mutate', () => ({
  applyPendingMutations: jest.fn((t) => t),
  preserveLocalConflictState: jest.fn((target) => target),
}));

jest.mock('../syncQueue', () => ({
  syncQueue: { all: jest.fn(() => Promise.resolve([])) },
}));

jest.mock('../../lib/supabase', () => {
  const channel = {
    on: jest.fn(function on() { return this; }),
    subscribe: jest.fn(function subscribe() { return this; }),
  };
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
    },
  };
});

describe('applyScoreRow', () => {
  test('sets strokes at rounds[byId].scores[player][hole]', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    const row = { round_id: 'r1', player_id: 'p1', hole: 3, strokes: 5 };
    const out = applyScoreRow(t, row);
    expect(out.rounds[0].scores).toEqual({ p1: { 3: 5 } });
    // pure: input untouched
    expect(t.rounds[0].scores).toEqual({});
  });

  test('creates nested player/hole objects when missing', () => {
    const t = { id: 't1', rounds: [{ id: 'r1' }] };
    const out = applyScoreRow(t, { round_id: 'r1', player_id: 'p2', hole: 1, strokes: 4 });
    expect(out.rounds[0].scores).toEqual({ p2: { 1: 4 } });
  });

  test('merges into existing sibling holes/players without clobbering them', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 1: 4 }, p2: { 1: 3 } } }] };
    const out = applyScoreRow(t, { round_id: 'r1', player_id: 'p1', hole: 2, strokes: 5 });
    expect(out.rounds[0].scores).toEqual({ p1: { 1: 4, 2: 5 }, p2: { 1: 3 } });
  });

  test('strokes == null deletes the hole key (tombstone)', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 1: 4, 2: 5 } } }] };
    const out = applyScoreRow(t, { round_id: 'r1', player_id: 'p1', hole: 1, strokes: null });
    expect(out.rounds[0].scores).toEqual({ p1: { 2: 5 } });
  });

  test('no-op if round not found', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    const out = applyScoreRow(t, { round_id: 'rX', player_id: 'p1', hole: 1, strokes: 4 });
    expect(out.rounds).toEqual(t.rounds);
  });

  test('deleting the last hole for a player prunes the now-empty player bucket', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 1: 4 }, p2: { 1: 3 } } }] };
    const out = applyScoreRow(t, { round_id: 'r1', player_id: 'p1', hole: 1, strokes: null });
    expect(out.rounds[0].scores).toEqual({ p2: { 1: 3 } });
  });

  test('DELETE (PK-only old record, no strokes field) deletes the cell', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 1: 4, 2: 5 } } }] };
    const out = applyScoreRow(t, { round_id: 'r1', player_id: 'p1', hole: 1 }, 'DELETE');
    expect(out.rounds[0].scores).toEqual({ p1: { 2: 5 } });
  });

  test('DELETE is a no-op when the cell is already absent', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', scores: { p1: { 2: 5 } } }] };
    const out = applyScoreRow(t, { round_id: 'r1', player_id: 'p1', hole: 1 }, 'DELETE');
    expect(out.rounds[0].scores).toEqual({ p1: { 2: 5 } });
  });
});

describe('applyShotDetailRow', () => {
  test('sets detail at rounds[byId].shotDetails[player][hole]', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', shotDetails: {} }] };
    const detail = { putts: 2, club: '7i' };
    const out = applyShotDetailRow(t, { round_id: 'r1', player_id: 'p1', hole: 4, detail });
    expect(out.rounds[0].shotDetails).toEqual({ p1: { 4: detail } });
  });

  test('detail == null deletes the hole key (tombstone)', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', shotDetails: { p1: { 4: { putts: 2 }, 5: { putts: 1 } } } }] };
    const out = applyShotDetailRow(t, { round_id: 'r1', player_id: 'p1', hole: 4, detail: null });
    expect(out.rounds[0].shotDetails).toEqual({ p1: { 5: { putts: 1 } } });
  });

  test('no-op if round not found', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', shotDetails: {} }] };
    const out = applyShotDetailRow(t, { round_id: 'rX', player_id: 'p1', hole: 1, detail: { putts: 1 } });
    expect(out.rounds).toEqual(t.rounds);
  });

  test('deleting the last hole for a player prunes the now-empty player bucket', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', shotDetails: { p1: { 4: { putts: 2 } } } }] };
    const out = applyShotDetailRow(t, { round_id: 'r1', player_id: 'p1', hole: 4, detail: null });
    expect(out.rounds[0].shotDetails).toEqual({});
  });

  test('DELETE (PK-only old record, no detail field) deletes the cell', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', shotDetails: { p1: { 4: { putts: 2 }, 5: { putts: 1 } } } }] };
    const out = applyShotDetailRow(t, { round_id: 'r1', player_id: 'p1', hole: 4 }, 'DELETE');
    expect(out.rounds[0].shotDetails).toEqual({ p1: { 5: { putts: 1 } } });
  });

  test('DELETE is a no-op when the cell is already absent', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', shotDetails: { p1: { 5: { putts: 1 } } } }] };
    const out = applyShotDetailRow(t, { round_id: 'r1', player_id: 'p1', hole: 4 }, 'DELETE');
    expect(out.rounds[0].shotDetails).toEqual({ p1: { 5: { putts: 1 } } });
  });
});

describe('applyNoteRow', () => {
  test("hole_key 'round' sets notes.round", () => {
    const t = { id: 't1', rounds: [{ id: 'r1' }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: 'round', note: 'Great day' });
    expect(out.rounds[0].notes).toEqual({ round: 'Great day' });
  });

  test('non-round hole_key sets notes.hole[holeKey]', () => {
    const t = { id: 't1', rounds: [{ id: 'r1' }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: '7', note: 'water left' });
    expect(out.rounds[0].notes).toEqual({ hole: { 7: 'water left' } });
  });

  test('preserves sibling notes (round + other holes) when adding one', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', notes: { round: 'Great day', hole: { 3: 'bunker' } } }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: '7', note: 'water left' });
    expect(out.rounds[0].notes).toEqual({ round: 'Great day', hole: { 3: 'bunker', 7: 'water left' } });
  });

  test('note == null deletes round note key, dropping notes entirely when nothing else remains', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', notes: { round: 'Great day' } }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: 'round', note: null });
    expect(out.rounds[0].notes).toBeUndefined();
  });

  test('note == null deletes a hole note key, dropping the hole bucket when empty but keeping round note', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', notes: { round: 'Great day', hole: { 3: 'bunker' } } }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: '3', note: null });
    expect(out.rounds[0].notes).toEqual({ round: 'Great day' });
  });

  test('no-op if round not found', () => {
    const t = { id: 't1', rounds: [{ id: 'r1' }] };
    const out = applyNoteRow(t, { round_id: 'rX', hole_key: 'round', note: 'x' });
    expect(out.rounds).toEqual(t.rounds);
  });

  test('DELETE (PK-only old record, no note field) removes a round note', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', notes: { round: 'Great day', hole: { 3: 'bunker' } } }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: 'round' }, 'DELETE');
    expect(out.rounds[0].notes).toEqual({ hole: { 3: 'bunker' } });
  });

  test('DELETE (PK-only old record) removes a hole note', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', notes: { hole: { 3: 'bunker' } } }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: '3' }, 'DELETE');
    expect(out.rounds[0].notes).toBeUndefined();
  });

  test('DELETE is a no-op when the note is already absent', () => {
    const t = { id: 't1', rounds: [{ id: 'r1', notes: { round: 'Great day' } }] };
    const out = applyNoteRow(t, { round_id: 'r1', hole_key: '3' }, 'DELETE');
    expect(out.rounds[0].notes).toEqual({ round: 'Great day' });
  });
});

describe('applyRoundRow', () => {
  test('upserts a new round at its round_index, preserving array order', () => {
    const t = {
      id: 't1',
      rounds: [{ id: 'r0', courseName: 'A' }, { id: 'r2', courseName: 'C' }],
    };
    const out = applyRoundRow(t, { id: 'r1', round_index: 1, body: { courseName: 'B' } });
    expect(out.rounds.map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
    // A brand-new round carries empty scores/shotDetails for refetch parity.
    expect(out.rounds[1]).toEqual({
      id: 'r1', courseName: 'B', scores: {}, shotDetails: {},
    });
  });

  test('updates an existing round body while preserving hot keys (scores/shotDetails/notes)', () => {
    const t = {
      id: 't1',
      rounds: [{
        id: 'r0', courseName: 'Old', scores: { p1: { 1: 4 } }, shotDetails: { p1: { 1: { putts: 2 } } }, notes: { round: 'hi' },
      }],
    };
    const out = applyRoundRow(t, { id: 'r0', round_index: 0, body: { courseName: 'New' } });
    expect(out.rounds[0]).toEqual({
      id: 'r0', courseName: 'New', scores: { p1: { 1: 4 } }, shotDetails: { p1: { 1: { putts: 2 } } }, notes: { round: 'hi' },
    });
  });

  test('reorders when round_index changes for an existing round', () => {
    const t = { id: 't1', rounds: [{ id: 'r0' }, { id: 'r1' }] };
    const out = applyRoundRow(t, { id: 'r0', round_index: 1, body: {} });
    expect(out.rounds.map((r) => r.id)).toEqual(['r1', 'r0']);
  });

  test('clamps an index beyond current length to append at the end', () => {
    const t = { id: 't1', rounds: [{ id: 'r0' }] };
    const out = applyRoundRow(t, { id: 'r5', round_index: 99, body: { courseName: 'Z' } });
    expect(out.rounds.map((r) => r.id)).toEqual(['r0', 'r5']);
  });

  test('a brand-new round gets empty scores/shotDetails (parity with get_game_tournament) but no notes key', () => {
    const t = { id: 't1', rounds: [] };
    const out = applyRoundRow(t, { id: 'r0', round_index: 0, body: { courseName: 'A' } });
    expect(out.rounds[0]).toEqual({
      id: 'r0', courseName: 'A', scores: {}, shotDetails: {},
    });
  });

  test('an update preserves existing hot keys rather than resetting them to {}', () => {
    const t = { id: 't1', rounds: [{ id: 'r0', scores: { p1: { 1: 4 } }, shotDetails: { p1: { 1: { putts: 2 } } } }] };
    const out = applyRoundRow(t, { id: 'r0', round_index: 0, body: { courseName: 'B' } });
    expect(out.rounds[0].scores).toEqual({ p1: { 1: 4 } });
    expect(out.rounds[0].shotDetails).toEqual({ p1: { 1: { putts: 2 } } });
  });

  test('DELETE (PK-only old record) removes the round by id', () => {
    const t = { id: 't1', rounds: [{ id: 'r0' }, { id: 'r1' }] };
    const out = applyRoundRow(t, { tournament_id: 't1', id: 'r0' }, 'DELETE');
    expect(out.rounds.map((r) => r.id)).toEqual(['r1']);
  });

  test('DELETE is a no-op when the round is already absent', () => {
    const t = { id: 't1', rounds: [{ id: 'r1' }] };
    const out = applyRoundRow(t, { tournament_id: 't1', id: 'rX' }, 'DELETE');
    expect(out.rounds.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('applyPlayerRow', () => {
  test('upserts a new player at its pos, preserving array order', () => {
    const t = { id: 't1', players: [{ id: 'p0', name: 'A' }, { id: 'p2', name: 'C' }] };
    const out = applyPlayerRow(t, { player_id: 'p1', pos: 1, body: { id: 'p1', name: 'B' } });
    expect(out.players.map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);
    expect(out.players[1]).toEqual({ id: 'p1', name: 'B' });
  });

  test('updates an existing player body in place at its pos', () => {
    const t = { id: 't1', players: [{ id: 'p0', name: 'Old' }] };
    const out = applyPlayerRow(t, { player_id: 'p0', pos: 0, body: { id: 'p0', name: 'New' } });
    expect(out.players).toEqual([{ id: 'p0', name: 'New' }]);
  });

  test('reorders when pos changes for an existing player', () => {
    const t = { id: 't1', players: [{ id: 'p0' }, { id: 'p1' }] };
    const out = applyPlayerRow(t, { player_id: 'p0', pos: 1, body: { id: 'p0' } });
    expect(out.players.map((p) => p.id)).toEqual(['p1', 'p0']);
  });

  test('clamps an index beyond current length to append at the end', () => {
    const t = { id: 't1', players: [{ id: 'p0' }] };
    const out = applyPlayerRow(t, { player_id: 'p5', pos: 99, body: { id: 'p5' } });
    expect(out.players.map((p) => p.id)).toEqual(['p0', 'p5']);
  });

  test('DELETE (PK-only old record, no body) removes the player by player_id', () => {
    const t = { id: 't1', players: [{ id: 'p0' }, { id: 'p1' }] };
    const out = applyPlayerRow(t, { tournament_id: 't1', player_id: 'p0' }, 'DELETE');
    expect(out.players.map((p) => p.id)).toEqual(['p1']);
  });

  test('DELETE is a no-op when the player is already absent', () => {
    const t = { id: 't1', players: [{ id: 'p1' }] };
    const out = applyPlayerRow(t, { tournament_id: 't1', player_id: 'p0' }, 'DELETE');
    expect(out.players.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('applyTournamentRow', () => {
  test('merges props into top-level fields one level deep', () => {
    const t = { id: 't1', name: 'Old', kind: 'game', settings: { fixedTeams: false }, rounds: [], players: [] };
    const out = applyTournamentRow(t, {
      id: 't1', name: 'Old', kind: 'game', props: { settings: { fixedTeams: true } }, current_round: 0,
    });
    expect(out.settings).toEqual({ fixedTeams: true });
  });

  test('currentRound becomes the max of existing and incoming', () => {
    const t = { id: 't1', currentRound: 2, rounds: [], players: [] };
    const out = applyTournamentRow(t, { id: 't1', props: {}, current_round: 1 });
    expect(out.currentRound).toBe(2);
    const out2 = applyTournamentRow(t, { id: 't1', props: {}, current_round: 3 });
    expect(out2.currentRound).toBe(3);
  });

  test('takes name from the row column; kind is the domain kind from props, column as fallback', () => {
    const t = { id: 't1', name: 'Old', kind: 'game', rounds: [], players: [] };
    // The tournaments.kind COLUMN is CHECK-constrained to 'casual'/'official' —
    // it can never actually hold 'tournament'/'game'. The domain kind lives in
    // props.kind and wins, mirroring get_game_tournament's
    // COALESCE(props->>'kind', column).
    const out = applyTournamentRow(t, {
      id: 't1', name: 'New Name', kind: 'casual', props: { kind: 'tournament' },
    });
    expect(out.name).toBe('New Name');
    expect(out.kind).toBe('tournament');

    // No domain kind in props (e.g. an official-mode row, which has empty
    // props) — the column value surfaces as the fallback.
    const out2 = applyTournamentRow(t, { id: 't1', name: 'New Name', kind: 'official', props: {} });
    expect(out2.kind).toBe('official');
  });

  test('never lets props/columns stomp rounds/players', () => {
    const t = {
      id: 't1',
      rounds: [{ id: 'r0', scores: { p1: { 1: 4 } } }],
      players: [{ id: 'p1' }],
    };
    const out = applyTournamentRow(t, {
      id: 't1', props: { rounds: ['bogus'], players: ['bogus'] }, current_round: 0,
    });
    expect(out.rounds).toEqual(t.rounds);
    expect(out.players).toEqual(t.players);
  });
});

describe('ensureRealtimeForTournament / stopRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readLocal.mockResolvedValue({ id: 't1', kind: 'game', rounds: [], players: [] });
    saveLocal.mockResolvedValue();
    syncQueue.all.mockResolvedValue([]);
  });

  afterEach(() => {
    stopRealtime();
  });

  test('subscribes a channel named game-<id> with eight postgres_changes bindings plus a presence binding', async () => {
    await ensureRealtimeForTournament('t1');
    expect(supabase.channel).toHaveBeenCalledWith('game-t1');
    const channel = supabase.channel.mock.results[0].value;
    expect(channel.on).toHaveBeenCalledTimes(9);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    const postgresCalls = channel.on.mock.calls.filter(([type]) => type === 'postgres_changes');
    const presenceCalls = channel.on.mock.calls.filter(([type]) => type === 'presence');
    expect(presenceCalls).toHaveLength(1);
    const tables = postgresCalls.map(([, cfg]) => cfg.table);
    expect(tables.sort()).toEqual([
      'game_players', 'game_round_notes', 'game_rounds', 'game_score_entries',
      'game_score_resolutions', 'game_scores', 'game_shot_details', 'tournaments',
    ].sort());
  });

  test('game_* bindings filter on tournament_id=eq.<id>; tournaments binding filters on id=eq.<id>', async () => {
    await ensureRealtimeForTournament('t1');
    const channel = supabase.channel.mock.results[0].value;
    const postgresCalls = channel.on.mock.calls.filter(([type]) => type === 'postgres_changes');
    for (const [, cfg] of postgresCalls) {
      if (cfg.table === 'tournaments') {
        expect(cfg.filter).toBe('id=eq.t1');
      } else {
        expect(cfg.filter).toBe('tournament_id=eq.t1');
      }
    }
  });

  test('is idempotent: calling again with the same id does not open a new channel', async () => {
    await ensureRealtimeForTournament('t1');
    await ensureRealtimeForTournament('t1');
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  test('switches channel when id changes: removes the old channel and subscribes a new one', async () => {
    await ensureRealtimeForTournament('t1');
    const firstChannel = supabase.channel.mock.results[0].value;
    readLocal.mockResolvedValue({ id: 't2', kind: 'game', rounds: [], players: [] });
    await ensureRealtimeForTournament('t2');
    expect(supabase.removeChannel).toHaveBeenCalledWith(firstChannel);
    expect(supabase.channel).toHaveBeenCalledWith('game-t2');
    expect(supabase.channel).toHaveBeenCalledTimes(2);
  });

  test('no-op for a null id, and tears down any existing channel', async () => {
    await ensureRealtimeForTournament('t1');
    const firstChannel = supabase.channel.mock.results[0].value;
    await ensureRealtimeForTournament(null);
    expect(supabase.removeChannel).toHaveBeenCalledWith(firstChannel);
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  test('skips subscribing for an official-kind tournament', async () => {
    readLocal.mockResolvedValue({ id: 't1', kind: 'official', rounds: [], players: [] });
    await ensureRealtimeForTournament('t1');
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  test('stopRealtime removes the current channel and clears state so a later ensure re-subscribes', async () => {
    await ensureRealtimeForTournament('t1');
    const firstChannel = supabase.channel.mock.results[0].value;
    stopRealtime();
    expect(supabase.removeChannel).toHaveBeenCalledWith(firstChannel);
    await ensureRealtimeForTournament('t1');
    expect(supabase.channel).toHaveBeenCalledTimes(2);
  });

  test('stopRealtime with no active channel is a no-op', () => {
    stopRealtime();
    expect(supabase.removeChannel).not.toHaveBeenCalled();
  });

  test('row handler patches the cache, re-applies pending mutations, restores meId, preserves score conflicts, and saves', async () => {
    const cached = {
      id: 't1', kind: 'game', meId: 'p9', rounds: [{ id: 'r1', scores: {}, scoreConflicts: { p1: { 1: { candidates: [] } } } }], players: [],
    };
    readLocal.mockResolvedValue(cached);
    const pendingEntry = { id: 'e1', tournamentId: 't1', mutation: { type: 'score.set' } };
    syncQueue.all.mockResolvedValue([pendingEntry, { id: 'e2', tournamentId: 'other', mutation: {} }]);

    await ensureRealtimeForTournament('t1');
    const channel = supabase.channel.mock.results[0].value;
    const scoreHandlerCall = channel.on.mock.calls.find(([, cfg]) => cfg.table === 'game_scores');
    const handler = scoreHandlerCall[2];

    await handler({ new: { round_id: 'r1', player_id: 'p1', hole: 1, strokes: 5 } });

    expect(applyPendingMutations).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      [pendingEntry],
    );
    expect(preserveLocalConflictState).toHaveBeenCalled();
    expect(saveLocal).toHaveBeenCalledTimes(1);
    const [savedArg] = saveLocal.mock.calls[0];
    expect(savedArg.meId).toBe('p9');
  });

  test('a DELETE event routes through payload.old (PK-only) and removes the round rather than resurrecting a stub', async () => {
    const cached = {
      id: 't1', kind: 'game', rounds: [{ id: 'r1', holes: [{ number: 1 }], scores: {} }], players: [],
    };
    readLocal.mockResolvedValue(cached);
    // Pass-through so the patched (round removed) object is what reaches saveLocal.
    applyPendingMutations.mockImplementation((t) => t);
    preserveLocalConflictState.mockImplementation((target) => target);

    await ensureRealtimeForTournament('t1');
    const channel = supabase.channel.mock.results[0].value;
    const roundHandlerCall = channel.on.mock.calls.find(([, cfg]) => cfg.table === 'game_rounds');
    const handler = roundHandlerCall[2];

    await handler({ eventType: 'DELETE', old: { tournament_id: 't1', id: 'r1' }, new: {} });

    expect(saveLocal).toHaveBeenCalledTimes(1);
    const [savedArg] = saveLocal.mock.calls[0];
    expect(savedArg.rounds).toEqual([]);
  });

  test('row handler no-ops when readLocal returns null (tournament not cached locally)', async () => {
    await ensureRealtimeForTournament('t1');
    const channel = supabase.channel.mock.results[0].value;
    const scoreHandlerCall = channel.on.mock.calls.find(([, cfg]) => cfg.table === 'game_scores');
    const handler = scoreHandlerCall[2];

    readLocal.mockResolvedValue(null);
    await handler({ new: { round_id: 'r1', player_id: 'p1', hole: 1, strokes: 5 } });

    expect(saveLocal).not.toHaveBeenCalled();
  });

  // Save-then-enqueue race, bounded settle. mutate() saveLocal's BEFORE it
  // enqueues, so a score entered right as this handler runs can be in local
  // state but absent from the handler's first queue snapshot — a save computed
  // from that stale snapshot would erase it. The handler must re-snapshot the
  // queue after saving and recompute (same bounded loop as syncWorker's
  // post-drain reconcile and tournamentStore._overlayAndSave) so the final
  // saved blob includes the late score. Kept last in this block: it installs a
  // custom applyPendingMutations implementation that must not leak into the
  // call-args assertions above.
  test('a mutation enqueued after the first queue snapshot still lands in the saved blob (save-then-enqueue race)', async () => {
    const cached = { id: 't1', kind: 'game', rounds: [{ id: 'r1', scores: {} }], players: [] };
    readLocal.mockResolvedValue(cached);
    const lateEntry = {
      id: 'late-1', tournamentId: 't1',
      mutation: { type: 'score.set', roundId: 'r1', playerId: 'p2', hole: 1, value: 5 },
    };
    let queueReads = 0;
    syncQueue.all.mockImplementation(() => {
      queueReads += 1;
      // First read (the handler's initial snapshot) misses the late entry;
      // every subsequent read sees it — the race the settle loop must close.
      return Promise.resolve(queueReads === 1 ? [] : [lateEntry]);
    });
    // Real-ish overlay: actually apply score.set entries so the late p2 score
    // can be asserted in the saved blob.
    applyPendingMutations.mockImplementation((t, entries) => {
      const nextT = JSON.parse(JSON.stringify(t));
      for (const e of entries) {
        const m = e.mutation;
        if (m.type === 'score.set') {
          const round = nextT.rounds.find((r) => r.id === m.roundId);
          round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}), [m.hole]: m.value };
        }
      }
      return nextT;
    });
    preserveLocalConflictState.mockImplementation((target) => target);

    await ensureRealtimeForTournament('t1');
    const channel = supabase.channel.mock.results[0].value;
    const scoreHandlerCall = channel.on.mock.calls.find(([, cfg]) => cfg.table === 'game_scores');
    const handler = scoreHandlerCall[2];

    // A realtime row for a DIFFERENT cell (p1) arrives while p2's score.set is
    // mid-flight (saved locally, not yet in the first queue snapshot).
    await handler({ new: { round_id: 'r1', player_id: 'p1', hole: 1, strokes: 4 } });

    // The settle loop re-read the queue after saving (>= 2 reads) and the final
    // saved blob includes the late p2 score — the row's own p1 edit too.
    expect(queueReads).toBeGreaterThanOrEqual(2);
    const finalSave = saveLocal.mock.calls[saveLocal.mock.calls.length - 1][0];
    expect(finalSave.rounds[0].scores.p2[1]).toBe(5);
    expect(finalSave.rounds[0].scores.p1[1]).toBe(4);
  });
});
