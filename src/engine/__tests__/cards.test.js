import {
  scorerKeyOf,
  isMarked,
  foldScorers,
  isResolutionValid,
  cellView,
  roundCells,
  shownScores,
  settledScores,
  discrepancies,
  unverifiedCells,
  singleScorerCells,
} from '../cards';
import { emptyCard, identifyScorer, publishHole, makeResolution } from '../publish';

const hole = (v, entries, ts) => ({ v, entries, ts });
const card = (holes, scorer = { playerId: null, userId: null }) => ({ scorer, holes });

// Marcos ('dev-m') and Guille ('dev-g'), one player 'p1', hole 3.
const twoScorers = (mine, theirs) => ({
  myAuthorId: 'dev-m',
  cardsByAuthor: {
    'dev-m': card({ 3: hole(1, { p1: mine }, 100) }),
    'dev-g': card({ 3: hole(1, { p1: theirs }, 200) }),
  },
  resolutions: {},
  draft: {},
  names: { 'dev-m': 'Marcos', 'dev-g': 'Guille' },
});

describe('scorerKeyOf', () => {
  it('prefers the signed-in user, falls back to the device', () => {
    expect(scorerKeyOf(card({}, { playerId: 'p1', userId: 'u-m' }), 'dev-m')).toBe('u-m');
    expect(scorerKeyOf(card({}), 'dev-m')).toBe('dev-m');
    expect(scorerKeyOf(undefined, 'dev-m')).toBe('dev-m');
  });
});

describe('isMarked', () => {
  it('only a finite number is an opinion', () => {
    expect(isMarked({ p1: 4 }, 'p1')).toBe(true);
    expect(isMarked({ p1: 0 }, 'p1')).toBe(true);
    expect(isMarked({ p1: null }, 'p1')).toBe(false);
    expect(isMarked({}, 'p1')).toBe(false);
    expect(isMarked(undefined, 'p1')).toBe(false);
    expect(isMarked({ p1: '4' }, 'p1')).toBe(false);
  });
});

describe('foldScorers', () => {
  it('keeps unrelated devices apart', () => {
    const folded = foldScorers({
      'dev-m': card({ 3: hole(1, { p1: 5 }, 100) }),
      'dev-g': card({ 3: hole(1, { p1: 4 }, 200) }),
    });
    expect(Object.keys(folded).sort()).toEqual(['dev-g', 'dev-m']);
    expect(folded['dev-m'].authorIds).toEqual(['dev-m']);
  });

  it('folds two devices of one scorer, later ts winning per hole', () => {
    const folded = foldScorers({
      'dev-m': card({ 3: hole(1, { p1: 5 }, 100), 4: hole(1, { p1: 3 }, 900) }, { playerId: 'm', userId: 'u-m' }),
      'dev-m2': card({ 3: hole(1, { p1: 4 }, 200) }, { playerId: 'm', userId: 'u-m' }),
    });
    expect(Object.keys(folded)).toEqual(['u-m']);
    expect(folded['u-m'].authorIds).toEqual(['dev-m', 'dev-m2']);
    expect(folded['u-m'].holes['3'].entries).toEqual({ p1: 4 });
    expect(folded['u-m'].holes['4'].entries).toEqual({ p1: 3 });
  });

  it('breaks a ts tie on the greater version', () => {
    const folded = foldScorers({
      'dev-m': card({ 3: hole(1, { p1: 5 }, 500) }, { playerId: 'm', userId: 'u-m' }),
      'dev-m2': card({ 3: hole(2, { p1: 4 }, 500) }, { playerId: 'm', userId: 'u-m' }),
    });
    expect(folded['u-m'].holes['3'].entries).toEqual({ p1: 4 });
  });

  it('ignores null cards', () => {
    expect(foldScorers({ 'dev-m': null })).toEqual({});
    expect(foldScorers(undefined)).toEqual({});
  });
});

