import { mergeTournaments, getAtPath, setAtPath } from '../merge';

describe('mergeTournaments — trivial cases', () => {
  it('returns local untouched when there is no remote', () => {
    const local = { id: 't1', name: 'Local' };
    expect(mergeTournaments(local, null)).toEqual({ merged: local, conflicts: [] });
  });

  it('returns remote untouched when there is no local', () => {
    const remote = { id: 't1', name: 'Remote' };
    expect(mergeTournaments(null, remote)).toEqual({ merged: remote, conflicts: [] });
  });
});

describe('mergeTournaments — last-write-wins', () => {
  it('keeps the local value when its timestamp is newer', () => {
    const local = { id: 't1', name: 'Local', _meta: { name: 200 } };
    const remote = { id: 't1', name: 'Remote', _meta: { name: 100 } };
    const { merged, conflicts } = mergeTournaments(local, remote);
    expect(merged.name).toBe('Local');
    expect(conflicts).toHaveLength(0);
  });

  it('breaks ties in favour of local (it has the in-flight mutation)', () => {
    const local = { id: 't1', name: 'Local', _meta: { name: 100 } };
    const remote = { id: 't1', name: 'Remote', _meta: { name: 100 } };
    expect(mergeTournaments(local, remote).merged.name).toBe('Local');
  });

  it('lets remote win when its timestamp is newer', () => {
    const local = { id: 't1', name: 'Local', _meta: { name: 100 } };
    const remote = { id: 't1', name: 'Remote', _meta: { name: 200 } };
    expect(mergeTournaments(local, remote).merged.name).toBe('Remote');
  });

  it('records a conflict only when both sides wrote the same path', () => {
    const local = { id: 't1', name: 'Local', _meta: { name: 100 } };
    const remote = { id: 't1', name: 'Remote', _meta: { name: 200 } };
    const { conflicts } = mergeTournaments(local, remote);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      path: 'name',
      localTs: 100,
      remoteTs: 200,
      winnerValue: 'Remote',
      losingValue: 'Local',
      tournamentId: 't1',
    });
  });

  it('does not flag a conflict when only one side has a timestamp', () => {
    // remote wins (no local ts) but local never wrote this path → no conflict
    const local = { id: 't1', name: 'Local' };
    const remote = { id: 't1', name: 'Remote', _meta: { name: 200 } };
    const { merged, conflicts } = mergeTournaments(local, remote);
    expect(merged.name).toBe('Remote');
    expect(conflicts).toHaveLength(0);
  });
});

describe('mergeTournaments — round-scoped score paths', () => {
  it('preserves a local score edit at an h-prefixed hole path', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    const remote = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 9 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(4);
  });
});

describe('mergeTournaments — deletion tombstones', () => {
  it('drops a round that carries a _deleted tombstone', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r2' }],
      _meta: { 'rounds.r1._deleted': 300 },
    };
    const remote = {
      id: 't1',
      rounds: [{ id: 'r1' }, { id: 'r2' }],
      _meta: {},
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds.map((r) => r.id)).toEqual(['r2']);
  });
});

