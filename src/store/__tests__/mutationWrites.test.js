// mutationWrites.js executes one queued mutation against the server via the
// Task 6 repository (tournamentRepo). Only tournamentRepo is mocked here —
// every branch asserts the exact call args it produces. score.set and
// conflict.resolve route through repo.submitScore/repo.resolveScore (Task 7)
// and never raise a conflict of their own — conflict state is derived from
// synced per-author entries (store/scoreEntries.js) instead; see
// mutationWrites.scoreEntries.test.js for the author/resolvedBy plumbing.
jest.mock('../tournamentRepo');

// eslint-disable-next-line import/first
import * as repo from '../tournamentRepo';
// eslint-disable-next-line import/first
import { executeMutation } from '../mutationWrites';

const TID = 'tourn-1';

function entry(mutation, overrides = {}) {
  return { tournamentId: TID, mutation, path: 'irrelevant', ts: 1000, ...overrides };
}

function baseTournament(overrides = {}) {
  return {
    id: TID,
    finishedAt: null,
    settings: { fixedTeams: true, manualTeams: false, scoringMode: 'stableford' },
    players: [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob', user_id: 'user-2' },
    ],
    rounds: [
      {
        id: 'r1',
        pairs: [['p1', 'p2'], ['p3', 'p4']],
        scoringMode: 'pairsmatchplay',
        bestBallValue: 2,
        worstBallValue: 1,
        playerHandicaps: { p1: 12, p2: 8 },
        playerIndexes: { p1: 14, p2: 9 },
        revealed: false,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('score.set', () => {
  const mutation = {
    type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 5, value: 4, authorId: 'p1',
  };

  test('writes via repo.submitScore with exact args, including authorId, and never raises a conflict', async () => {
    repo.submitScore.mockResolvedValue({ status: 'agreed' });
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.submitScore).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 5, authorId: 'p1', strokes: 4,
    });
    expect(result).toEqual({ conflict: null });
  });

  test('score clear (value null) passes strokes null through as a tombstone', async () => {
    repo.submitScore.mockResolvedValue({ status: 'agreed' });
    const clear = {
      type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 5, value: null, authorId: 'p1',
    };
    const result = await executeMutation(entry(clear), baseTournament());
    expect(repo.submitScore).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 5, authorId: 'p1', strokes: null,
    });
    expect(result).toEqual({ conflict: null });
  });
});

describe('conflict.resolve', () => {
  test('writes via repo.resolveScore with resolvedBy and never raises a conflict', async () => {
    repo.resolveScore.mockResolvedValue();
    const mutation = {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 5, value: 4, resolvedBy: 'p1',
    };
    const result = await executeMutation(entry(mutation, { ts: 1 }), baseTournament());
    expect(repo.resolveScore).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 5, value: 4, resolvedBy: 'p1',
    });
    expect(result).toEqual({ conflict: null });
  });

  test('resolving to a cleared cell (value null) passes value null through as a tombstone', async () => {
    repo.resolveScore.mockResolvedValue();
    const mutation = {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 5, value: null, resolvedBy: 'p1',
    };
    const result = await executeMutation(entry(mutation, { ts: 1 }), baseTournament());
    expect(repo.resolveScore).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 5, value: null, resolvedBy: 'p1',
    });
    expect(result).toEqual({ conflict: null });
  });
});

describe('shot.set', () => {
  test('writes via repo.setShotDetail', async () => {
    const mutation = {
      type: 'shot.set', roundId: 'r1', playerId: 'p1', hole: 3, detail: { putts: 2 },
    };
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.setShotDetail).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 3, detail: { putts: 2 },
    });
    expect(result).toEqual({ conflict: null });
  });
});

describe('note.set', () => {
  test('hole-scoped note uses String(hole) as holeKey', async () => {
    const mutation = {
      type: 'note.set', roundId: 'r1', scope: 'hole', hole: 7, text: 'wet bunker',
    };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.setNote).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', holeKey: '7', note: 'wet bunker',
    });
  });

  test('round-scoped note uses holeKey "round"', async () => {
    const mutation = {
      type: 'note.set', roundId: 'r1', scope: 'round', text: 'great day',
    };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.setNote).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', holeKey: 'round', note: 'great day',
    });
  });
});

