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
  it('writes a marker when two devices wrote different values for one cell', () => {
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
    expect(merged.rounds[0].scores.p1['5']).toBe(6); // remote wins LWW
    const marker = merged.rounds[0].scoreConflicts.p1['5'];
    expect(marker.candidates).toEqual([
      { value: 6, ts: 200 },
      { value: 4, ts: 100 },
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

  it('does not resurrect a conflict that was already resolved', () => {
    // Stale device still holds the old losing value 4 @ 100.
    const local = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 4 } } }],
      _meta: { 'rounds.r1.scores.p1.h5': 100 },
    };
    // Remote was resolved to 6: marker cleared, both paths stamped at 500.
    const remote = {
      id: 't1', rounds: [{ id: 'r1', scores: { p1: { 5: 6 } } }],
      _meta: {
        'rounds.r1.scores.p1.h5': 500,
        'rounds.r1.scoreConflicts.p1.h5': 500,
      },
    };
    const { merged } = mergeTournaments(local, remote);
    expect(merged.rounds[0].scores.p1['5']).toBe(6);
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
    expect(merged.rounds[0].scoreConflicts.p1['5'].candidates).toEqual([
      { value: 3, ts: 200 },
      { value: 0, ts: 100 },
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