describe('isResolutionValid', () => {
  const cards = {
    'dev-m': card({ 3: hole(1, { p1: 5 }, 100) }),
    'dev-g': card({ 3: hole(1, { p1: 4 }, 200) }),
  };
  const res = { roundId: 'r1', playerId: 'p1', hole: 3, value: 5, by: 'dev-g', ts: 300, basis: { 'dev-m': 1, 'dev-g': 1 } };

  it('is valid while every marking author is at its anchored version', () => {
    expect(isResolutionValid(res, cards)).toBe(true);
  });

  it('lapses when a scorer re-publishes the hole', () => {
    const bumped = { ...cards, 'dev-m': card({ 3: hole(2, { p1: 6 }, 400) }) };
    expect(isResolutionValid(res, bumped)).toBe(false);
  });

  it('lapses when a new author marks the cell', () => {
    const extra = { ...cards, 'dev-x': card({ 3: hole(1, { p1: 4 }, 400) }) };
    expect(isResolutionValid(res, extra)).toBe(false);
  });

  it('ignores basis entries for authors that no longer mark the cell', () => {
    const gone = { 'dev-m': cards['dev-m'], 'dev-g': card({ 3: hole(1, { p2: 4 }, 200) }) };
    expect(isResolutionValid(res, gone)).toBe(true);
  });

  it('is invalid when nobody marks the cell at all', () => {
    expect(isResolutionValid(res, {})).toBe(false);
    expect(isResolutionValid(null, cards)).toBe(false);
  });
});

describe('cellView', () => {
  it('treats a number and a string hole identically', () => {
    const ctx = twoScorers(5, 5);
    expect(cellView(ctx, 'p1', 3)).toEqual(cellView(ctx, 'p1', '3'));
    const strCtx = { ...ctx, draft: { 3: { entries: { p1: 7 } } } };
    const numCtx = { ...ctx, draft: { 3: { entries: { p1: 7 } } } };
    expect(cellView(strCtx, 'p1', '3').mine).toEqual(cellView(numCtx, 'p1', 3).mine);
  });

  it('reads my published entry when there is no draft', () => {
    const c = cellView(twoScorers(5, 5), 'p1', 3);
    expect(c.mine).toEqual({ value: 5, source: 'published' });
    expect(c.myPublished).toBe(5);
    expect(c.shown).toBe(5);
    expect(c.status).toBe('agreed');
  });

  it('lets the draft override my published entry', () => {
    const ctx = { ...twoScorers(5, 5), draft: { 3: { entries: { p1: 7 } } } };
    const c = cellView(ctx, 'p1', 3);
    expect(c.mine).toEqual({ value: 7, source: 'draft' });
    expect(c.myPublished).toBe(5);
    expect(c.shown).toBe(7);
  });

  it('a cleared draft value means no opinion, and falls through to peers', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: { 'dev-g': card({ 3: hole(1, { p1: 4 }, 200) }) },
      resolutions: {},
      draft: { 3: { entries: { p1: null } } },
    };
    const c = cellView(ctx, 'p1', 3);
    expect(c.mine).toEqual({ value: null, source: 'draft' });
    expect(c.shown).toBe(4);
  });

  it('never lets the draft create a discrepancy', () => {
    const ctx = { ...twoScorers(5, 5), draft: { 3: { entries: { p1: 9 } } } };
    expect(cellView(ctx, 'p1', 3).discrepancy).toBe(false);
  });

  it('orders others by ts descending', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: {
        'dev-m': card({ 3: hole(1, { p1: 4 }, 100) }),
        'dev-a': card({ 3: hole(1, { p1: 4 }, 50) }),
        'dev-b': card({ 3: hole(1, { p1: 4 }, 900) }),
      },
      resolutions: {},
      draft: {},
    };
    expect(cellView(ctx, 'p1', 3).others.map((o) => o.scorerKey)).toEqual(['dev-b', 'dev-a']);
  });

  it('flags a discrepancy between published cards and resolves it', () => {
    const ctx = twoScorers(5, 4);
    expect(cellView(ctx, 'p1', 3).status).toBe('discrepancy');
    const resolved = {
      ...ctx,
      resolutions: { p1: { 3: makeResolution(ctx, { roundId: 'r1', playerId: 'p1', hole: 3, value: 5, by: 'dev-g', ts: 300 }) } },
    };
    const c = cellView(resolved, 'p1', 3);
    expect(c.status).toBe('resolved');
    expect(c.shown).toBe(5);
    expect(c.discrepancy).toBe(false);
  });

  it('is unverified when only a peer has marked it', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: { 'dev-m': emptyCard(), 'dev-g': card({ 3: hole(1, { p1: 4 }, 200) }) },
      resolutions: {},
      draft: {},
    };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('unverified');
    expect(c.mine).toBe(null);
    expect(c.shown).toBe(4);
  });

  it('is mine when only I marked it', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: { 'dev-m': card({ 3: hole(1, { p1: 4 }, 200) }) },
      resolutions: {},
      draft: {},
    };
    expect(cellView(ctx, 'p1', 3).status).toBe('mine');
  });

  it('is mine when my draft stands over an already-published peer', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: { 'dev-m': emptyCard(), 'dev-g': card({ 3: hole(1, { p1: 4 }, 200) }) },
      resolutions: {},
      draft: { 3: { entries: { p1: 6 } } },
    };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('mine');
    expect(c.shown).toBe(6);
  });

  it('is empty when nobody has an opinion', () => {
    const ctx = { myAuthorId: 'dev-m', cardsByAuthor: { 'dev-m': emptyCard() }, resolutions: {}, draft: {} };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('empty');
    expect(c.shown).toBe(null);
  });
});