describe('pairs.set', () => {
  test('patches round pairs AND revealed from the local round (setting pairs reveals them locally)', async () => {
    const mutation = { type: 'pairs.set', roundId: 'r1', pairs: [['p1', 'p3'], ['p2', 'p4']] };
    const local = baseTournament();
    // Post-apply local state: applyToTournament set pairs and revealed=true.
    local.rounds[0].pairs = [['p1', 'p3'], ['p2', 'p4']];
    local.rounds[0].revealed = true;
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      pairs: [['p1', 'p3'], ['p2', 'p4']],
      revealed: true,
    });
  });

  test('fixed-teams propagation (reveal: false) preserves the unrevealed state on the server', async () => {
    const mutation = {
      type: 'pairs.set', roundId: 'r1', pairs: [['p1', 'p3'], ['p2', 'p4']], reveal: false,
    };
    const local = baseTournament();
    // Post-apply local state: pairs changed, revealed untouched (still false).
    local.rounds[0].pairs = [['p1', 'p3'], ['p2', 'p4']];
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      pairs: [['p1', 'p3'], ['p2', 'p4']],
      revealed: false,
    });
  });

  test('skips the write when the local round no longer exists', async () => {
    const mutation = { type: 'pairs.set', roundId: 'rX', pairs: [['p1', 'p3']] };
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.patchRound).not.toHaveBeenCalled();
    expect(result).toEqual({ conflict: null });
  });
});

describe('round.setScoringMode', () => {
  test('patches scoringMode and pairs from the local round', async () => {
    const mutation = { type: 'round.setScoringMode', roundId: 'r1', scoringMode: 'scramble4' };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      scoringMode: 'pairsmatchplay',
      pairs: [['p1', 'p2'], ['p3', 'p4']],
    });
  });

  test('missing local round -> skip', async () => {
    const mutation = { type: 'round.setScoringMode', roundId: 'rX', scoringMode: 'scramble4' };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.patchRound).not.toHaveBeenCalled();
  });
});

describe('round.setBestBallValues', () => {
  test('patches bestBallValue/worstBallValue from the local round', async () => {
    const mutation = { type: 'round.setBestBallValues', roundId: 'r1', bestBallValue: 3, worstBallValue: 2 };
    const local = baseTournament();
    local.rounds[0].bestBallValue = 3;
    local.rounds[0].worstBallValue = 2;
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { bestBallValue: 3, worstBallValue: 2 });
  });
});

describe('tournament.setTeamSettings', () => {
  test('patches settings.fixedTeams/manualTeams from local settings', async () => {
    const mutation = { type: 'tournament.setTeamSettings', fixedTeams: false, manualTeams: true };
    const local = baseTournament({ settings: { fixedTeams: false, manualTeams: true, scoringMode: 'stableford' } });
    await executeMutation(entry(mutation), local);
    expect(repo.patchTournament).toHaveBeenCalledWith(TID, {
      settings: { fixedTeams: false, manualTeams: true },
    });
  });
});

describe('handicap.set', () => {
  test('patches playerHandicaps AND the manualHandicaps flag for the single player from the local round', async () => {
    const mutation = {
      type: 'handicap.set', roundId: 'r1', playerId: 'p1', handicap: 15,
    };
    const local = baseTournament();
    // Post-apply local state: applyToTournament set the handicap and stamped
    // manualHandicaps[p1] = true (load-bearing for recomputeRoundPlayingHandicaps).
    local.rounds[0].playerHandicaps = { p1: 15, p2: 8 };
    local.rounds[0].manualHandicaps = { p1: true };
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p1: 15 },
      manualHandicaps: { p1: true },
    });
  });

  test('writes manualHandicaps null when the local round carries no flag (defensive)', async () => {
    const mutation = {
      type: 'handicap.set', roundId: 'r1', playerId: 'p1', handicap: 15,
    };
    const local = baseTournament();
    local.rounds[0].playerHandicaps = { p1: 15, p2: 8 };
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p1: 15 },
      manualHandicaps: { p1: null },
    });
  });
});

