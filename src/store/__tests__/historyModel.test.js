import {
  playerInitials, findPlayerForIdentity, placeLabel,
  historyEntryModel, buildHistorySections,
} from '../historyModel';

const P = (id, name, extra = {}) => ({ id, name, handicap: 0, ...extra });
const HOLE = { number: 1, par: 4, strokeIndex: 1 };

// Single-hole stableford game: me (3 pts) vs Bob (2 pts).
const game = {
  id: '1780000000001',
  kind: 'game',
  name: 'Casual 18',
  createdAt: '2026-06-07T10:00:00.000Z',
  finishedAt: '2026-06-07T15:00:00.000Z',
  _role: 'owner',
  settings: { scoringMode: 'stableford' },
  players: [P('me', 'Marcos', { user_id: 'u1' }), P('b', 'Noel')],
  rounds: [{
    id: 'r0',
    courseName: 'CCVM Negro',
    holes: [HOLE],
    pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
    playerHandicaps: {},
    scores: { me: { 1: 3 }, b: { 1: 4 } }, // 3 pts / 2 pts
  }],
};

// Two-round stableford tournament: me tops the board (6 pts vs 4).
const wonTournament = {
  id: '1780000000002',
  kind: 'tournament',
  name: 'Marbella Open',
  createdAt: '2026-06-19T09:00:00.000Z',
  finishedAt: '2026-06-21T18:00:00.000Z',
  _role: 'member',
  settings: { scoringMode: 'stableford' },
  players: [P('me', 'Marcos', { user_id: 'u1' }), P('b', 'Noel')],
  rounds: [
    {
      id: 'r0', courseName: 'Aloha', holes: [HOLE],
      pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
      playerHandicaps: {},
      scores: { me: { 1: 3 }, b: { 1: 4 } }, // 3 / 2
    },
    {
      id: 'r1', courseName: 'La Quinta', holes: [HOLE],
      pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
      playerHandicaps: {},
      scores: { me: { 1: 3 }, b: { 1: 4 } }, // 3 / 2
    },
  ],
  currentRound: 1,
};

// Same tournament shape but Noel wins and I come 2nd.
const lostTournament = {
  ...wonTournament,
  id: '1780000000003',
  name: 'Primavera Cup',
  createdAt: '2026-04-11T09:00:00.000Z',
  finishedAt: '2026-04-12T18:00:00.000Z',
  rounds: wonTournament.rounds.map((r) => ({
    ...r,
    scores: { me: { 1: 4 }, b: { 1: 3 } }, // 2 / 3 — Noel ahead
  })),
};

const identity = { userId: 'u1', displayName: 'Marcos' };

describe('playerInitials', () => {
  test('first two characters, uppercased', () => {
    expect(playerInitials('Claudio')).toBe('CL');
    expect(playerInitials('  javi ')).toBe('JA');
  });
  test('empty or missing name falls back to ?', () => {
    expect(playerInitials('')).toBe('?');
    expect(playerInitials(undefined)).toBe('?');
  });
});

describe('findPlayerForIdentity', () => {
  const players = [P('a', 'Ann', { user_id: 'ua' }), P('b', 'Bob')];
  test('prefers user_id match', () => {
    expect(findPlayerForIdentity(players, { userId: 'ua', displayName: 'Bob' }).id).toBe('a');
  });
  test('falls back to case-insensitive name match', () => {
    expect(findPlayerForIdentity(players, { displayName: '  bob ' }).id).toBe('b');
  });
  test('null when nothing matches', () => {
    expect(findPlayerForIdentity(players, { displayName: 'Zoe' })).toBeNull();
    expect(findPlayerForIdentity(players, {})).toBeNull();
  });
});

describe('placeLabel', () => {
  test('ordinal suffixes including the 11-13 exceptions', () => {
    expect(placeLabel(1)).toBe('1st');
    expect(placeLabel(2)).toBe('2nd');
    expect(placeLabel(3)).toBe('3rd');
    expect(placeLabel(4)).toBe('4th');
    expect(placeLabel(11)).toBe('11th');
    expect(placeLabel(12)).toBe('12th');
    expect(placeLabel(13)).toBe('13th');
    expect(placeLabel(21)).toBe('21st');
  });
});