describe('roundCells / shownScores', () => {
  it('keys by player then by string hole', () => {
    const cells = roundCells(twoScorers(5, 5), ['p1'], [3, 4]);
    expect(Object.keys(cells)).toEqual(['p1']);
    expect(Object.keys(cells.p1)).toEqual(['3', '4']);
    expect(cells.p1['4'].status).toBe('empty');
  });

  it('shownScores drops empty cells and empty players', () => {
    expect(shownScores(twoScorers(5, 5), ['p1', 'p2'], [3, 4])).toEqual({ p1: { 3: 5 } });
  });
});

describe('settledScores', () => {
  it('settles on agreement and is not provisional', () => {
    expect(settledScores(twoScorers(5, 5), ['p1'], [3])).toEqual({ scores: { p1: { 3: 5 } }, provisional: false });
  });

  it('leaves a disagreement unsettled and provisional', () => {
    expect(settledScores(twoScorers(5, 4), ['p1'], [3])).toEqual({ scores: {}, provisional: true });
  });

  it('settles a single scorer but flags it provisional', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: { 'dev-m': card({ 3: hole(1, { p1: 5 }, 100) }) },
      resolutions: {},
      draft: {},
    };
    expect(settledScores(ctx, ['p1'], [3])).toEqual({ scores: { p1: { 3: 5 } }, provisional: true });
  });

  it('ignores my unpublished draft', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: { 'dev-m': emptyCard() },
      resolutions: {},
      draft: { 3: { entries: { p1: 5 } } },
    };
    expect(settledScores(ctx, ['p1'], [3])).toEqual({ scores: {}, provisional: false });
  });
});

describe('discrepancies', () => {
  it('groups by hole with one row per player, values oldest first and named', () => {
    const ctx = twoScorers(5, 4);
    expect(discrepancies(ctx, ['p1'], [3, 4])).toEqual([
      {
        hole: 3,
        rows: [
          {
            playerId: 'p1',
            values: [
              { scorerKey: 'dev-m', name: 'Marcos', value: 5, ts: 100 },
              { scorerKey: 'dev-g', name: 'Guille', value: 4, ts: 200 },
            ],
          },
        ],
      },
    ]);
  });

  it('leaves the name null when the scorer is unknown', () => {
    const ctx = { ...twoScorers(5, 4), names: undefined };
    expect(discrepancies(ctx, ['p1'], [3])[0].rows[0].values[0].name).toBe(null);
  });
});

