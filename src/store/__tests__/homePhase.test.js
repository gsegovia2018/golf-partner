import {
  homePhase, beforeModel, liveModel, afterModel, PHASE_WINDOW_MS, withCardScores, cardCandidates, cardShotDetails,
} from '../homePhase';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const H = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const scores = (n, v = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, v]));
const players = [
  { id: 'p1', name: 'Marcos', user_id: 'u1', handicap: 14 },
  { id: 'p2', name: 'Noé', user_id: 'u2', handicap: 9 },
];

function game(over = {}, roundOver = {}) {
  return {
    id: 'g1', name: 'Domingo', kind: 'game', createdAt: iso(NOW - 2 * H), currentRound: 0, players,
    rounds: [{ id: 'r1', courseName: 'Golf Santander', holes, scores: {}, ...roundOver }],
    ...over,
  };
}

const phaseOf = (ts, opts = {}) => homePhase(ts, { userId: 'u1', now: NOW, ...opts });

describe('homePhase', () => {
  it('is idle with nothing, or only games I am not in', () => {
    expect(phaseOf([]).phase).toBe('idle');
    expect(phaseOf([game()], { userId: 'someone-else' }).phase).toBe('idle');
  });

  it('a fresh unstarted game is Before; an old one is not', () => {
    const r = phaseOf([game()]);
    expect(r.phase).toBe('before');
    expect(r.before).toMatchObject({ roundIndex: 0, next: false });
    expect(phaseOf([game({ createdAt: iso(NOW - PHASE_WINDOW_MS - H) })]).phase).toBe('idle');
  });

  it('a started round with recent activity is Live', () => {
    const t = game({}, { scores: { p1: scores(6), p2: scores(5) } });
    const r = phaseOf([t], { lastActivityByKey: new Map([['g1:r1', NOW - 10 * 60 * 1000]]) });
    expect(r.phase).toBe('live');
    expect(r.live.tournament.id).toBe('g1');
  });

  it('a round abandoned hours ago is no longer Live (the never-expiring card fix)', () => {
    const t = game({ createdAt: iso(NOW - 90 * 24 * H) }, { scores: { p1: scores(3) } });
    const r = phaseOf([t], { lastActivityByKey: new Map([['g1:r1', NOW - 7 * H]]) });
    expect(r.phase).toBe('idle');
  });

  it('unknown activity keeps a started round Live (offline)', () => {
    const t = game({}, { scores: { p1: scores(3) } });
    expect(phaseOf([t]).phase).toBe('live');
  });

  it('a round finished in the last 24 h is After; older is idle', () => {
    const done = (ms) => game({ createdAt: iso(NOW - 30 * H) }, { scores: { p1: scores(18), p2: scores(18) }, finishedAt: iso(ms) });
    const r = phaseOf([done(NOW - 3 * H)]);
    expect(r.phase).toBe('after');
    expect(r.after.endedAt).toBe(NOW - 3 * H);
    expect(phaseOf([done(NOW - 25 * H)]).phase).toBe('idle');
  });

  it('Before wins over After, and After is kept for its one line', () => {
    const yesterday = game({ id: 'g0', createdAt: iso(NOW - 30 * H) }, { id: 'r0', scores: { p1: scores(18) }, finishedAt: iso(NOW - 20 * H) });
    const r = phaseOf([yesterday, game()]);
    expect(r.phase).toBe('before');
    expect(r.after.tournament.id).toBe('g0');
  });

  it('the next round of a tournament whose round just ended is Before (next)', () => {
    const t = {
      id: 't1', name: 'Ryder de Otoño', kind: 'tournament', createdAt: iso(NOW - 3 * 24 * H), currentRound: 0, players,
      rounds: [
        { id: 'r1', holes, scores: { p1: scores(18), p2: scores(18) }, finishedAt: iso(NOW - 4 * H) },
        { id: 'r2', courseName: 'El Encín', holes, scores: {} },
      ],
    };
    const r = phaseOf([t]);
    expect(r.phase).toBe('before');
    expect(r.before).toMatchObject({ roundIndex: 1, next: true });
    expect(r.after.roundIndex).toBe(0);
  });

  it('skips official tournaments and viewer roles', () => {
    expect(phaseOf([game({ kind: 'official' })]).phase).toBe('idle');
    expect(phaseOf([game({ _role: 'viewer' })]).phase).toBe('idle');
  });
});

