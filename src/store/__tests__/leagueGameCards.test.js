import {
  hasScoreIn, leagueCardRows, leagueOptInState, leagueRoundIndex, leagueStripState, listText,
  membersFromMonth, roundCanCount, roundLeagueCards, showsLeagueList,
} from '../leagueGameCards';

const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const holes9 = holes18.slice(0, 9);
const yellow = { label: 'Yellow', slope: 133, rating: 71.2 };
const red = { label: 'Red', slope: null, rating: null };

const players = [
  { id: 'p1', name: 'Marcos', user_id: 'u1' },
  { id: 'p2', name: 'Pedro Sáez', user_id: null },
  { id: 'p3', name: 'Javier Ortega', user_id: 'u3' },
  { id: 'p4', name: 'Carlos Molina', user_id: 'u4' },
];
const round = (over = {}) => ({
  id: 'r1', courseName: 'La Moraleja', holes: holes18, tees: [yellow],
  playerTees: { p1: yellow, p2: yellow, p3: yellow, p4: yellow }, scores: {}, ...over,
});
const game = (over = {}) => ({
  id: 't1', kind: 'game', settings: { scoringMode: 'stableford' }, players, rounds: [round()], ...over,
});

describe('membersFromMonth', () => {
  test('a card taking the month marks hasCard; one on this round marks thisRound too', () => {
    const members = [{ userId: 'u1' }, { userId: 'u3' }, { userId: 'u4' }];
    const cards = [
      { userId: 'u4', status: 'confirmed', tournamentId: 'tX', roundId: 'rX' },
      { userId: 'u3', status: 'void', voidKind: 'withdrawn' },
      { userId: 'u1', status: 'announced', tournamentId: 't1', roundId: 'r1' },
    ];
    expect(membersFromMonth(members, cards, { tournamentId: 't1', roundId: 'r1' })).toEqual([
      { userId: 'u1', hasCard: true, thisRound: true },
      { userId: 'u3', hasCard: false, thisRound: false },
      { userId: 'u4', hasCard: true, thisRound: false },
    ]);
  });
});

describe('leagueCardRows', () => {
  const members = [
    { userId: 'u1', hasCard: false, thisRound: false },
    { userId: 'u3', hasCard: false, thisRound: false },
    { userId: 'u4', hasCard: true, thisRound: false },
  ];

  test('me first, then asked, has a card, not in the league (the D5 scenario)', () => {
    const rows = leagueCardRows({ players, userId: 'u1', members, round: round() });
    expect(rows.map((r) => [r.playerId, r.kind])).toEqual([
      ['p1', 'me'], ['p3', 'asked'], ['p4', 'hasCard'], ['p2', 'notMember'],
    ]);
    expect(showsLeagueList(rows)).toBe(true);
  });

  test('a card recorded on the round, or this_round from the server, counts', () => {
    const t = game({ leagueCards: { 'r1:p3': { leagueId: 'L1', cardId: 'c3', playerId: 'p3', roundId: 'r1' } } });
    expect(leagueCardRows({ players, userId: 'u1', members, round: round(), tournament: t })
      .find((r) => r.playerId === 'p3').kind).toBe('counts');
    const live = members.map((m) => (m.userId === 'u4' ? { ...m, thisRound: true } : m));
    expect(leagueCardRows({ players, userId: 'u1', members: live, round: round() })
      .find((r) => r.playerId === 'p4').kind).toBe('counts');
  });

  test("a member on an unrated tee can't count, with the tee named", () => {
    const r = round({ playerTees: { ...round().playerTees, p3: red } });
    expect(leagueCardRows({ players, userId: 'u1', members, round: r }).find((x) => x.playerId === 'p3'))
      .toMatchObject({ kind: 'unrated', tee: 'Red' });
  });

  test('only me in the league: the list folds back to the switch', () => {
    const rows = leagueCardRows({ players, userId: 'u1', members: [members[0]], round: round() });
    expect(showsLeagueList(rows)).toBe(false);
  });
});

describe('roundCanCount', () => {
  test('18-hole casual rounds count; official, scramble and 9 holes never', () => {
    expect(roundCanCount(game(), round())).toBe(true);
    expect(roundCanCount(game({ kind: 'official' }), round())).toBe(false);
    expect(roundCanCount(game(), round(), { official: true })).toBe(false);
    expect(roundCanCount(game(), round({ scoringMode: 'scramble4' }))).toBe(false);
    expect(roundCanCount(game({ settings: { scoringMode: 'scramblepairs' } }), round())).toBe(false);
    expect(roundCanCount(game(), round({ holes: holes9 }))).toBe(false);
  });
});

describe('hasScoreIn', () => {
  test('any non-empty cell of the player', () => {
    expect(hasScoreIn({ p1: { 1: '' } }, 'p1')).toBe(false);
    expect(hasScoreIn({ p1: { 1: 5 } }, 'p1')).toBe(true);
    expect(hasScoreIn({}, 'p1')).toBe(false);
  });
});

