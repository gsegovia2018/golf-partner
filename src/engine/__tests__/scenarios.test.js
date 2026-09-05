// The plan's acceptance scenarios (§8) as engine-level state transitions.
// Two scorers keep cards: Marcos on device 'dev-m', Guille on 'dev-g'.
// Four players: alex, bea, marcos, guille.
import { cellView, roundCells, shownScores, settledScores, discrepancies, singleScorerCells } from '../cards';
import { emptyCard, publishHole, makeResolution } from '../publish';
import { calcBestWorstBall } from '../../store/tournamentStore';

// tournamentStore imports the supabase client at module load; stub it out so
// this pure-engine suite does no IO (same pattern as bestWorstRoles.test.js).
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({}),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

const PLAYERS = ['alex', 'bea', 'marcos', 'guille'];
const HOLES = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const HOLE_NUMBERS = HOLES.map((h) => h.number);
const NAMES = { 'dev-m': 'Marcos', 'dev-g': 'Guille' };

const ctxOf = (myAuthorId, cardsByAuthor, { resolutions = {}, draft = {} } = {}) =>
  ({ myAuthorId, cardsByAuthor, resolutions, draft, names: NAMES });

const statuses = (ctx, holes) => {
  const cells = roundCells(ctx, PLAYERS, holes);
  return PLAYERS.flatMap((p) => holes.map((h) => cells[p][String(h)].status));
};

describe('S1/S2 — a draft is private until the scorer leaves the hole', () => {
  const myCard = emptyCard();
  const guilleSees = ctxOf('dev-g', { 'dev-g': emptyCard(), 'dev-m': myCard });

  it('S1: Marcos enters only his own score and stays on the hole', () => {
    const marcos = ctxOf('dev-m', { 'dev-m': myCard }, { draft: { 3: { entries: { marcos: 5 } } } });
    expect(shownScores(marcos, PLAYERS, HOLE_NUMBERS)).toEqual({ marcos: { 3: 5 } });
    expect(cellView(marcos, 'marcos', 3).status).toBe('mine');

    expect(statuses(guilleSees, [3])).toEqual(['empty', 'empty', 'empty', 'empty']);
    expect(shownScores(guilleSees, PLAYERS, HOLE_NUMBERS)).toEqual({});
  });

  it('S2: Marcos enters all four scores and stays on the hole', () => {
    const marcos = ctxOf('dev-m', { 'dev-m': myCard }, {
      draft: { 3: { entries: { alex: 5, bea: 4, marcos: 5, guille: 6 } } },
    });
    expect(shownScores(marcos, PLAYERS, HOLE_NUMBERS)).toEqual({
      alex: { 3: 5 }, bea: { 3: 4 }, marcos: { 3: 5 }, guille: { 3: 6 },
    });

    // Guille's copy of Marcos's PUBLISHED card is unchanged, so nothing moved.
    expect(statuses(guilleSees, [3])).toEqual(['empty', 'empty', 'empty', 'empty']);
    expect(shownScores(guilleSees, PLAYERS, HOLE_NUMBERS)).toEqual({});
  });
});

describe('S3 — publishing the hole makes it unverified on the other phone', () => {
  const marcosCard = publishHole(emptyCard(), 3, { entries: { alex: 5, bea: 4, marcos: 5, guille: 6 } }, 1000);
  const guille = ctxOf('dev-g', { 'dev-g': emptyCard(), 'dev-m': marcosCard });

  it('every cell Marcos marked shows as unverified with his values', () => {
    expect(statuses(guille, [3])).toEqual(['unverified', 'unverified', 'unverified', 'unverified']);
    const cells = roundCells(guille, PLAYERS, [3]);
    expect(cells.alex['3'].shown).toBe(5);
    expect(cells.alex['3'].mine).toBe(null);
    expect(cells.alex['3'].others).toEqual([{ scorerKey: 'dev-m', value: 5, ts: 1000 }]);
  });

  it('nothing is final while one scorer alone has marked the hole', () => {
    expect(settledScores(guille, PLAYERS, HOLE_NUMBERS).provisional).toBe(true);
  });
});