describe('historyEntryModel — game', () => {
  test('date block, course subtitle, my points, no champion footer', () => {
    const m = historyEntryModel(game, identity);
    expect(m.kind).toBe('game');
    expect(m.dateBox).toEqual({ top: '7', bottom: 'JUN' });
    expect(m.subtitle).toBe('CCVM Negro');
    expect(m.result).toEqual({ kind: 'points', points: 3 });
    expect(m.champion).toBeNull();
    expect(m.isOwner).toBe(true);
    expect(m.avatars).toEqual([
      { initials: 'MA', isMe: true },
      { initials: 'NO', isMe: false },
    ]);
    expect(m.extraPlayers).toBe(0);
  });

  test('scramble game reports a team result instead of personal points', () => {
    const scramble = {
      ...game,
      id: '1780000000004',
      settings: { scoringMode: 'scramblepairs' },
      rounds: [{
        ...game.rounds[0],
        scoringMode: 'scramblepairs',
        pairs: [[P('me', 'Marcos'), P('b', 'Noel')]],
        scores: { me: { 1: 3 } },
      }],
    };
    expect(historyEntryModel(scramble, identity).result).toEqual({ kind: 'team' });
  });

  test('unknown identity yields a none result', () => {
    expect(historyEntryModel(game, { displayName: 'Stranger' }).result)
      .toEqual({ kind: 'none' });
  });
});

describe('historyEntryModel — tournament', () => {
  test('won: WON result, champion is me, gold-eligible placement', () => {
    const m = historyEntryModel(wonTournament, identity);
    expect(m.kind).toBe('tournament');
    expect(m.dateBox).toEqual({ top: '2', bottom: 'ROUNDS' });
    expect(m.subtitle).toBe('2 courses');
    expect(m.result).toEqual({ kind: 'won', points: 6, unit: 'pts' });
    expect(m.champion).toEqual({ name: 'Marcos', isMe: true, points: 6, unit: 'pts' });
    expect(m.myPlacement).toMatchObject({ place: 1, label: '1st', fieldSize: 2, won: true });
  });

  test('lost: placement result, champion is the other player', () => {
    const m = historyEntryModel(lostTournament, identity);
    expect(m.result).toEqual({
      kind: 'placement', place: 2, label: '2nd', points: 4, unit: 'pts',
    });
    expect(m.champion).toEqual({ name: 'Noel', isMe: false, points: 6, unit: 'pts' });
    expect(m.myPlacement).toMatchObject({ place: 2, won: false, podium: true });
  });

  test('single distinct course shows its name; ROUND singular for one round', () => {
    const oneRound = {
      ...wonTournament,
      id: '1780000000005',
      rounds: [wonTournament.rounds[0], { ...wonTournament.rounds[1], courseName: 'Aloha' }],
    };
    expect(historyEntryModel(oneRound, identity).subtitle).toBe('Aloha');
    const single = { ...wonTournament, id: '1780000000006', rounds: [wonTournament.rounds[0]] };
    expect(historyEntryModel(single, identity).dateBox).toEqual({ top: '1', bottom: 'ROUND' });
  });

  test('all-matchplay tournament reports result/champion in holes, not pts', () => {
    // Single-hole 1v1 match play: I win the hole (3 vs 4), so I'm 1-up with
    // no holes left — tournamentMatchPlayStandings' unit is 'holes'.
    const matchplayTournament = {
      id: '1780000000007',
      kind: 'tournament',
      name: 'Head to Head',
      createdAt: '2026-05-01T09:00:00.000Z',
      finishedAt: '2026-05-01T18:00:00.000Z',
      _role: 'owner',
      settings: { scoringMode: 'matchplay' },
      players: [P('me', 'Marcos', { user_id: 'u1' }), P('b', 'Noel')],
      rounds: [{
        id: 'r0',
        courseName: 'Aloha',
        scoringMode: 'matchplay',
        holes: [HOLE],
        pairs: [[P('me', 'Marcos')], [P('b', 'Noel')]],
        playerHandicaps: {},
        scores: { me: { 1: 3 }, b: { 1: 4 } }, // me wins the hole
      }],
    };
    const m = historyEntryModel(matchplayTournament, identity);
    expect(m.result).toEqual({ kind: 'won', points: 1, unit: 'holes' });
    expect(m.champion).toEqual({ name: 'Marcos', isMe: true, points: 1, unit: 'holes' });
  });
});

describe('buildHistorySections', () => {
  test('groups newest-first by month with human labels', () => {
    const sections = buildHistorySections([lostTournament, game, wonTournament], identity);
    expect(sections.map((s) => s.key)).toEqual(['2026-06', '2026-04']);
    expect(sections[0].label).toBe('June 2026');
    expect(sections[0].items.map((i) => i.id))
      .toEqual(['1780000000002', '1780000000001']); // Jun 21 before Jun 7
    expect(sections[1].items.map((i) => i.id)).toEqual(['1780000000003']);
  });

  test('falls back to the numeric id timestamp when dates are missing', () => {
    const bare = { ...game, id: '1750000000000', createdAt: undefined, finishedAt: undefined };
    const sections = buildHistorySections([bare], identity);
    expect(sections).toHaveLength(1);
    expect(sections[0].items[0].when).toBe(1750000000000);
  });
});
