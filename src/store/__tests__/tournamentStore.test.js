import { rowToTournament, reTeeRound } from '../tournamentStore';

describe('rowToTournament', () => {
  test('official tournament: identity comes from columns, content defaults empty', () => {
    // Official tournaments keep their state in side tables; the `data` blob
    // is empty, so the Home-list entry must be built from the row columns.
    const row = {
      id: 'uuid-official-1',
      name: 'Weekend Golf',
      kind: 'official',
      created_at: '2026-05-18T09:00:00Z',
      data: {},
    };
    expect(rowToTournament(row, 'owner')).toEqual({
      id: 'uuid-official-1',
      name: 'Weekend Golf',
      kind: 'official',
      createdAt: '2026-05-18T09:00:00Z',
      rounds: [],
      players: [],
      _role: 'owner',
    });
  });

  test('casual tournament: the data blob wins over the columns', () => {
    const row = {
      id: '1700000000000',
      name: 'column name',
      kind: 'casual',
      created_at: '2026-05-18T09:00:00Z',
      data: {
        id: '1700000000000',
        name: 'Blob Name',
        kind: 'tournament',
        createdAt: '2026-05-18T08:00:00Z',
        players: [{ id: 'p1', name: 'Ann' }],
        rounds: [{ courseName: 'Pebble' }],
        currentRound: 0,
      },
    };
    const t = rowToTournament(row, 'viewer');
    expect(t.kind).toBe('tournament');
    expect(t.name).toBe('Blob Name');
    expect(t.players).toEqual([{ id: 'p1', name: 'Ann' }]);
    expect(t.rounds).toEqual([{ courseName: 'Pebble' }]);
    expect(t._role).toBe('viewer');
  });
});

describe('reTeeRound', () => {
  const newTees = [
    { label: 'Black',  slope: 140, rating: 73.5 },
    { label: 'White',  slope: 130, rating: 71.0 }, // White edited: was 132/71.8
  ];

  test('refreshes a player tee snapshot from the matching new tee by label', () => {
    const round = {
      playerTees: { p1: { label: 'White', slope: 132, rating: 71.8 } },
    };
    const out = reTeeRound(round, newTees);
    expect(out.playerTees.p1).toEqual({ label: 'White', slope: 130, rating: 71.0 });
  });

  test('retains the existing snapshot when no new tee matches the label', () => {
    const round = {
      playerTees: { p1: { label: 'Yellow', slope: 118, rating: 68.0 } },
    };
    const out = reTeeRound(round, newTees);
    expect(out.playerTees.p1).toEqual({ label: 'Yellow', slope: 118, rating: 68.0 });
  });

  test('is a no-op when the round has no playerTees', () => {
    const round = { scores: {} };
    expect(reTeeRound(round, newTees)).toEqual({ scores: {} });
  });
});