describe('S4 — one disagreement, one agreement clears it everywhere', () => {
  const marcosCard = publishHole(emptyCard(), 3, { entries: { alex: 5, bea: 4, marcos: 5, guille: 6 } }, 1000);
  const guilleCard = publishHole(emptyCard(), 3, { entries: { alex: 4, bea: 4, marcos: 5, guille: 6 } }, 2000);
  const cards = { 'dev-m': marcosCard, 'dev-g': guilleCard };
  const marcos = ctxOf('dev-m', cards);
  const guille = ctxOf('dev-g', cards);

  const expected = [{
    hole: 3,
    rows: [{
      playerId: 'alex',
      values: [
        { scorerKey: 'dev-m', name: 'Marcos', value: 5, ts: 1000 },
        { scorerKey: 'dev-g', name: 'Guille', value: 4, ts: 2000 },
      ],
    }],
  }];

  it('both phones raise the same single discrepancy, with who said what', () => {
    expect(discrepancies(marcos, PLAYERS, HOLE_NUMBERS)).toEqual(expected);
    expect(discrepancies(guille, PLAYERS, HOLE_NUMBERS)).toEqual(expected);
    expect(cellView(marcos, 'bea', 3).status).toBe('agreed');
  });

  it('Guille agreeing on 5 resolves the cell on both phones', () => {
    const res = makeResolution(guille, { roundId: 'r1', playerId: 'alex', hole: 3, value: 5, by: 'dev-g', ts: 3000 });
    expect(res.basis).toEqual({ 'dev-m': 1, 'dev-g': 1 });

    const resolutions = { alex: { 3: res } };
    for (const ctx of [ctxOf('dev-m', cards, { resolutions }), ctxOf('dev-g', cards, { resolutions })]) {
      const cell = cellView(ctx, 'alex', 3);
      expect(cell.status).toBe('resolved');
      expect(cell.shown).toBe(5);
      expect(discrepancies(ctx, PLAYERS, HOLE_NUMBERS)).toEqual([]);
      expect(settledScores(ctx, ['alex'], [3]).scores).toEqual({ alex: { 3: 5 } });
    }
  });
});

describe('S5 — a batch of offline holes arrives at once', () => {
  let marcosCard = emptyCard();
  let guilleCard = emptyCard();
  for (const n of [3, 4, 5, 6, 7, 8, 9]) {
    marcosCard = publishHole(marcosCard, n, { entries: { alex: 5, bea: 4, marcos: 5, guille: 6 } }, 1000 + n);
    const entries = { alex: 5, bea: 4, marcos: 5, guille: 6 };
    if (n === 4) entries.alex = 6;
    if (n === 7) entries.bea = 3;
    guilleCard = publishHole(guilleCard, n, { entries }, 2000 + n);
  }

  it('lists every hole that differs and no hole that agrees', () => {
    const marcos = ctxOf('dev-m', { 'dev-m': marcosCard, 'dev-g': guilleCard });
    const found = discrepancies(marcos, PLAYERS, HOLE_NUMBERS);
    expect(found.map((d) => d.hole)).toEqual([4, 7]);
    expect(found[0].rows.map((r) => r.playerId)).toEqual(['alex']);
    expect(found[1].rows.map((r) => r.playerId)).toEqual(['bea']);
  });
});

