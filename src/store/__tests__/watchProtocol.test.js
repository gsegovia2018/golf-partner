import { watchStateOf, parseWatchCommand, decideWatchCommand } from '../watchProtocol';

const base = {
  rev: 3,
  round: { id: 'r1' },
  courseName: 'Lomas-Bosque',
  holeNumber: 7,
  holeCount: 18,
  par: 4,
  si: 3,
  extraShots: 1,
  green: { front: [1, 2], center: [1, 3], back: [1, 4] },
  phoneDistances: { front: 131, center: 143, back: 156, source: 'gps' },
  units: 'yards',
  me: {
    playerId: 'p1', name: 'Marcos', strokes: 5, points: 2, totalPoints: 14, thru: 6,
    putts: 2, driveLie: 'fairway', sandShots: 0, otherPenalties: 1,
  },
  track: { putting: true, teeShot: true, shortGame: false, penalties: true, approach: true },
  blocked: null,
};

describe('watchStateOf', () => {
  test('builds the v1 state', () => {
    expect(watchStateOf(base)).toEqual({
      v: 1,
      rev: 3,
      ack: null,
      lastReject: null,
      roundId: 'r1',
      courseName: 'Lomas-Bosque',
      active: true,
      blocked: null,
      units: 'yd',
      hole: {
        number: 7, count: 18, par: 4, si: 3, extraShots: 1,
        green: base.green,
        phone: base.phoneDistances,
      },
      course: null,
      mine: {},
      me: {
        playerId: 'p1', name: 'Marcos', strokes: 5, points: 2, totalPoints: 14, thru: 6,
        putts: 2, driveLie: 'fairway', sandShots: 0, penalties: 1,
      },
      track: { putting: true, teeShot: true, approach: true, shortGame: false, penalties: true },
    });
  });

  test('carries the whole-course state and my per-hole values', () => {
    const course = { holes: [{ number: 7, par: 4, si: 3, extraShots: 1, green: base.green, tee: [1, 1] }] };
    const mine = { 7: { strokes: 5, points: 2, shot: { putts: 2 } } };
    const s = watchStateOf({ ...base, course, mine });
    expect(s.course).toBe(course);
    expect(s.mine).toBe(mine);
  });

  test('metres by default, nulls for a missing green and phone fix', () => {
    const s = watchStateOf({ ...base, units: 'meters', green: undefined, phoneDistances: undefined, blocked: 'dispute' });
    expect(s.units).toBe('m');
    expect(s.hole.green).toBeNull();
    expect(s.hole.phone).toBeNull();
    expect(s.blocked).toBe('dispute');
  });

  test('a stat group missing from settings is tracked, as the panel shows it', () => {
    const s = watchStateOf({ ...base, track: { shortGame: false } });
    expect(s.track).toEqual({ putting: true, teeShot: true, approach: true, shortGame: false, penalties: true });
  });

  test('unscored hole keeps nulls', () => {
    const s = watchStateOf({ ...base, me: { ...base.me, strokes: null, points: null, putts: null, driveLie: null } });
    expect(s.me).toMatchObject({ strokes: null, points: null, putts: null, driveLie: null });
  });

  test('no round: inactive shape', () => {
    expect(watchStateOf({ rev: 9, round: null })).toEqual({
      v: 1, rev: 9, ack: null, lastReject: null, active: false, roundId: null, courseName: null, blocked: null,
    });
  });

  test('carries the id of the last command processed', () => {
    expect(watchStateOf({ ...base, ack: 'c9' }).ack).toBe('c9');
    expect(watchStateOf({ rev: 9, ack: 'c9', round: null }).ack).toBe('c9');
  });

  test('carries the last rejected command, active or not', () => {
    const lastReject = { id: 'c8', reason: 'hole', hole: 7 };
    expect(watchStateOf({ ...base, lastReject }).lastReject).toEqual(lastReject);
    expect(watchStateOf({ rev: 9, lastReject, round: null }).lastReject).toEqual(lastReject);
  });
});

const cmd = (over) => JSON.stringify({ v: 1, id: 'c1', roundId: 'r1', baseRev: 3, hole: 7, type: 'strokes', value: 5, ...over });