describe('unverifiedCells / singleScorerCells', () => {
  const ctx = {
    myAuthorId: 'dev-m',
    cardsByAuthor: {
      'dev-m': card({ 3: hole(1, { p1: 5 }, 100) }),
      'dev-g': card({ 3: hole(1, { p2: 4 }, 200) }),
    },
    resolutions: {},
    draft: {},
  };

  it('lists the cells only a peer marked', () => {
    expect(unverifiedCells(ctx, ['p1', 'p2'], [3])).toEqual([
      { playerId: 'p2', hole: 3, scorerKey: 'dev-g', value: 4 },
    ]);
  });

  it('lists every cell exactly one scorer marked, mine included', () => {
    expect(singleScorerCells(ctx, ['p1', 'p2'], [3])).toEqual([
      { playerId: 'p1', hole: 3, scorerKey: 'dev-m', value: 5 },
      { playerId: 'p2', hole: 3, scorerKey: 'dev-g', value: 4 },
    ]);
  });

  it('drops a single-scorer cell that carries a valid resolution', () => {
    const resolved = {
      ...ctx,
      resolutions: { p1: { 3: makeResolution(ctx, { roundId: 'r1', playerId: 'p1', hole: 3, value: 5, by: 'dev-m', ts: 300 }) } },
    };
    expect(singleScorerCells(resolved, ['p1', 'p2'], [3]).map((c) => c.playerId)).toEqual(['p2']);
  });
});

describe('publishHole', () => {
  it('bumps the version and drops blanks, without mutating the input', () => {
    const before = emptyCard();
    const after = publishHole(before, 3, { entries: { p1: 5, p2: null, p3: undefined } }, 100);
    expect(before.holes).toEqual({});
    expect(after.holes['3']).toEqual({ v: 1, entries: { p1: 5 }, ts: 100 });
    const again = publishHole(after, 3, { entries: { p1: 6 } }, 200);
    expect(again.holes['3']).toEqual({ v: 2, entries: { p1: 6 }, ts: 200 });
    expect(after.holes['3'].v).toBe(1);
  });

  it('carries shot detail through when present', () => {
    const after = publishHole(emptyCard(), '3', { entries: { p1: 5 }, shots: { p1: { putts: 2 } } }, 100);
    expect(after.holes['3'].shots).toEqual({ p1: { putts: 2 } });
  });

  it('is a no-op when there is nothing to publish and nothing published before', () => {
    const before = emptyCard();
    expect(publishHole(before, 3, { entries: { p1: null } }, 100)).toBe(before);
  });

  it('publishes an empty hole when the scorer cleared a published one', () => {
    const first = publishHole(emptyCard(), 3, { entries: { p1: 5 } }, 100);
    const cleared = publishHole(first, 3, { entries: { p1: null } }, 200);
    expect(cleared.holes['3']).toEqual({ v: 2, entries: {}, ts: 200 });
  });

  it('treats a number and a string hole identically', () => {
    expect(publishHole(emptyCard(), 3, { entries: { p1: 5 } }, 100))
      .toEqual(publishHole(emptyCard(), '3', { entries: { p1: 5 } }, 100));
  });
});