describe('S6 — my points follow my card, whatever a peer publishes (R6)', () => {
  const playerObjs = [
    { id: 'alex', name: 'Alex', handicap: 0 },
    { id: 'bea', name: 'Bea', handicap: 0 },
    { id: 'marcos', name: 'Marcos', handicap: 0 },
    { id: 'guille', name: 'Guille', handicap: 0 },
  ];
  const roundWith = (scores) => ({
    id: 'r1',
    holes: HOLES,
    scores,
    playerHandicaps: { alex: 0, bea: 0, marcos: 0, guille: 0 },
    pairs: [[playerObjs[0], playerObjs[1]], [playerObjs[2], playerObjs[3]]],
  });

  const marcosCard = publishHole(emptyCard(), 5, { entries: { alex: 5, bea: 4, marcos: 3, guille: 6 } }, 1000);

  it('the best/worst ball summary does not move when a peer disagrees', () => {
    const before = ctxOf('dev-m', { 'dev-m': marcosCard });
    const bwBefore = calcBestWorstBall(roundWith(shownScores(before, PLAYERS, HOLE_NUMBERS)), playerObjs);
    expect(bwBefore.bestBall).toEqual({ pair1: 0, pair2: 1, halved: 0 });

    const guilleCard = publishHole(emptyCard(), 5, { entries: { alex: 4, bea: 4, marcos: 3, guille: 6 } }, 2000);
    const after = ctxOf('dev-m', { 'dev-m': marcosCard, 'dev-g': guilleCard });
    expect(shownScores(after, PLAYERS, HOLE_NUMBERS).alex).toEqual({ 5: 5 });

    const bwAfter = calcBestWorstBall(roundWith(shownScores(after, PLAYERS, HOLE_NUMBERS)), playerObjs);
    expect(bwAfter).toEqual(bwBefore);
  });
});

describe('S8 — re-publishing a hole lapses the agreement on it', () => {
  const guilleCard = publishHole(emptyCard(), 2, { entries: { alex: 4 } }, 2000);
  const marcosV1 = publishHole(emptyCard(), 2, { entries: { alex: 5 } }, 1000);
  const resolved = makeResolution(ctxOf('dev-m', { 'dev-m': marcosV1, 'dev-g': guilleCard }), {
    roundId: 'r1', playerId: 'alex', hole: 2, value: 5, by: 'dev-m', ts: 3000,
  });
  const resolutions = { alex: { 2: resolved } };

  it('is resolved while both cards stay at their anchored versions', () => {
    const ctx = ctxOf('dev-m', { 'dev-m': marcosV1, 'dev-g': guilleCard }, { resolutions });
    expect(cellView(ctx, 'alex', 2).status).toBe('resolved');
  });

  it('a re-publication with a different value reopens the discrepancy', () => {
    const marcosV2 = publishHole(marcosV1, 2, { entries: { alex: 6 } }, 4000);
    expect(marcosV2.holes['2'].v).toBe(2);
    const ctx = ctxOf('dev-m', { 'dev-m': marcosV2, 'dev-g': guilleCard }, { resolutions });
    expect(cellView(ctx, 'alex', 2).status).toBe('discrepancy');
    expect(discrepancies(ctx, PLAYERS, HOLE_NUMBERS).map((d) => d.hole)).toEqual([2]);
  });

  it('a re-publication that matches the peer also lapses it, but leaves nothing to dispute', () => {
    const marcosV2 = publishHole(marcosV1, 2, { entries: { alex: 4 } }, 4000);
    const ctx = ctxOf('dev-m', { 'dev-m': marcosV2, 'dev-g': guilleCard }, { resolutions });
    const cell = cellView(ctx, 'alex', 2);
    expect(cell.resolution).toBe(null);
    expect(cell.status).toBe('agreed');
    expect(discrepancies(ctx, PLAYERS, HOLE_NUMBERS)).toEqual([]);
  });
});

describe('S9 — Finish over a full round', () => {
  const base = { alex: 4, bea: 5, marcos: 4, guille: 5 };
  let marcosCard = emptyCard();
  let guilleCard = emptyCard();
  for (const n of HOLE_NUMBERS) {
    marcosCard = publishHole(marcosCard, n, { entries: { ...base } }, 1000 + n);
    const entries = { ...base };
    if (n === 6) entries.alex = 6;
    if (n === 14) entries.bea = 3;
    if (n === 1) delete entries.guille;   // Guille never marked himself on hole 1
    guilleCard = publishHole(guilleCard, n, { entries }, 2000 + n);
  }
  const marcos = ctxOf('dev-m', { 'dev-m': marcosCard, 'dev-g': guilleCard });

  it('blocks on exactly the two holes that disagree', () => {
    expect(discrepancies(marcos, PLAYERS, HOLE_NUMBERS).map((d) => d.hole)).toEqual([6, 14]);
  });

  it('lists the cells only one scorer marked, which do not block', () => {
    expect(singleScorerCells(marcos, PLAYERS, HOLE_NUMBERS)).toEqual([
      { playerId: 'guille', hole: 1, scorerKey: 'dev-m', value: 5 },
    ]);
  });

  it('settles every agreed cell and stays provisional until the two are agreed', () => {
    const { scores, provisional } = settledScores(marcos, PLAYERS, HOLE_NUMBERS);
    expect(provisional).toBe(true);
    expect(scores.alex[6]).toBeUndefined();
    expect(scores.bea[14]).toBeUndefined();
    expect(scores.alex[7]).toBe(4);
  });
});

