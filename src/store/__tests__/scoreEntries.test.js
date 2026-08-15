import { cellEntries, deriveCell } from '../scoreEntries';
import {
  activeAuthors, listRoundConflicts, roundHasConflicts,
  authorProgress, isCellSurfaceable, surfaceableConflicts,
  authorScores, holeEntryMismatches,
} from '../scoreEntries';

const round = (scoreEntries = {}, scoreResolutions = {}) => ({
  id: 'r0', scoreEntries, scoreResolutions,
});

describe('cellEntries', () => {
  test('returns the author map for a cell, or {} when absent', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 } } } });
    expect(cellEntries(r, 'p1', 3)).toEqual({ a: { value: 4, ts: 10 } });
    expect(cellEntries(r, 'p1', 5)).toEqual({});
    expect(cellEntries(round(), 'p1', 3)).toEqual({});
  });
});

describe('deriveCell', () => {
  test('no entries -> empty', () => {
    expect(deriveCell(round(), 'p1', 3)).toEqual({
      status: 'empty', effective: null, candidates: [], blankAuthors: [],
    });
  });

  test('all authors agree -> agreed, no conflict', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 4, ts: 12 } } } });
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(4);
    expect(d.candidates).toEqual([{ value: 4, ts: 12, authorId: 'b' }]);
    expect(d.blankAuthors).toEqual([]);
  });

  test('blank from one author + number from another -> agreed, fills in, no conflict', () => {
    const r = round({ p1: { 3: { a: { value: null, ts: 20 }, b: { value: 5, ts: 12 } } } });
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(5);
    expect(d.blankAuthors).toEqual(['a']);
  });

  test('two different non-null values -> conflict, effective is most recent', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } } });
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('conflict');
    expect(d.effective).toBe(5);
    expect(d.candidates).toEqual([
      { value: 4, ts: 10, authorId: 'a' },
      { value: 5, ts: 20, authorId: 'b' },
    ]);
  });

  test('self-correction clears the conflict', () => {
    const r = round({ p1: { 3: { a: { value: 5, ts: 30 }, b: { value: 5, ts: 20 } } } });
    expect(deriveCell(r, 'p1', 3).status).toBe('agreed');
  });

  test('resolution newer than all entries -> resolved with the picked value', () => {
    const r = round(
      { p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } } },
      { p1: { 3: { value: 4, by: 'a', ts: 25 } } },
    );
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('resolved');
    expect(d.effective).toBe(4);
  });

  test('a new edit after resolution re-opens the conflict', () => {
    const r = round(
      { p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 6, ts: 40 } } } },
      { p1: { 3: { value: 4, by: 'a', ts: 25 } } },
    );
    expect(deriveCell(r, 'p1', 3).status).toBe('conflict');
  });
});

describe('conflict listing + gate', () => {
  const conflicted = () => round({
    p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } },
    p2: { 1: { a: { value: 3, ts: 5 } } },
  });

  test('activeAuthors spans the whole round', () => {
    expect(activeAuthors(conflicted())).toEqual(new Set(['a', 'b']));
  });

  test('listRoundConflicts returns only conflict cells, ascending', () => {
    expect(listRoundConflicts(conflicted())).toEqual([{ playerId: 'p1', hole: 3 }]);
    expect(roundHasConflicts(conflicted())).toBe(true);
  });

  test('authorProgress uses max(presence, highest entered hole)', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 } }, 7: { a: { value: 4, ts: 10 } } } });
    expect(authorProgress(r, { a: 2 })).toEqual({ a: 7 });   // entries win
    expect(authorProgress(r, { a: 9 })).toEqual({ a: 9 });   // presence wins
  });

  test('a conflict is not surfaceable until every author who wrote on that hole is past it', () => {
    const r = conflicted();
    // author b is still on hole 3 (progress 3, not > 3)
    expect(isCellSurfaceable(r, 3, { a: 5, b: 3 })).toBe(false);
    expect(isCellSurfaceable(r, 3, { a: 5, b: 4 })).toBe(true);
    expect(surfaceableConflicts(r, { a: 5, b: 3 })).toEqual([]);
    expect(surfaceableConflicts(r, { a: 5, b: 4 })).toEqual([{ playerId: 'p1', hole: 3 }]);
  });

  test('gating is per-hole: a stalled author who never wrote to this hole does not suppress it', () => {
    // c wrote only on holes 1-5 and then stopped; a and b conflict on hole 8
    // and have both moved past it. c's stale progress must not gate hole 8.
    const r = round({
      p1: {
        1: { c: { value: 4, ts: 1 } },
        5: { c: { value: 4, ts: 5 } },
        8: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } },
      },
    });
    expect(isCellSurfaceable(r, 8, { a: 9, b: 9, c: 5 })).toBe(true);
  });

  test('an author still on the hole (mid-correction) keeps suppressing it (anti-flash guard)', () => {
    const r = round({
      p1: { 8: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } },
    });
    // b's progress is exactly 8 (not > 8): still on the hole.
    expect(isCellSurfaceable(r, 8, { a: 9, b: 8 })).toBe(false);
  });

  test('no author wrote anything on this hole -> not surfaceable', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 } } } });
    expect(isCellSurfaceable(r, 8, { a: 9 })).toBe(false);
  });
});