describe('index.set', () => {
  // applyToTournament's index.set touches ONLY playerIndexes — the recomputed
  // playing handicap rides its own handicap.set mutation, and manualHandicaps
  // is untouched. toHaveBeenCalledWith asserts the FULL patch shape, so any
  // extra or missing field fails here.
  test('patches ONLY playerIndexes for the single player from the local round', async () => {
    const mutation = {
      type: 'index.set', roundId: 'r1', playerId: 'p1', index: 16,
    };
    const local = baseTournament();
    local.rounds[0].playerIndexes = { p1: 16, p2: 9 };
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledTimes(1);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerIndexes: { p1: 16 },
    });
  });
});

describe('round.remove', () => {
  test('deletes the round via repo.deleteRound', async () => {
    const mutation = { type: 'round.remove', roundId: 'r1' };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.deleteRound).toHaveBeenCalledWith(TID, 'r1');
  });
});

describe('tournament.addPlayer', () => {
  test('upserts the player at its local index and patches each roundPatch', async () => {
    const newPlayer = { id: 'p3', name: 'Cara' };
    const local = baseTournament();
    local.players = [...local.players, newPlayer];
    local.rounds[0].playerHandicaps = { p1: 12, p2: 8, p3: 10 };
    local.rounds[0].pairs = [['p1', 'p3'], ['p2', 'p4']];

    const mutation = {
      type: 'tournament.addPlayer',
      player: newPlayer,
      roundPatches: [{ roundId: 'r1', playerHandicap: 10, pairs: [['p1', 'p3'], ['p2', 'p4']] }],
      nextScoringMode: 'scramble4',
    };
    await executeMutation(entry(mutation), local);

    expect(repo.upsertPlayer).toHaveBeenCalledWith(TID, newPlayer, 2);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p3: 10 },
      pairs: [['p1', 'p3'], ['p2', 'p4']],
    });
    expect(repo.patchTournament).toHaveBeenCalledWith(TID, {
      settings: { scoringMode: 'scramble4' },
    });
  });

  test('omits scoringMode from the roundPatch write unless clearScoringMode is set, and skips patchTournament without nextScoringMode', async () => {
    const newPlayer = { id: 'p3', name: 'Cara' };
    const local = baseTournament();
    local.players = [...local.players, newPlayer];
    local.rounds[0].playerHandicaps = { p1: 12, p2: 8, p3: 10 };

    const mutation = {
      type: 'tournament.addPlayer',
      player: newPlayer,
      roundPatches: [{ roundId: 'r1', playerHandicap: 10 }],
    };
    await executeMutation(entry(mutation), local);

    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p3: 10 },
    });
    expect(repo.patchTournament).not.toHaveBeenCalled();
  });

  test('skips upsertPlayer and patchRound writes for rounds/players missing from local (defensive)', async () => {
    const newPlayer = { id: 'pX', name: 'Ghost' };
    const local = baseTournament(); // does not contain pX or round rX
    const mutation = {
      type: 'tournament.addPlayer',
      player: newPlayer,
      roundPatches: [{ roundId: 'rX', playerHandicap: 10 }],
    };
    const result = await executeMutation(entry(mutation), local);
    expect(repo.upsertPlayer).not.toHaveBeenCalled();
    expect(repo.patchRound).not.toHaveBeenCalled();
    expect(result).toEqual({ conflict: null });
  });
});