describe('mergeTournaments — score conflict markers', () => {
  it('keeps the local value (always-mine) and writes a marker with mine first', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    const remote = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(4); // local always wins, regardless of ts
    const marker = merged.rounds[0].scoreConflicts.p1['5'];
    expect(marker.candidates).toEqual([
      { value: 4, ts: 100 },
      { value: 6, ts: 200 },
    ]);
    expect(typeof marker.detectedAt).toBe('number');
    expect(merged._meta['rounds.r1.scoreConflicts.p1.h5']).toBe(marker.detectedAt);
  });

  it('writes no marker when both devices wrote the same value', () => {
    const local = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    expect(mergeTournaments(local, remote).merged.rounds[0].scoreConflicts).toBeUndefined();
  });

  it('writes no marker when only one device ever wrote the cell', () => {
    const local = { id: 't1', rounds: [{ id: 'r1', scores: {} }] };
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    expect(mergeTournaments(local, remote).merged.rounds[0].scoreConflicts).toBeUndefined();
  });

  it('a stale remote marker-clear stamp does not spuriously re-flag my raw write', () => {
    // Local wrote 4 @ 100, no resolution stamp of its own.
    const local = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    // Remote wrote 6 @ 500 and its marker-clear stamp (500) covers that write,
    // but carries no scoreResolutions stamp — so it does not outrank the local
    // raw write. Always-mine keeps the local value; the marker-clear coverage
    // means no NEW marker is spuriously created either.
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: {
        'rounds.r1.scores.p1.h5': 500,
        'rounds.r1.scoreConflicts.p1.h5': 500,
      },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(4);
    expect(merged.rounds[0].scoreConflicts).toBeUndefined();
  });

  it('clears a marker when the local resolve is newer than a stale remote marker', () => {
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: {
        'rounds.r1.scores.p1.h5': 500,
        'rounds.r1.scoreConflicts.p1.h5': 500,
      },
    };
    const remote = {
      id: 't1',
      rounds: [{
        id: 'r1',
        scores: { p1: { 5: 4 } },
        scoreConflicts: {
          p1: { 5: { candidates: [{ value: 6, ts: 200 }, { value: 4, ts: 100 }], detectedAt: 300 } },
        },
      }],
      _meta: {
        'rounds.r1.scores.p1.h5': 100,
        'rounds.r1.scoreConflicts.p1.h5': 300,
      },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(6);
    expect(merged.rounds[0].scoreConflicts.p1['5']).toBeUndefined();
  });

  it('excludes scoreConflicts paths from the conflicts log', () => {
    const marker = (ts) => ({
      candidates: [{ value: 6, ts: 200 }, { value: 4, ts: 100 }], detectedAt: ts,
    });
    const local = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } }, scoreConflicts: { p1: { 5: marker(300) } } }],
      _meta: { 'rounds.r1.scoreConflicts.p1.h5': 300 },
    };
    const remote = {
      id: 't1',
      rounds: [{ id: 'r1', scores: { p1: { 5: 6 } }, scoreConflicts: { p1: { 5: marker(400) } } }],
      _meta: { 'rounds.r1.scoreConflicts.p1.h5': 400 },
    };
    expect(mergeTournaments(local, remote).conflicts).toHaveLength(0);
  });

  it('writes a marker even when one competing value is 0', () => {
    const local = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 0 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 3 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 200 },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(0); // local always wins
    expect(merged.rounds[0].scoreConflicts.p1['5'].candidates).toEqual([
      { value: 0, ts: 100 },
      { value: 3, ts: 200 },
    ]);
  });
});

describe('path helpers', () => {
  it('getAtPath resolves rounds by id and holes by h-prefix', () => {
    const obj = { rounds: [{ id: 'r1', scores: { p1: { 7: 3 } } }] };
    expect(getAtPath(obj, 'rounds.r1.scores.p1.h7')).toBe(3);
  });

  it('getAtPath returns undefined for a missing path', () => {
    expect(getAtPath({ rounds: [] }, 'rounds.rX.scores')).toBeUndefined();
  });

  it('setAtPath writes through an h-prefixed hole path', () => {
    const obj = { rounds: [{ id: 'r1', scores: { p1: { 7: 3 } } }] };
    setAtPath(obj, 'rounds.r1.scores.p1.h7', 5);
    expect(obj.rounds[0].scores.p1['7']).toBe(5);
  });
});

