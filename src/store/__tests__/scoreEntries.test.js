import { cellEntries, deriveCell } from '../scoreEntries';
import {
  activeAuthors, listRoundConflicts, roundHasConflicts,
  authorProgress, isCellSurfaceable, surfaceableConflicts,
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

  test('a conflict is not surfaceable until every active author is past the hole', () => {
    const r = conflicted();
    // author b is still on hole 3 (progress 3, not > 3)
    expect(isCellSurfaceable(r, 3, { a: 5, b: 3 })).toBe(false);
    expect(isCellSurfaceable(r, 3, { a: 5, b: 4 })).toBe(true);
    expect(surfaceableConflicts(r, { a: 5, b: 3 })).toEqual([]);
    expect(surfaceableConflicts(r, { a: 5, b: 4 })).toEqual([{ playerId: 'p1', hole: 3 }]);
  });
});