describe('tournament.removePlayer', () => {
  test('deletes the player, clears each roundPatch, nulls the removed player\'s per-round keys, and patches pairs/scoringMode', async () => {
    const local = baseTournament();
    local.players = local.players.filter((p) => p.id !== 'p2');
    delete local.rounds[0].scoringMode;
    local.rounds[0].pairs = [['p1'], ['p3', 'p4']];

    const mutation = {
      type: 'tournament.removePlayer',
      playerId: 'p2',
      roundPatches: [{ roundId: 'r1', pairs: [['p1'], ['p3', 'p4']], clearScoringMode: true }],
    };
    await executeMutation(entry(mutation), local);

    expect(repo.deletePlayer).toHaveBeenCalledWith(TID, 'p2');
    expect(repo.clearPlayerRound).toHaveBeenCalledWith(TID, 'r1', 'p2');
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p2: null },
      playerIndexes: { p2: null },
      manualHandicaps: { p2: null },
      pairs: [['p1'], ['p3', 'p4']],
      scoringMode: null,
    });
  });

  test('still patches the removed player\'s per-round keys to null when the roundPatch has no pairs/clearScoringMode', async () => {
    const local = baseTournament();
    local.players = local.players.filter((p) => p.id !== 'p2');
    const mutation = {
      type: 'tournament.removePlayer',
      playerId: 'p2',
      roundPatches: [{ roundId: 'r1' }],
    };
    await executeMutation(entry(mutation), local);
    expect(repo.clearPlayerRound).toHaveBeenCalledWith(TID, 'r1', 'p2');
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p2: null },
      playerIndexes: { p2: null },
      manualHandicaps: { p2: null },
    });
  });

  test('still clears the round even when the local round no longer exists (patchRound skipped)', async () => {
    const mutation = {
      type: 'tournament.removePlayer',
      playerId: 'p2',
      roundPatches: [{ roundId: 'rX', pairs: [['p1']] }],
    };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.clearPlayerRound).toHaveBeenCalledWith(TID, 'rX', 'p2');
    expect(repo.patchRound).not.toHaveBeenCalled();
  });
});

describe('tournament.setFinished', () => {
  test('patches finishedAt from local state', async () => {
    const mutation = { type: 'tournament.setFinished', finishedAt: '2026-07-11T00:00:00.000Z' };
    const local = baseTournament({ finishedAt: '2026-07-11T00:00:00.000Z' });
    await executeMutation(entry(mutation), local);
    expect(repo.patchTournament).toHaveBeenCalledWith(TID, { finishedAt: '2026-07-11T00:00:00.000Z' });
  });

  test('null finishedAt reopens the tournament', async () => {
    const mutation = { type: 'tournament.setFinished', finishedAt: null };
    await executeMutation(entry(mutation), baseTournament({ finishedAt: null }));
    expect(repo.patchTournament).toHaveBeenCalledWith(TID, { finishedAt: null });
  });
});

describe('tournament.claimPlayer', () => {
  test('upserts the local player object (carrying user_id) at its current index', async () => {
    const mutation = { type: 'tournament.claimPlayer', playerId: 'p2', userId: 'user-2' };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.upsertPlayer).toHaveBeenCalledWith(TID, { id: 'p2', name: 'Bob', user_id: 'user-2' }, 1);
  });

  test('skips when the player no longer exists locally', async () => {
    const mutation = { type: 'tournament.claimPlayer', playerId: 'pX', userId: 'user-9' };
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.upsertPlayer).not.toHaveBeenCalled();
    expect(result).toEqual({ conflict: null });
  });
});

describe('tournament.setScoringMode', () => {
  test('patches tournament settings and each roundPatch (pairs conditional, scoringMode always cleared)', async () => {
    const local = baseTournament();
    delete local.rounds[0].scoringMode;
    local.rounds[0].pairs = [['p1', 'p3'], ['p2', 'p4']];

    const mutation = {
      type: 'tournament.setScoringMode',
      scoringMode: 'scramble4',
      roundPatches: [{ roundId: 'r1', pairs: [['p1', 'p3'], ['p2', 'p4']] }],
    };
    await executeMutation(entry(mutation), local);

    expect(repo.patchTournament).toHaveBeenCalledWith(TID, { settings: { scoringMode: 'scramble4' } });
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      scoringMode: null,
      pairs: [['p1', 'p3'], ['p2', 'p4']],
    });
  });

  test('roundPatch without pairs omits pairs from the write', async () => {
    const local = baseTournament();
    delete local.rounds[0].scoringMode;
    const mutation = {
      type: 'tournament.setScoringMode',
      scoringMode: 'stableford',
      roundPatches: [{ roundId: 'r1' }],
    };
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { scoringMode: null });
  });
});