describe('parseWatchCommand', () => {
  test('accepts the three command shapes', () => {
    expect(parseWatchCommand(cmd())).toEqual({ id: 'c1', roundId: 'r1', baseRev: 3, type: 'strokes', hole: 7, value: 5 });
    expect(parseWatchCommand(cmd({ value: null }))).toMatchObject({ value: null });
    expect(parseWatchCommand(cmd({ type: 'shot', value: undefined, patch: { putts: 2, driveLie: 'rough' } })))
      .toMatchObject({ type: 'shot', patch: { putts: 2, driveLie: 'rough' } });
    expect(parseWatchCommand(cmd({ type: 'hole', hole: undefined, value: undefined, to: 8 })))
      .toEqual({ id: 'c1', roundId: 'r1', baseRev: 3, type: 'hole', to: 8 });
  });

  test('accepts an already parsed object', () => {
    expect(parseWatchCommand(JSON.parse(cmd()))).not.toBeNull();
  });

  test.each([
    ['not json', 'nope'],
    ['null', 'null'],
    ['wrong version', cmd({ v: 2 })],
    ['unknown type', cmd({ type: 'delete' })],
    ['missing id', cmd({ id: undefined })],
    ['missing roundId', cmd({ roundId: '' })],
    ['non-integer baseRev', cmd({ baseRev: 1.5 })],
    ['missing hole', cmd({ hole: undefined })],
    ['strokes 0', cmd({ value: 0 })],
    ['strokes 16', cmd({ value: 16 })],
    ['strokes fraction', cmd({ value: 4.5 })],
    ['strokes string', cmd({ value: '4' })],
    ['strokes undefined', cmd({ value: undefined })],
    ['hole to 0', cmd({ type: 'hole', to: 0 })],
    ['hole to fraction', cmd({ type: 'hole', to: 2.5 })],
    ['shot without patch', cmd({ type: 'shot' })],
    ['shot empty patch', cmd({ type: 'shot', patch: {} })],
    ['shot array patch', cmd({ type: 'shot', patch: [1] })],
    ['putts 11', cmd({ type: 'shot', patch: { putts: 11 } })],
    ['putts -1', cmd({ type: 'shot', patch: { putts: -1 } })],
    ['sand 10', cmd({ type: 'shot', patch: { sandShots: 10 } })],
    ['penalties 10', cmd({ type: 'shot', patch: { otherPenalties: 10 } })],
    ['bad lie', cmd({ type: 'shot', patch: { driveLie: 'left' } })],
    ['unknown key', cmd({ type: 'shot', patch: { putts: 2, approachLie: 'rough' } })],
    ['tee penalties 10', cmd({ type: 'shot', patch: { teePenalties: 10 } })],
    ['drive bad', cmd({ type: 'shot', patch: { drive: 'middle' } })],
    ['tee club driver', cmd({ type: 'shot', patch: { teeClub: 'driver' } })],
    ['drive dist bad', cmd({ type: 'shot', patch: { driveDistBucket: '300+' } })],
    ['recovery bad', cmd({ type: 'shot', patch: { recoveryOutcome: 'maybe' } })],
    ['first putt bad', cmd({ type: 'shot', patch: { firstPuttBucket: '9' } })],
    ['approach bucket bad', cmd({ type: 'shot', patch: { approachBucket: '50' } })],
    ['approach result bad', cmd({ type: 'shot', patch: { approachResult: 'bunker' } })],
    ['approach miss bad', cmd({ type: 'shot', patch: { approachMiss: 'center' } })],
    ['bunker not boolean', cmd({ type: 'shot', patch: { approachBunker: 1 } })],
    ['bunker null', cmd({ type: 'shot', patch: { approachBunker: null } })],
  ])('rejects %s', (_name, json) => {
    expect(parseWatchCommand(json)).toBeNull();
  });

  test('bounds are inclusive and driveLie may be cleared', () => {
    expect(parseWatchCommand(cmd({ value: 1 }))).not.toBeNull();
    expect(parseWatchCommand(cmd({ value: 15 }))).not.toBeNull();
    expect(parseWatchCommand(cmd({ type: 'shot', patch: { putts: 0, sandShots: 9, otherPenalties: 0, driveLie: null } }))).not.toBeNull();
  });
});

