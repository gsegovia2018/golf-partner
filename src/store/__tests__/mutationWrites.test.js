// mutationWrites.js executes one queued mutation against the server via the
// Task 6 repository (tournamentRepo). Only tournamentRepo is mocked here —
// every branch asserts the exact call args it produces, plus the four
// score.set conflict-detection cases.
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
    type: 'score.set', roundId: 'r1', playerId: 'p1', hole: 5, value: 4,
  };

  test('writes via repo.setScore with exact args', async () => {
    repo.setScore.mockResolvedValue({ previousStrokes: null, previousUpdatedAt: null });
    const result = await executeMutation(entry(mutation), baseTournament());
    expect(repo.setScore).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 5, strokes: 4,
    });
    expect(result).toEqual({ conflict: null });
  });

  test('no previous value -> no conflict', async () => {
    repo.setScore.mockResolvedValue({ previousStrokes: null, previousUpdatedAt: null });
    const result = await executeMutation(entry(mutation, { ts: 1000 }), baseTournament());
    expect(result).toEqual({ conflict: null });
  });

  test('previous value same as written -> no conflict', async () => {
    repo.setScore.mockResolvedValue({
      previousStrokes: 4, previousUpdatedAt: new Date(2000).toISOString(),
    });
    const result = await executeMutation(entry(mutation, { ts: 1000 }), baseTournament());
    expect(result).toEqual({ conflict: null });
  });

  test('previous value different and newer than entry.ts -> conflict', async () => {
    repo.setScore.mockResolvedValue({
      previousStrokes: 6, previousUpdatedAt: new Date(2000).toISOString(),
    });
    const result = await executeMutation(entry(mutation, { ts: 1000 }), baseTournament());
    expect(result).toEqual({
      conflict: {
        roundId: 'r1', playerId: 'p1', hole: 5, mine: 4, theirs: 6,
      },
    });
  });

  test('previous value different but OLDER than entry.ts -> no conflict (normal overwrite)', async () => {
    repo.setScore.mockResolvedValue({
      previousStrokes: 6, previousUpdatedAt: new Date(500).toISOString(),
    });
    const result = await executeMutation(entry(mutation, { ts: 1000 }), baseTournament());
    expect(result).toEqual({ conflict: null });
  });
});

describe('conflict.resolve', () => {
  test('writes via repo.setScore and never raises a conflict, even when server row is newer/different', async () => {
    repo.setScore.mockResolvedValue({
      previousStrokes: 9, previousUpdatedAt: new Date(999999).toISOString(),
    });
    const mutation = {
      type: 'conflict.resolve', roundId: 'r1', playerId: 'p1', hole: 5, value: 4,
    };
    const result = await executeMutation(entry(mutation, { ts: 1 }), baseTournament());
    expect(repo.setScore).toHaveBeenCalledWith({
      tournamentId: TID, roundId: 'r1', playerId: 'p1', hole: 5, strokes: 4,
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
  test('patches round pairs from the local round', async () => {
    const mutation = { type: 'pairs.set', roundId: 'r1', pairs: [['p1', 'p3'], ['p2', 'p4']] };
    const local = baseTournament();
    local.rounds[0].pairs = [['p1', 'p3'], ['p2', 'p4']];
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', { pairs: [['p1', 'p3'], ['p2', 'p4']] });
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
  test('patches playerHandicaps for the single player from the local round', async () => {
    const mutation = {
      type: 'handicap.set', roundId: 'r1', playerId: 'p1', handicap: 15,
    };
    const local = baseTournament();
    local.rounds[0].playerHandicaps = { p1: 15, p2: 8 };
    await executeMutation(entry(mutation), local);
    expect(repo.patchRound).toHaveBeenCalledWith(TID, 'r1', {
      playerHandicaps: { p1: 15 },
    });
  });
});

describe('index.set', () => {
  test('patches playerIndexes for the single player from the local round', async () => {
    const mutation = {
      type: 'index.set', roundId: 'r1', playerId: 'p1', index: 16,
    };
    const local = baseTournament();
    local.rounds[0].playerIndexes = { p1: 16, p2: 9 };
    await executeMutation(entry(mutation), local);
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
  test('deletes the player, clears each roundPatch, and patches pairs/scoringMode', async () => {
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
      pairs: [['p1'], ['p3', 'p4']],
      scoringMode: null,
    });
  });

  test('skips the patchRound call when the roundPatch has no pairs/clearScoringMode', async () => {
    const local = baseTournament();
    const mutation = {
      type: 'tournament.removePlayer',
      playerId: 'p2',
      roundPatches: [{ roundId: 'r1' }],
    };
    await executeMutation(entry(mutation), local);
    expect(repo.clearPlayerRound).toHaveBeenCalledWith(TID, 'r1', 'p2');
    expect(repo.patchRound).not.toHaveBeenCalled();
  });

  test('still clears the round even when the local round no longer exists', async () => {
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

describe('unknown mutation types', () => {
  test('throws, matching metaPathFor\'s default contract', async () => {
    await expect(executeMutation(entry({ type: 'not.a.real.type' }), baseTournament()))
      .rejects.toThrow('unknown mutation type: not.a.real.type');
  });
});