describe('tournament.advanceRound', () => {
  test('calls repo.advanceRound with the tournament id and round index', async () => {
    const mutation = { type: 'tournament.advanceRound', roundIndex: 2 };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.advanceRound).toHaveBeenCalledWith(TID, 2);
  });
});

describe('round.reveal', () => {
  test('patches revealed:true without pairs when none are carried', async () => {
    const mutation = { type: 'round.reveal', roundId: 'r1' };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { revealed: true });
  });

  test('patches revealed:true and pairs from the mutation (not the local round) when carried', async () => {
    const mutation = { type: 'round.reveal', roundId: 'r1', pairs: [['p1', 'p4'], ['p2', 'p3']] };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      revealed: true,
      pairs: [['p1', 'p4'], ['p2', 'p3']],
    });
  });
});

describe('tournament.updateProfile', () => {
  test('patches the tournament with the mutation patch verbatim', async () => {
    const mutation = { type: 'tournament.updateProfile', patch: { name: 'New Name', settings: { manualTeams: true } } };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.patchTournament).toHaveBeenCalledWith(TID, { name: 'New Name', settings: { manualTeams: true } });
  });
});

describe('tournament.create', () => {
  test('creates the tournament via repo.createTournament with the mutation payload', async () => {
    const tournamentPayload = { id: 'newt', name: 'New', kind: 'casual', players: [], rounds: [] };
    const mutation = { type: 'tournament.create', tournament: tournamentPayload };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.createTournament).toHaveBeenCalledWith(tournamentPayload);
  });
});

describe('round.resetContent', () => {
  test('writes the full scores/notes grid cell by cell, plus the resetHistory patch', async () => {
    const local = baseTournament({
      rounds: [{
        id: 'r1',
        holes: [{ number: 1 }, { number: 2 }],
        scores: { p1: { 1: 4 }, p2: {} },
        notes: { round: 'Windy', hole: { 2: 'GIR miss' } },
        resetHistory: [{ at: '2026-01-01T00:00:00Z' }],
      }],
    });
    const mutation = { type: 'round.resetContent', roundId: 'r1', scores: {}, notes: {}, resetHistory: [] };

    await executeMutation(entry(mutation), local);

    // Every (player, hole) cell in the round is written — cleared cells go
    // through as strokes: null (tombstone), matching setScore's contract.
    expect(repo.setScore).toHaveBeenCalledWith({ tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 1, strokes: 4 });
    expect(repo.setScore).toHaveBeenCalledWith({ tournamentId: TID, roundId: 'r1', playerId: 'p2', hole: 1, strokes: null });
    expect(repo.setScore).toHaveBeenCalledWith({ tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 2, strokes: null });
    expect(repo.setNote).toHaveBeenCalledWith({ tournamentId: TID, roundId: 'r1', holeKey: 'round', note: 'Windy' });
    expect(repo.setNote).toHaveBeenCalledWith({ tournamentId: TID, roundId: 'r1', holeKey: '1', note: null });
    expect(repo.setNote).toHaveBeenCalledWith({ tournamentId: TID, roundId: 'r1', holeKey: '2', note: 'GIR miss' });
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { resetHistory: [{ at: '2026-01-01T00:00:00Z' }] });
  });

  test('is a no-op when the round no longer exists locally', async () => {
    const mutation = { type: 'round.resetContent', roundId: 'gone', scores: {}, notes: {}, resetHistory: [] };
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.setScore).not.toHaveBeenCalled();
    expect(result).toEqual({ conflict: null });
  });
});

