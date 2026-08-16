// Regression tests for the 2026-08-16 solo-round phantom conflicts: one
// phone stamped entries under both its roster meId and its device author id
// (the `meId ?? getDeviceAuthorId()` fallback), and the two ids then
// "conflicted" with each other. Passing `localAuthorIds` folds this phone's
// identities into one author before any conflict derivation — a device can
// never disagree with itself.
import {
  deriveCell, listRoundConflicts, roundHasConflicts, surfaceableConflicts,
  authorScores, holeEntryMismatches,
} from '../scoreEntries';

const ME = 'me-uuid';
const DEV = 'dev-abc123';
const LOCAL = [ME, DEV];

const round = (scoreEntries = {}, scoreResolutions = {}) => ({
  id: 'r0', scoreEntries, scoreResolutions,
});

describe('deriveCell with localAuthorIds', () => {
  test('meId + device id with different values -> no conflict, newest wins', () => {
    const r = round({ p1: { 11: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 6, ts: 20 } } } });
    // Without folding this is the phantom "Someone entered 5" conflict.
    expect(deriveCell(r, 'p1', 11).status).toBe('conflict');
    const d = deriveCell(r, 'p1', 11, LOCAL);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(6);
    expect(d.candidates).toEqual([{ value: 6, ts: 20, authorId: ME }]);
  });

  test('older meId entry loses to newer device entry', () => {
    const r = round({ p1: { 3: { [ME]: { value: 4, ts: 10 }, [DEV]: { value: 5, ts: 30 } } } });
    const d = deriveCell(r, 'p1', 3, LOCAL);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(5);
  });

  test('ts tie prefers the earlier-listed id (meId)', () => {
    const r = round({ p1: { 3: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 4, ts: 10 } } } });
    const d = deriveCell(r, 'p1', 3, LOCAL);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(4);
  });

  test('clearing under meId also clears a stale device-id value (ghost-score resurrection)', () => {
    // The 2026-08-16 hole-10 shape: cleared under meId, but the phantom
    // device entry kept the old value effective.
    const r = round({ p1: { 10: { [DEV]: { value: 7, ts: 10 }, [ME]: { value: null, ts: 20 } } } });
    expect(deriveCell(r, 'p1', 10).status).toBe('agreed'); // unfolded: dev value survives
    expect(deriveCell(r, 'p1', 10).effective).toBe(7);
    const d = deriveCell(r, 'p1', 10, LOCAL);
    expect(d.status).toBe('empty');
    expect(d.effective).toBe(null);
  });

  test('a genuinely foreign author still conflicts', () => {
    const r = round({ p1: { 3: {
      [ME]: { value: 4, ts: 30 },
      [DEV]: { value: 4, ts: 10 },
      peer: { value: 6, ts: 20 },
    } } });
    const d = deriveCell(r, 'p1', 3, LOCAL);
    expect(d.status).toBe('conflict');
    expect(d.candidates).toEqual([
      { value: 6, ts: 20, authorId: 'peer' },
      { value: 4, ts: 30, authorId: ME },
    ]);
  });

  test('the incident shape: resolved cell with a stale phantom stays resolved', () => {
    // 2026-08-16 h11: dev entry from early in the round, meId correction at
    // the end, resolution seconds after. Fold keeps the meId entry (newest),
    // and the resolution outranks it — the conflict cannot resurface.
    const r = round(
      { p1: { 11: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 6, ts: 30 } } } },
      { p1: { 11: { value: 6, by: ME, ts: 40 } } },
    );
    const d = deriveCell(r, 'p1', 11, LOCAL);
    expect(d.status).toBe('resolved');
    expect(d.effective).toBe(6);
  });

  test('a local write newer than the resolution re-opens with that value, never a conflict', () => {
    // Same-author "edit after resolving" semantics extend to the folded
    // group: the newest local entry (here the device id) wins the fold, its
    // ts invalidates the older resolution, and the single surviving author
    // derives as agreed — a phone still cannot conflict with itself.
    const r = round(
      { p1: { 17: { [ME]: { value: 4, ts: 10 }, [DEV]: { value: 5, ts: 40 } } } },
      { p1: { 17: { value: 4, by: ME, ts: 30 } } },
    );
    expect(deriveCell(r, 'p1', 17).status).toBe('conflict'); // unfolded: phantom conflict
    const d = deriveCell(r, 'p1', 17, LOCAL);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(5);
  });

  test('omitting localAuthorIds keeps the raw two-author view', () => {
    const r = round({ p1: { 3: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 6, ts: 20 } } } });
    expect(deriveCell(r, 'p1', 3).status).toBe('conflict');
  });
});

describe('round aggregates with localAuthorIds', () => {
  const r = round({
    p1: { 11: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 6, ts: 20 } } },
    p2: { 15: { [ME]: { value: 7, ts: 10 }, peer: { value: 5, ts: 20 } } },
  });

  test('listRoundConflicts folds local ids, keeps real conflicts', () => {
    expect(listRoundConflicts(r)).toEqual([
      { playerId: 'p1', hole: 11 }, { playerId: 'p2', hole: 15 },
    ]);
    expect(listRoundConflicts(r, LOCAL)).toEqual([{ playerId: 'p2', hole: 15 }]);
    expect(roundHasConflicts(r, LOCAL)).toBe(true);
  });

  test('surfaceableConflicts threads localAuthorIds through', () => {
    // Every author past the hole -> surfaceable; only the real conflict shows.
    const presence = { [ME]: 18, [DEV]: 18, peer: 18 };
    expect(surfaceableConflicts(r, presence, LOCAL)).toEqual([{ playerId: 'p2', hole: 15 }]);
  });
});

describe('authorScores / holeEntryMismatches with id arrays', () => {
  test('authorScores unions this phone\'s ids, newest entry wins a cell', () => {
    const r = round({
      p1: {
        3: { [DEV]: { value: 5, ts: 10 } },
        4: { [DEV]: { value: 4, ts: 10 }, [ME]: { value: 6, ts: 20 } },
        5: { [ME]: { value: 3, ts: 10 }, peer: { value: 4, ts: 20 } },
      },
    });
    expect(authorScores(r, LOCAL)).toEqual({ p1: { 3: 5, 4: 6, 5: 3 } });
    // Single-id string form unchanged.
    expect(authorScores(r, ME)).toEqual({ p1: { 4: 6, 5: 3 } });
  });

  test('a newest local blank keeps the cell off my card', () => {
    const r = round({ p1: { 10: { [DEV]: { value: 7, ts: 10 }, [ME]: { value: null, ts: 20 } } } });
    expect(authorScores(r, LOCAL)).toEqual({});
  });

  test('holeEntryMismatches never reports my own device entry as an "other"', () => {
    const r = round({ p1: { 11: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 6, ts: 20 } } } });
    const mine = authorScores(r, LOCAL);
    expect(holeEntryMismatches(r, 11, LOCAL, mine)).toEqual([]);
    // A real peer disagreement still mismatches.
    const r2 = round({ p1: { 11: { [DEV]: { value: 5, ts: 10 }, [ME]: { value: 6, ts: 20 }, peer: { value: 4, ts: 15 } } } });
    expect(holeEntryMismatches(r2, 11, LOCAL, authorScores(r2, LOCAL))).toEqual([
      { playerId: 'p1', mine: 6, others: [{ authorId: 'peer', value: 4 }] },
    ]);
  });
});