describe('leagueOptInState (Javier opens Marcos’s game)', () => {
  const league = { id: 'L1', name: 'QA', leagueHandicap: 13.4 };
  const status = {
    L1: [
      { playerId: 'p1', userId: 'u1', isMe: false, hasCard: true, thisRound: true },
      { playerId: 'p3', userId: 'u3', isMe: true, hasCard: false, thisRound: false },
    ],
  };
  const base = { tournament: game(), round: round(), meId: 'p3', leagues: [league], statusByLeague: status, scores: {} };

  test('offer before the first shot; dismissed after "Not this round"', () => {
    expect(leagueOptInState(base)).toEqual({ kind: 'offer', league });
    expect(leagueOptInState({ ...base, dismissed: true }).kind).toBe('dismissed');
  });

  test('too late once I scored (unless I already said no)', () => {
    const scores = { p3: { 1: 4 } };
    expect(leagueOptInState({ ...base, scores }).kind).toBe('tooLate');
    expect(leagueOptInState({ ...base, scores, dismissed: true }).kind).toBe('none');
  });

  test('none: no other member in the game, my month taken, my card already on the round', () => {
    expect(leagueOptInState({ ...base, statusByLeague: { L1: [status.L1[1]] } }).kind).toBe('none');
    expect(leagueOptInState({
      ...base, statusByLeague: { L1: [status.L1[0], { ...status.L1[1], hasCard: true }] },
    }).kind).toBe('none');
    const t = game({ leagueCards: { 'r1:p3': { leagueId: 'L1', cardId: 'c3', playerId: 'p3', roundId: 'r1' } } });
    expect(leagueOptInState({ ...base, tournament: t }).kind).toBe('none');
    expect(leagueOptInState({ ...base, statusByLeague: {} }).kind).toBe('none');
  });

  test('none on rounds that can never count', () => {
    expect(leagueOptInState({ ...base, official: true }).kind).toBe('none');
    expect(leagueOptInState({ ...base, round: round({ holes: holes9 }) }).kind).toBe('none');
    expect(leagueOptInState({ ...base, round: round({ playerTees: { p3: red } }) }).kind).toBe('none');
  });
});

describe('leagueStripState', () => {
  const two = game({
    league: { leagueId: 'L1', cardId: 'c1', playerId: 'p1' },
    leagueCards: { 'r1:p3': { leagueId: 'L1', cardId: 'c3', playerId: 'p3', roundId: 'r1' } },
  });

  test('cards: you first, the legacy link counted once on round 0', () => {
    const st = leagueStripState({ tournament: two, round: two.rounds[0], meId: 'p3' });
    expect(st).toMatchObject({ kind: 'cards', count: 2, mine: true, playerIds: ['p1', 'p3'] });
    expect(listText(st.names)).toBe('you and Marcos');
  });

  test('others only, with Count mine after a dismissal; too late', () => {
    const t = game({ league: { leagueId: 'L1', cardId: 'c1', playerId: 'p1' } });
    expect(leagueStripState({ tournament: t, round: t.rounds[0], meId: 'p3', optIn: { kind: 'dismissed' } }))
      .toMatchObject({ kind: 'othersOnly', canOptIn: true, count: 1 });
    expect(leagueStripState({ tournament: t, round: t.rounds[0], meId: 'p3', optIn: { kind: 'none' } }))
      .toMatchObject({ kind: 'othersOnly', canOptIn: false });
    expect(leagueStripState({ tournament: t, round: t.rounds[0], meId: 'p3', optIn: { kind: 'tooLate' } }).kind)
      .toBe('tooLate');
  });

  test('nothing to say without cards', () => {
    expect(leagueStripState({ tournament: game(), round: round(), meId: 'p1' })).toBeNull();
  });

  test('a card of round 2 is not on round 1', () => {
    const t = game({
      kind: 'tournament',
      rounds: [round(), round({ id: 'r2' })],
      leagueCards: { 'r2:p1': { leagueId: 'L1', cardId: 'c9', playerId: 'p1', roundId: 'r2' } },
    });
    expect(leagueStripState({ tournament: t, round: t.rounds[0], meId: 'p1' })).toBeNull();
    expect(roundLeagueCards(t, 'r2')).toHaveLength(1);
    expect(leagueRoundIndex(t, 'r2')).toBe(1);
    expect(leagueRoundIndex(t, 'missing')).toBe(0);
  });
});

describe('listText', () => {
  test('joins with commas and the last "and"', () => {
    expect(listText([{ me: true }, { name: 'Javier' }, { name: 'Carlos' }], { you: 'tú', and: 'y' }))
      .toBe('tú, Javier y Carlos');
    expect(listText([{ name: 'Javier' }])).toBe('Javier');
    expect(listText([])).toBe('');
  });
});