describe('authorScores', () => {
  const entries = () => round({
    p1: {
      3: { me: { value: 4, ts: 10 }, peer: { value: 5, ts: 12 } },
      4: { peer: { value: 6, ts: 20 } },
    },
    p2: { 3: { me: { value: null, ts: 15 }, peer: { value: 3, ts: 9 } } },
  });

  test('returns only the given author\'s non-blank entries, never peers\'', () => {
    expect(authorScores(entries(), 'me')).toEqual({ p1: { 3: 4 } });
  });

  test('a blank entry from the author stays blank even when a peer scored it', () => {
    expect(authorScores(entries(), 'me').p2).toBeUndefined();
  });

  test('overlays still-dirty local edits on top of authored entries', () => {
    const local = { p1: { 3: 7 }, p2: { 4: 5 } };
    const out = authorScores(entries(), 'me', local, new Set(['p1:3', 'p2:4']));
    expect(out.p1[3]).toBe(7);       // in-flight edit wins over round-tripped entry
    expect(out.p2[4]).toBe(5);       // brand-new local cell appears
  });

  test('a dirty local clear removes the authored value', () => {
    const out = authorScores(entries(), 'me', { p1: {} }, new Set(['p1:3']));
    expect(out.p1?.[3]).toBeUndefined();
  });

  test('empty round -> empty map', () => {
    expect(authorScores(round(), 'me')).toEqual({});
  });
});

describe('holeEntryMismatches', () => {
  test('flags a cell where my value disagrees with another author', () => {
    const r = round({ p1: { 3: { me: { value: 4, ts: 10 }, peer: { value: 5, ts: 12 } } } });
    const mine = authorScores(r, 'me');
    expect(holeEntryMismatches(r, 3, 'me', mine)).toEqual([
      { playerId: 'p1', mine: 4, others: [{ authorId: 'peer', value: 5 }] },
    ]);
  });

  test('no mismatch when I have not entered a score for that player', () => {
    const r = round({ p1: { 3: { peer: { value: 5, ts: 12 } } } });
    expect(holeEntryMismatches(r, 3, 'me', authorScores(r, 'me'))).toEqual([]);
  });

  test('no mismatch when authors agree, or when the peer entry is blank', () => {
    const agreed = round({ p1: { 3: { me: { value: 4, ts: 10 }, peer: { value: 4, ts: 12 } } } });
    expect(holeEntryMismatches(agreed, 3, 'me', authorScores(agreed, 'me'))).toEqual([]);
    const peerBlank = round({ p1: { 3: { me: { value: 4, ts: 10 }, peer: { value: null, ts: 12 } } } });
    expect(holeEntryMismatches(peerBlank, 3, 'me', authorScores(peerBlank, 'me'))).toEqual([]);
  });

  test('a validly resolved cell never mismatches', () => {
    const r = round(
      { p1: { 3: { me: { value: 4, ts: 10 }, peer: { value: 5, ts: 12 } } } },
      { p1: { 3: { value: 5, by: 'peer', ts: 20 } } },
    );
    expect(holeEntryMismatches(r, 3, 'me', authorScores(r, 'me'))).toEqual([]);
  });

  test('a dirty local edit is compared, not the stale authored value', () => {
    const r = round({ p1: { 3: { me: { value: 5, ts: 10 }, peer: { value: 5, ts: 12 } } } });
    const mine = authorScores(r, 'me', { p1: { 3: 6 } }, new Set(['p1:3']));
    expect(holeEntryMismatches(r, 3, 'me', mine)).toEqual([
      { playerId: 'p1', mine: 6, others: [{ authorId: 'peer', value: 5 }] },
    ]);
  });

  test('only checks the requested hole', () => {
    const r = round({ p1: {
      3: { me: { value: 4, ts: 10 }, peer: { value: 5, ts: 12 } },
      4: { me: { value: 4, ts: 10 }, peer: { value: 4, ts: 12 } },
    } });
    expect(holeEntryMismatches(r, 4, 'me', authorScores(r, 'me'))).toEqual([]);
  });
});