describe('phase models', () => {
  it('beforeModel lists teams with strokes received', () => {
    const t = game({}, { pairs: [[{ id: 'p1' }], [{ id: 'p2' }]], playerHandicaps: { p1: 16, p2: 11 }, playerTees: { p1: { label: 'Amarillas' } } });
    const m = beforeModel({ tournament: t, round: t.rounds[0], roundIndex: 0 }, 'u1');
    expect(m.courseName).toBe('Golf Santander');
    expect(m.tee).toBe('Amarillas');
    expect(m.teams).toEqual([
      { side: 0, members: [{ id: 'p1', name: 'Marcos', strokes: 16, me: true }] },
      { side: 1, members: [{ id: 'p2', name: 'Noé', strokes: 11, me: false }] },
    ]);
    expect(m.players).toBeNull();
  });

  it('beforeModel puts my pair first and keeps its side', () => {
    const t = game({}, { pairs: [[{ id: 'p2' }], [{ id: 'p1' }]], playerHandicaps: { p1: 16, p2: 11 } });
    const m = beforeModel({ tournament: t, round: t.rounds[0], roundIndex: 0 }, 'u1');
    expect(m.teams.map((tm) => [tm.side, tm.members[0].id])).toEqual([[1, 'p1'], [0, 'p2']]);
  });

  it('beforeModel drops a tee the course never named', () => {
    const t = game({}, { playerTees: { p1: { label: 'Default' } } });
    expect(beforeModel({ tournament: t, round: t.rounds[0], roundIndex: 0 }, 'u1').tee).toBe('');
  });

  it('beforeModel names my shot holes on a solo round, one or two of them', () => {
    const solo = (hcp) => {
      const t = game({ players: [players[0]] }, { playerHandicaps: { p1: hcp } });
      return beforeModel({ tournament: t, round: t.rounds[0], roundIndex: 0 }, 'u1').shotHoles;
    };
    expect(solo(1)).toEqual([{ number: 1, strokeIndex: 1 }]);
    expect(solo(2)).toEqual([{ number: 1, strokeIndex: 1 }, { number: 2, strokeIndex: 2 }]);
    expect(solo(9)).toBeNull();
    expect(solo(0)).toBeNull();
  });

  it('liveModel gives my points, thru and the next hole', () => {
    const t = game({}, { scores: { p1: scores(6), p2: scores(5) } });
    const m = liveModel({ tournament: t, round: t.rounds[0], roundIndex: 0 }, 'u1');
    expect(m.thru).toBe(6);
    expect(m.next).toMatchObject({ number: 7, par: 4, strokeIndex: 7 });
    expect(m.board.find((b) => b.me).thru).toBe(6);
    expect(typeof m.myPoints).toBe('number');
  });

  it('afterModel gives place and the winner, or no winner when I won', () => {
    const t = game({}, { scores: { p1: scores(18, 5), p2: scores(18, 4) }, finishedAt: iso(NOW - H) });
    const a = afterModel({ tournament: t, round: t.rounds[0], roundIndex: 0, endedAt: NOW - H }, 'u1');
    expect(a).toMatchObject({ place: 2, count: 2, roundKey: 'g1:0' });
    expect(a.winner.name).toBe('Noé');
    const b = afterModel({ tournament: t, round: t.rounds[0], roundIndex: 0, endedAt: NOW - H }, 'u2');
    expect(b.place).toBe(1);
    expect(b.winner).toBeNull();
    expect(b.tied).toBeNull();
  });

  it('afterModel names everyone tied for first instead of one winner', () => {
    const t = game({}, { scores: { p1: scores(18, 4), p2: scores(18, 4) }, playerHandicaps: { p1: 0, p2: 0 }, finishedAt: iso(NOW - H) });
    const a = afterModel({ tournament: t, round: t.rounds[0], roundIndex: 0, endedAt: NOW - H }, 'u1');
    expect(a.winner).toBeNull();
    expect(a.tied.players.map((p) => [p.id, p.me])).toEqual([['p1', true], ['p2', false]]);
  });

  it('afterModel gives a solo round my card and what my shots add up to', () => {
    const shotDetails = { p1: { 1: { putts: 2, drive: 'fairway' }, 2: { putts: 1, drive: 'left', teePenalties: 1 }, 3: { putts: 3 } } };
    const t = game({ players: [players[0]] }, { scores: { p1: { 1: 4, 2: 4, 3: 5 } }, shotDetails, finishedAt: iso(NOW - H) });
    const a = afterModel({ tournament: t, round: t.rounds[0], roundIndex: 0, endedAt: NOW - H }, 'u1');
    expect(a.card.solo).toBe(true);
    expect(a.shots).toEqual({ fairways: { hit: 1, of: 2 }, greens: { hit: 2, of: 3 }, penalties: 1 });
    expect(a.pairs).toBeNull();
  });

  it('afterModel gives my own Stableford points for the pairs card', () => {
    const t = game({}, { scores: { p1: scores(18, 4), p2: scores(18, 4) }, playerHandicaps: { p1: 0, p2: 0 }, finishedAt: iso(NOW - H) });
    const a = afterModel({ tournament: t, round: t.rounds[0], roundIndex: 0, endedAt: NOW - H }, 'u1');
    expect(a.myStableford).toBe(36);
  });
});