describe('makeResolution / identifyScorer', () => {
  it('anchors the basis on every marking device', () => {
    const ctx = {
      myAuthorId: 'dev-m',
      cardsByAuthor: {
        'dev-m': card({ 3: hole(2, { p1: 5 }, 100) }),
        'dev-g': card({ 3: hole(1, { p1: 4 }, 200) }),
        'dev-x': card({ 3: hole(1, { p2: 4 }, 200) }),
      },
    };
    const res = makeResolution(ctx, { roundId: 'r1', playerId: 'p1', hole: 3, value: 5, by: 'dev-g', ts: 300 });
    expect(res.basis).toEqual({ 'dev-m': 2, 'dev-g': 1 });
    expect(isResolutionValid(res, ctx.cardsByAuthor)).toBe(true);
  });

  it('throws when nobody marks the cell', () => {
    expect(() => makeResolution({ cardsByAuthor: {} }, { roundId: 'r1', playerId: 'p1', hole: 3, value: 5, by: 'x', ts: 1 }))
      .toThrow(/nothing to resolve/);
  });

  it('stamps the scorer without touching the holes', () => {
    const c = publishHole(emptyCard(), 3, { entries: { p1: 5 } }, 100);
    const named = identifyScorer(c, { playerId: 'marcos', userId: 'u-m' });
    expect(named.scorer).toEqual({ playerId: 'marcos', userId: 'u-m' });
    expect(named.holes).toEqual(c.holes);
    expect(c.scorer).toEqual({ playerId: null, userId: null });
  });
});

describe('cellView — draft vs published status (review fixes)', () => {
  const hole = (v, entries, ts) => ({ v, entries, ts });
  const card = (holes) => ({ scorer: { playerId: null, userId: null }, holes });
  const base = () => ({
    myAuthorId: 'dev-m',
    cardsByAuthor: {
      'dev-m': card({ 3: hole(1, { p1: 5 }, 100) }),
      'dev-g': card({ 3: hole(1, { p1: 5 }, 200) }),
    },
    resolutions: {},
    draft: {},
  });

  it('a cleared draft over my published value with no peers is empty, not agreed', () => {
    const ctx = base();
    delete ctx.cardsByAuthor['dev-g'];
    ctx.draft = { 3: { entries: { p1: null } } };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('empty');
    expect(c.shown).toBe(null);
  });

  it('a cleared draft with a peer value falls back to the peer as unverified', () => {
    const ctx = base();
    ctx.draft = { 3: { entries: { p1: null } } };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('unverified');
    expect(c.shown).toBe(5);
  });

  it('a draft that differs from my published entry is pending mine, not agreed', () => {
    const ctx = base();
    ctx.draft = { 3: { entries: { p1: 6 } } };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('mine');
    expect(c.shown).toBe(6);
    expect(c.discrepancy).toBe(false); // the draft never disputes anything
  });

  it('a draft equal to a standing agreement keeps the resolved status', () => {
    const ctx = base();
    ctx.cardsByAuthor['dev-g'] = card({ 3: hole(1, { p1: 4 }, 200) });
    ctx.resolutions = { p1: { 3: { roundId: 'r0', playerId: 'p1', hole: 3, value: 4, by: 'dev-g', ts: 300, basis: { 'dev-m': 1, 'dev-g': 1 } } } };
    expect(cellView(ctx, 'p1', 3).status).toBe('resolved');
    ctx.draft = { 3: { entries: { p1: 4 } } };
    expect(cellView(ctx, 'p1', 3).status).toBe('resolved');
    ctx.draft = { 3: { entries: { p1: 6 } } };
    const c = cellView(ctx, 'p1', 3);
    expect(c.status).toBe('mine');
    expect(c.shown).toBe(6);
  });
});

describe('publishHole — shot detail alone is worth a version', () => {
  it('publishes a hole that carries shots but no strokes', () => {
    const card = publishHole(emptyCard(), 7, { entries: {}, shots: { p1: { club: 'D' } } }, 100);
    expect(card.holes['7']).toEqual({ v: 1, entries: {}, shots: { p1: { club: 'D' } }, ts: 100 });
  });

  it('still skips a hole with nothing at all', () => {
    const card = emptyCard();
    expect(publishHole(card, 7, { entries: {}, shots: {} }, 100)).toBe(card);
  });
});
