import { yourCardStep, seasonMoves, homeAction } from '../leagueView';
import { leagueScorecardModel } from '../leagueScorecard';

describe('yourCardStep', () => {
  const later = new Date(Date.now() + 86400000).toISOString();
  test('no card yet is the announce step', () => {
    expect(yourCardStep({ kind: 'none' })).toEqual({ step: 0, wait: false });
  });
  test('announced and playing are the play step; an app card fully scored is the send step', () => {
    expect(yourCardStep({ kind: 'announced', offApp: true, card: { status: 'announced', postBy: later } })).toEqual({ step: 1, wait: false });
    const playing = { kind: 'playing', offApp: false, card: { status: 'playing', postBy: later } };
    expect(yourCardStep(playing, { stillPlaying: true })).toEqual({ step: 1, wait: false });
    expect(yourCardStep(playing)).toEqual({ step: 2, wait: false });
  });
  test('sent waits on the marker; an off-app card without its proof is still sending', () => {
    expect(yourCardStep({ kind: 'submitted', offApp: false, card: { status: 'submitted' } })).toEqual({ step: 3, wait: true });
    expect(yourCardStep({ kind: 'submitted', offApp: true, card: { status: 'submitted' } })).toEqual({ step: 2, wait: false });
    expect(yourCardStep({ kind: 'submitted', offApp: true, card: { status: 'submitted', proofPath: 'x.jpg' } })).toEqual({ step: 3, wait: true });
  });
  test('confirmed is done unless an admin still has to approve it', () => {
    expect(yourCardStep({ kind: 'confirmed', card: { status: 'confirmed' } })).toEqual({ step: 4, wait: false });
    expect(yourCardStep({ kind: 'confirmed', card: { status: 'confirmed', notAnnounced: true } })).toEqual({ step: 3, wait: true });
  });
  test('missed and voided cards leave the track', () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    expect(yourCardStep({ kind: 'announced', card: { status: 'announced', postBy: past } })).toBeNull();
    expect(yourCardStep({ kind: 'missed', card: { status: 'missed' } })).toBeNull();
    expect(yourCardStep({ kind: 'voided', card: { status: 'void' } })).toBeNull();
  });
});

describe('seasonMoves', () => {
  const members = ['a', 'b', 'c'].map((userId) => ({ userId, leftAt: null }));
  const card = (userId, points) => ({ userId, status: 'confirmed', points, source: 'app' });
  const table = [100, 85, 75];
  test('places gained or lost by the last scored month', () => {
    const cards = {
      '2026-10': [card('a', 38), card('b', 36), card('c', 30)],
      '2026-11': [card('c', 40), card('b', 38), card('a', 20)],
    };
    // Before Nov: a 100, b 85, c 75. After: b 170, c 175, a 175 → c/a tie 1st, b 3rd.
    const moves = seasonMoves(members, cards, table);
    expect(moves.get('c')).toBe(2);
    expect(moves.get('b')).toBe(-1);
    expect(moves.has('a')).toBe(false);
  });
  test('the first scored month moves nobody', () => {
    expect(seasonMoves(members, { '2026-10': [card('a', 38)] }, table).size).toBe(0);
    expect(seasonMoves(members, {}, table).size).toBe(0);
  });
});

describe('leagueScorecardModel', () => {
  const course = { holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })) };
  const holes = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i + 1), 5]));
  test('one row, out and in, Stableford off the frozen playing handicap', () => {
    const m = leagueScorecardModel({ userId: 'u', course, holes, playingHandicap: 9 }, 'Lucía Bermejo');
    expect(m.solo).toBe(true);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].nines.map((n) => n.key)).toEqual(['out', 'in']);
    // SI 1-9 get a stroke: 5 on a par 4 is net par (2 pts) there, bogey (1 pt) on the rest.
    expect(m.rows[0].total).toMatchObject({ strokes: 90, points: 27 });
    expect(m.rows[0].nines[0].cells[0].extra).toBe(1);
  });
  test('no holes, no scorecard', () => {
    expect(leagueScorecardModel({ course, holes: null })).toBeNull();
    expect(leagueScorecardModel({ course: {}, holes })).toBeNull();
  });
});

describe('homeAction', () => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const league = { id: 'L1', seasonStart: '2020-01-01', seasonEnd: '2099-12-31', archivedAt: null };
  const snap = (card, extra = {}) => ({ league: { ...league, ...extra }, cardsByMonth: { [month]: card ? [{ userId: 'me', ...card }] : [] }, cards: [] });
  const later = new Date(Date.now() + 86400000).toISOString();
  test('no card: play; outside the season or archived: open', () => {
    expect(homeAction(snap(null), 'me', now)).toEqual({ kind: 'play' });
    expect(homeAction(snap(null, { seasonStart: '2099-01-01' }), 'me', now)).toEqual({ kind: 'open' });
    expect(homeAction(snap(null, { archivedAt: 'x' }), 'me', now)).toEqual({ kind: 'open' });
  });
  test('an off-app card: post once posting opens, then the proof', () => {
    const teeLongAgo = new Date(Date.now() - 4 * 3600000).toISOString();
    expect(homeAction(snap({ id: 'c1', status: 'announced', source: 'offapp', teeTime: teeLongAgo, postBy: later }), 'me', now)).toEqual({ kind: 'post', cardId: 'c1' });
    expect(homeAction(snap({ id: 'c1', status: 'announced', source: 'offapp', teeTime: later, postBy: later }), 'me', now)).toEqual({ kind: 'open' });
    expect(homeAction(snap({ id: 'c1', status: 'submitted', source: 'offapp' }), 'me', now)).toEqual({ kind: 'proof', cardId: 'c1' });
    expect(homeAction(snap({ id: 'c1', status: 'submitted', source: 'offapp', proofPath: 'p.jpg' }), 'me', now)).toEqual({ kind: 'open' });
  });
  test('an app card: the scorecard while playing, Validate once sent; confirmed opens the board', () => {
    expect(homeAction(snap({ id: 'c1', status: 'playing', source: 'app', tournamentId: 't1', roundId: 'r1', postBy: later }), 'me', now))
      .toEqual({ kind: 'scorecard', tournamentId: 't1', roundId: 'r1' });
    expect(homeAction(snap({ id: 'c1', status: 'submitted', source: 'app', tournamentId: 't1', roundId: 'r1' }), 'me', now))
      .toEqual({ kind: 'validate', cardId: 'c1', tournamentId: 't1', roundId: 'r1' });
    expect(homeAction(snap({ id: 'c1', status: 'confirmed', source: 'app' }), 'me', now)).toEqual({ kind: 'open' });
  });
});