describe('round.upsert', () => {
  // Regression fix (review-mandated): EditTournamentScreen/PlayersScreen fire
  // this mutation from a debounced bulk-save that loops over EVERY round with
  // that screen's local (deliberately-not-refreshed) round state. A raw
  // full-body upsert on an EXISTING round would silently revert whatever a
  // concurrent device wrote via pairs.set / round.reveal /
  // round.setScoringMode / round.setBestBallValues / handicap.set / index.set
  // in the meantime. So an EXISTING round now gets patched with ONLY the
  // fields these screens actually own; a genuinely NEW round (isNew: true,
  // e.g. EditTournamentScreen's addRound) still gets the full-body upsert
  // since a brand-new row can't clobber anything.

  test('brand-new round (isNew: true) still upserts the full body via repo.upsertRound', async () => {
    const round = { id: 'r2', courseName: 'Second Course', holes: [] };
    const mutation = {
      type: 'round.upsert', roundId: 'r2', roundIndex: 1, round, isNew: true,
    };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.upsertRound).toHaveBeenCalledWith(TID, 1, round);
    expect(repo.patchRound).not.toHaveBeenCalled();
  });

  test('existing round (no isNew flag) patches ONLY the owned structural fields, never the derived/dedicated-mutation fields', async () => {
    const round = {
      id: 'r1',
      courseName: 'Updated Course',
      courseId: 'course-9',
      holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
      tees: [{ label: 'Blue' }],
      notes: { round: 'Wet today', hole: {} },
      playerTees: { p1: { label: 'Blue' } },
      // Every one of these has its own dedicated mutation type and must NEVER
      // ride along in this patch:
      pairs: [['p1', 'p3'], ['p2', 'p4']],
      revealed: true,
      scoringMode: 'bestball',
      bestBallValue: 3,
      worstBallValue: 2,
      playerHandicaps: { p1: 5 },
      playerIndexes: { p1: 10 },
      manualHandicaps: { p1: true },
    };
    const mutation = { type: 'round.upsert', roundId: 'r1', roundIndex: 0, round };
    await executeMutation(entry(mutation), baseTournament());

    expect(repo.upsertRound).not.toHaveBeenCalled();
    expect(repo.patchRound).toHaveBeenCalledTimes(1);
    const [tid, roundId, patch] = repo.patchRound.mock.calls[0];
    expect(tid).toBe(TID);
    expect(roundId).toBe('r1');
    expect(patch).toEqual({
      courseName: 'Updated Course',
      courseId: 'course-9',
      holes: round.holes,
      tees: [{ label: 'Blue' }],
      playerTees: { p1: { label: 'Blue' } },
    });
    for (const forbidden of [
      // notes is read-stripped from game_rounds.body by get_game_tournament
      // (it's reassembled from game_round_notes instead) — patching it here
      // would be a dead write, so round.upsert must never carry it. Editors
      // route note edits through their own note.set mutation instead (Task
      // 13.2 fix).
      'notes',
      'pairs', 'revealed', 'scoringMode', 'bestBallValue', 'worstBallValue',
      'playerHandicaps', 'playerIndexes', 'manualHandicaps',
    ]) {
      expect(patch).not.toHaveProperty(forbidden);
    }
  });

  test('existing round with isNew: false explicitly also patches owned fields only', async () => {
    const round = {
      id: 'r1', courseName: 'X', holes: [], pairs: [['p1', 'p2']],
    };
    const mutation = {
      type: 'round.upsert', roundId: 'r1', roundIndex: 0, round, isNew: false,
    };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.upsertRound).not.toHaveBeenCalled();
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { courseName: 'X', holes: [] });
  });

  test('existing round whose payload carries no owned fields skips the write entirely', async () => {
    const round = { id: 'r1', pairs: [['p1', 'p2']], revealed: true };
    const mutation = { type: 'round.upsert', roundId: 'r1', roundIndex: 0, round };
    await executeMutation(entry(mutation), baseTournament());
    expect(repo.upsertRound).not.toHaveBeenCalled();
    expect(repo.patchRound).not.toHaveBeenCalled();
  });

  // Task 13: the round-holes editor (CourseEditorScreen opened WITHOUT a
  // courseId, from SetupScreen/EditTournamentScreen) writes round.holes/tees
  // straight into round.upsert with no validation of its own — a different
  // path than the course-library save-guard (canSaveCourse) added for the
  // course-editing screens. This is the actual Supabase persist boundary for
  // round.upsert, so it's where the SAME SI/tee-label rules are enforced
  // (via the shared roundHolesArePersistable helper) regardless of which
  // screen queued the mutation.
  describe('SI validation (Task 13)', () => {
    const badHoles = [{ number: 1, par: 4, strokeIndex: 1 }]; // 17 SI missing

    test('existing round with invalid SI: holes/tees are held out of the patch, but other owned fields still persist', async () => {
      const round = {
        id: 'r1', courseName: 'Updated Course', holes: badHoles, tees: [{ label: 'Blue' }],
      };
      const mutation = { type: 'round.upsert', roundId: 'r1', roundIndex: 0, round };
      await executeMutation(entry(mutation), baseTournament());
      expect(repo.upsertRound).not.toHaveBeenCalled();
      expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { courseName: 'Updated Course' });
    });

    test('existing round with duplicate tee labels (clean SI) also holds holes/tees out of the patch', async () => {
      const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
      const round = {
        id: 'r1',
        courseName: 'Updated Course',
        holes,
        tees: [{ label: 'Blue' }, { label: 'blue ' }],
      };
      const mutation = { type: 'round.upsert', roundId: 'r1', roundIndex: 0, round };
      await executeMutation(entry(mutation), baseTournament());
      expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { courseName: 'Updated Course' });
    });

    test('existing round whose ONLY owned-field changes are the invalid holes/tees skips the write entirely (nothing left to patch)', async () => {
      const round = { id: 'r1', holes: badHoles, tees: [] };
      const mutation = { type: 'round.upsert', roundId: 'r1', roundIndex: 0, round };
      await executeMutation(entry(mutation), baseTournament());
      expect(repo.patchRound).not.toHaveBeenCalled();
    });

    test('brand-new round (isNew: true) with invalid SI is NOT upserted at all — held out entirely, retried once valid', async () => {
      const round = { id: 'r2', courseName: 'Second Course', holes: badHoles };
      const mutation = {
        type: 'round.upsert', roundId: 'r2', roundIndex: 1, round, isNew: true,
      };
      const result = await executeMutation(entry(mutation), baseTournament());
      expect(repo.upsertRound).not.toHaveBeenCalled();
      expect(repo.patchRound).not.toHaveBeenCalled();
      expect(result).toEqual({ conflict: null });
    });

    test('brand-new round (isNew: true) with valid SI upserts normally (regression: valid rounds are unaffected)', async () => {
      const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
      const round = { id: 'r2', courseName: 'Second Course', holes };
      const mutation = {
        type: 'round.upsert', roundId: 'r2', roundIndex: 1, round, isNew: true,
      };
      await executeMutation(entry(mutation), baseTournament());
      expect(repo.upsertRound).toHaveBeenCalledWith(TID, 1, round);
    });
  });
});

describe('tournament.updatePlayer', () => {
  test('upserts the local (post-mutation) player object at its current index', async () => {
    const local = baseTournament();
    local.players[0] = { id: 'p1', name: 'Alice', handicap: 8 };
    const mutation = { type: 'tournament.updatePlayer', playerId: 'p1', patch: { handicap: 8 } };
    await executeMutation(entry(mutation), local);
    expect(repo.upsertPlayer).toHaveBeenCalledWith(TID, { id: 'p1', name: 'Alice', handicap: 8 }, 0);
  });

  test('skips when the player no longer exists locally', async () => {
    const mutation = { type: 'tournament.updatePlayer', playerId: 'pX', patch: { handicap: 1 } };
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.upsertPlayer).not.toHaveBeenCalled();
    expect(result).toEqual({ conflict: null });
  });
});

describe('unknown mutation types', () => {
  test('throws, matching metaPathFor\'s default contract', async () => {
    await expect(executeMutation(entry({ type: 'not.a.real.type' }), baseTournament()))
      .rejects.toThrow('unknown mutation type: not.a.real.type');
  });
});