describe('S10 — two devices of one scorer are one scorer', () => {
  const scorer = { playerId: 'marcos', userId: 'u-m' };
  const cards = {
    'dev-m': { scorer, holes: { 4: { v: 1, entries: { alex: 5 }, ts: 1000 } } },
    'dev-m2': { scorer, holes: { 4: { v: 1, entries: { alex: 4 }, ts: 2000 } } },
  };
  const marcos = ctxOf('dev-m', cards);

  it('folds to the later publication and never disagrees with itself', () => {
    const cell = cellView(marcos, 'alex', 4);
    expect(cell.discrepancy).toBe(false);
    expect(cell.status).toBe('mine');
    expect(cell.shown).toBe(4);
    expect(cell.others).toEqual([]);
    expect(discrepancies(marcos, PLAYERS, HOLE_NUMBERS)).toEqual([]);
  });

  it('anchors a resolution on both devices', () => {
    const res = makeResolution(marcos, { roundId: 'r1', playerId: 'alex', hole: 4, value: 4, by: 'u-m', ts: 3000 });
    expect(res.basis).toEqual({ 'dev-m': 1, 'dev-m2': 1 });
    const resolved = ctxOf('dev-m', cards, { resolutions: { alex: { 4: res } } });
    expect(cellView(resolved, 'alex', 4).status).toBe('resolved');
  });
});

describe('S13 — four scorers, three against one', () => {
  const names = { 'dev-a': 'A', 'dev-b': 'B', 'dev-c': 'C', 'dev-d': 'D' };
  const cardFor = (value, ts) => publishHole(emptyCard(), 11, { entries: { alex: value } }, ts);
  const cards = {
    'dev-a': cardFor(4, 1000),
    'dev-b': cardFor(4, 2000),
    'dev-c': cardFor(4, 3000),
    'dev-d': cardFor(5, 4000),
  };
  const ctx = { myAuthorId: 'dev-a', cardsByAuthor: cards, resolutions: {}, draft: {}, names };

  it('shows one row carrying all four values', () => {
    const found = discrepancies(ctx, PLAYERS, HOLE_NUMBERS);
    expect(found).toHaveLength(1);
    expect(found[0].hole).toBe(11);
    expect(found[0].rows[0].values).toEqual([
      { scorerKey: 'dev-a', name: 'A', value: 4, ts: 1000 },
      { scorerKey: 'dev-b', name: 'B', value: 4, ts: 2000 },
      { scorerKey: 'dev-c', name: 'C', value: 4, ts: 3000 },
      { scorerKey: 'dev-d', name: 'D', value: 5, ts: 4000 },
    ]);
  });

  it('any scorer agreeing clears it, and any re-publication reopens it', () => {
    const res = makeResolution(ctx, { roundId: 'r1', playerId: 'alex', hole: 11, value: 4, by: 'dev-d', ts: 5000 });
    expect(res.basis).toEqual({ 'dev-a': 1, 'dev-b': 1, 'dev-c': 1, 'dev-d': 1 });
    const resolutions = { alex: { 11: res } };
    expect(cellView({ ...ctx, resolutions }, 'alex', 11).status).toBe('resolved');

    for (const authorId of Object.keys(cards)) {
      const reopened = {
        ...ctx,
        resolutions,
        cardsByAuthor: { ...cards, [authorId]: publishHole(cards[authorId], 11, { entries: { alex: 5 } }, 6000) },
      };
      expect(cellView(reopened, 'alex', 11).resolution).toBe(null);
      expect(discrepancies(reopened, PLAYERS, HOLE_NUMBERS)).toHaveLength(1);
    }
  });
});