describe('card-engine scores (the stuck "Ready to start" fix)', () => {
  it('a hole scored only in the card engine moves Before to Live', () => {
    const t = game();
    expect(phaseOf([t]).phase).toBe('before');
    const merged = withCardScores([t], new Map([['g1:r1', { p1: { 1: 5 } }]]));
    expect(phaseOf(merged).phase).toBe('live');
    expect(liveModel(phaseOf(merged).live, 'u1').thru).toBe(1);
  });

  it('overlays cell by cell and leaves other rounds and games alone', () => {
    const t = game({}, { scores: { p1: { 1: 4, 2: 5 } } });
    const [m] = withCardScores([t], new Map([['g1:r1', { p1: { 2: 6, 3: 4 }, p2: { 1: 3 } }]]));
    expect(m.rounds[0].scores).toEqual({ p1: { 1: 4, 2: 6, 3: 4 }, p2: { 1: 3 } });
    expect(t.rounds[0].scores).toEqual({ p1: { 1: 4, 2: 5 } });
    expect(withCardScores([t], new Map())[0]).toBe(t);
  });

  it('reads the card engine for fresh or started rounds only', () => {
    const fresh = game();
    const old = game({ id: 'g2', createdAt: iso(NOW - 40 * H) });
    const started = game({ id: 'g3', createdAt: iso(NOW - 40 * H) }, { id: 'r3', scores: { p1: { 1: 4 } } });
    const ids = cardCandidates([fresh, old, started], 'u1', NOW).map((c) => c.tournament.id);
    expect(ids).toEqual(['g1', 'g3']);
  });
});

describe('card shot detail', () => {
  it('reads my published shots with the draft on top, and overlays them', () => {
    const state = {
      myAuthorId: 'a1',
      cardsByAuthor: { a1: { holes: { 1: { shots: { p1: { putts: 2 } } } } }, a2: { holes: { 1: { shots: { p2: { putts: 1 } } } } } },
      draft: { 2: { shots: { p1: { putts: 3 } } } },
    };
    const shots = cardShotDetails(state);
    expect(shots).toEqual({ p1: { 1: { putts: 2 }, 2: { putts: 3 } } });
    const [m] = withCardScores([game()], null, new Map([['g1:r1', shots]]));
    expect(m.rounds[0].shotDetails.p1[2]).toEqual({ putts: 3 });
  });
});