describe('mergeTournaments — always-mine score cells', () => {
  const cell = 'rounds.r1.scores.p1.h3';
  const marker = 'rounds.r1.scoreConflicts.p1.h3';
  const resolution = 'rounds.r1.scoreResolutions.p1.h3';
  const t = ({ score, meta, conflicts, resolutions }) => ({
    id: 't1',
    rounds: [{
      id: 'r1',
      scores: score === undefined ? {} : { p1: { 3: score } },
      ...(conflicts ? { scoreConflicts: conflicts } : {}),
      ...(resolutions ? { scoreResolutions: resolutions } : {}),
    }],
    _meta: meta ?? {},
  });

  it('keeps the LOCAL value even when remote ts is higher (clock skew)', () => {
    const local = t({ score: 5, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(5);
  });

  it('creates a marker with mine first when both wrote different values', () => {
    const local = t({ score: 5, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    const m = merged.rounds[0].scoreConflicts.p1[3];
    expect(m.candidates[0]).toMatchObject({ value: 5, ts: 100 });
    expect(m.candidates[1]).toMatchObject({ value: 6, ts: 900 });
  });

  it('does not emit a generic conflicts entry for a score cell', () => {
    const local = t({ score: 5, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    expect(mergeTournaments(local, remote).conflicts).toHaveLength(0);
  });

  it('equal values clear a stale marker instead of flagging', () => {
    const local = t({
      score: 5, meta: { [cell]: 100, [marker]: 90 },
      conflicts: { p1: { 3: { candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 80 }], detectedAt: 90 } } },
    });
    const remote = t({ score: 5, meta: { [cell]: 200 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('a cell local never wrote takes the remote value with no marker', () => {
    const local = t({ score: undefined, meta: {} });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('null-vs-value counts as a conflict when both stamped the cell', () => {
    // Local explicitly cleared the cell (stamped, value deleted); remote wrote 6.
    const local = t({ score: undefined, meta: { [cell]: 100 } });
    const remote = t({ score: 6, meta: { [cell]: 900 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores?.p1?.[3] ?? null).toBeNull();
    const m = merged.rounds[0].scoreConflicts.p1[3];
    expect(m.candidates[0]).toMatchObject({ value: null, ts: 100 });
    expect(m.candidates[1]).toMatchObject({ value: 6, ts: 900 });
  });

  it('a remote resolution at/after my write wins and clears my marker', () => {
    const local = t({
      score: 5, meta: { [cell]: 100, [marker]: 110 },
      conflicts: { p1: { 3: { candidates: [{ value: 5, ts: 100 }, { value: 6, ts: 90 }], detectedAt: 110 } } },
    });
    const remote = t({
      score: 6, meta: { [cell]: 500, [resolution]: 500 },
      resolutions: { p1: { 3: 500 } },
    });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('my own resolution does not get re-flagged by their stale value', () => {
    const local = t({
      score: 6, meta: { [cell]: 500, [resolution]: 500 },
      resolutions: { p1: { 3: 500 } },
    });
    const remote = t({ score: 5, meta: { [cell]: 100 } });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(6);
    expect(merged.rounds[0].scoreConflicts?.p1?.[3] ?? null).toBeNull();
  });

  it('a raw write NEWER than the resolution re-enters always-mine flow', () => {
    // Remote resolved at 500; local deliberately edited again at 600.
    const local = t({ score: 4, meta: { [cell]: 600 } });
    const remote = t({
      score: 6, meta: { [cell]: 500, [resolution]: 500 },
      resolutions: { p1: { 3: 500 } },
    });
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1[3]).toBe(4);
    const m = merged.rounds[0].scoreConflicts.p1[3];
    expect(m.candidates[0]).toMatchObject({ value: 4, ts: 600 });
  });
});

// meId is per-device identity ("which player is *me* on this phone") — never
// collaborative state. Without these guarantees a joiner's setMe push would
// overwrite the creator's meId on the next pull and "me" would suddenly point
// at the other player.
describe('mergeTournaments — meId is device-local', () => {
  it('keeps local meId when remote stamps a newer _meta.meId', () => {
    const local = { id: 't1', meId: 'alice', _meta: {} };
    const remote = { id: 't1', meId: 'bob', _meta: { meId: 999 } };
    expect(mergeTournaments(local, remote).merged.meId).toBe('alice');
  });

  it('keeps local meId when remote has no _meta.meId but a different meId value', () => {
    const local = { id: 't1', meId: 'alice' };
    const remote = { id: 't1', meId: 'bob' };
    expect(mergeTournaments(local, remote).merged.meId).toBe('alice');
  });

  it('keeps a null local meId rather than picking up remote meId', () => {
    const local = { id: 't1', meId: null };
    const remote = { id: 't1', meId: 'bob' };
    expect(mergeTournaments(local, remote).merged.meId).toBeNull();
  });

  it('never emits a meId conflict entry', () => {
    const local = { id: 't1', meId: 'alice', _meta: { meId: 100 } };
    const remote = { id: 't1', meId: 'bob', _meta: { meId: 200 } };
    const { conflicts } = mergeTournaments(local, remote);
    expect(conflicts.find((c) => c.path === 'meId')).toBeUndefined();
  });
});