describe('parseWatchCommand: v1.2 shot patch keys', () => {
  test('accepts every new key and value, nulls clear', () => {
    const patch = {
      drive: 'super', teeClub: 'iron', driveDistBucket: '240+', teePenalties: 9,
      recoveryOutcome: 'sand-save', firstPuttBucket: '6+', approachBucket: '200+',
      approachResult: 'miss', approachMiss: 'long', approachBunker: true, driveLie: 'trouble',
    };
    expect(parseWatchCommand(cmd({ type: 'shot', patch }))).toMatchObject({ patch });
    const cleared = Object.fromEntries(Object.keys(patch).filter((k) => k !== 'approachBunker' && k !== 'teePenalties').map((k) => [k, null]));
    expect(parseWatchCommand(cmd({ type: 'shot', patch: { ...cleared, approachBunker: false, teePenalties: 0 } }))).not.toBeNull();
    expect(parseWatchCommand(cmd({ type: 'shot', patch: { recoveryOutcome: 'none', approachResult: 'green' } }))).not.toBeNull();
  });
});

describe('decideWatchCommand', () => {
  const ctx = { roundId: 'r1', currentHole: 7, blocked: null, holeCount: 18 };
  const parsed = (over) => parseWatchCommand(cmd(over));

  test('strokes and shot on the current hole pass through', () => {
    expect(decideWatchCommand(parsed(), ctx)).toEqual({ kind: 'strokes', hole: 7, value: 5 });
    expect(decideWatchCommand(parsed({ type: 'shot', patch: { putts: 1 } }), ctx))
      .toEqual({ kind: 'shot', hole: 7, patch: { putts: 1 } });
  });

  test('hole command moves to a valid other hole', () => {
    expect(decideWatchCommand(parsed({ type: 'hole', to: 8 }), ctx)).toEqual({ kind: 'hole', to: 8 });
  });

  test.each([
    ['null command', null, {}],
    ['round mismatch', parsed({ roundId: 'other' }), {}],
    ['no round', parsed(), { roundId: null }],
    ['strokes on another hole', parsed({ hole: 8 }), {}],
    ['shot on another hole', parsed({ type: 'shot', hole: 6, patch: { putts: 1 } }), {}],
    ['blocked: dispute', parsed(), { blocked: 'dispute' }],
    ['blocked: viewOnly', parsed({ type: 'hole', to: 8 }), { blocked: 'viewOnly' }],
    ['blocked: official', parsed({ type: 'shot', patch: { putts: 1 } }), { blocked: 'official' }],
    ['hole past the end', parsed({ type: 'hole', to: 19 }), {}],
    ['hole past a nine-hole card', parsed({ type: 'hole', to: 10 }), { holeCount: 9 }],
    ['hole to current', parsed({ type: 'hole', to: 7 }), {}],
  ])('rejects %s', (_name, command, over) => {
    expect(decideWatchCommand(command, { ...ctx, ...over }).kind).toBe('reject');
  });

  test('a hole command built before the phone last moved is stale', () => {
    // baseRev 3: the watch had not seen the phone arrive on 7 at rev 5.
    expect(decideWatchCommand(parsed({ type: 'hole', to: 6 }), { ...ctx, holeRev: 5 }))
      .toEqual({ kind: 'reject', reason: 'stale' });
    // A phone move not published yet is unknown to every command.
    expect(decideWatchCommand(parsed({ type: 'hole', to: 6, baseRev: 99 }), { ...ctx, holeRev: Infinity }))
      .toEqual({ kind: 'reject', reason: 'stale' });
    expect(decideWatchCommand(parsed({ type: 'hole', to: 8, baseRev: 5 }), { ...ctx, holeRev: 5 }))
      .toEqual({ kind: 'hole', to: 8 });
  });

  test('staleness is about hole moves only: score writes still pass', () => {
    expect(decideWatchCommand(parsed(), { ...ctx, holeRev: Infinity }).kind).toBe('strokes');
  });
});
