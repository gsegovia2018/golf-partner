import {
  MISS_REASON_KEYS,
  OPTIONS,
  clearedReasonPatch,
  situations,
  hasReason,
  flightOf,
  shotName,
  summaryOf,
  isBlockedApproach,
  classifyMiss,
  missReasonStats,
} from '../missReasons';

describe('flightOf (spec §3 table)', () => {
  test.each([
    ['center', 'right', 'right', 'curve'],
    ['center', 'left', 'left', 'curve'],
    ['right', 'right', 'none', 'start'],
    ['left', 'left', 'none', 'start'],
    ['left', 'right', 'right', 'curve'],
    ['right', 'left', 'left', 'curve'],
  ])('start %s finish %s -> curve %s, family %s', (start, finish, curve, family) => {
    expect(flightOf({ start, finish })).toEqual({ start, curve, family });
  });

  test.each(['long', 'short', null, undefined])('finish %s -> start only', (finish) => {
    expect(flightOf({ start: 'left', finish })).toEqual({ start: 'left', curve: null, family: null });
    expect(flightOf({ start: 'center', finish })).toEqual({ start: 'center', curve: null, family: null });
  });

  test.each([null, undefined, 'up', ''])('start %p -> null', (start) => {
    expect(flightOf({ start, finish: 'left' })).toBeNull();
  });

  test('no argument -> null', () => {
    expect(flightOf()).toBeNull();
  });
});

describe('shotName', () => {
  const f = (start, curve, family) => ({ start, curve, family });
  const cases = [
    // [flight, right-hander name, left-hander name]
    [f('right', 'none', 'start'), 'push', 'pull'],
    [f('left', 'none', 'start'), 'pull', 'push'],
    [f('center', 'right', 'curve'), 'slice', 'hook'],
    [f('center', 'left', 'curve'), 'hook', 'slice'],
    [f('left', 'right', 'curve'), 'pull-slice', 'push-hook'],
    [f('right', 'left', 'curve'), 'push-hook', 'pull-slice'],
  ];

  test.each(cases)('%j right-handed is %s', (flight, right) => {
    expect(shotName(flight, 'right')).toBe(right);
    expect(shotName(flight)).toBe(right);
  });

  test.each(cases)('%j left-handed is the mirror (%s, %s)', (flight, _right, left) => {
    expect(shotName(flight, 'left')).toBe(left);
  });

  test('no family or no flight -> null', () => {
    expect(shotName({ start: 'left', curve: null, family: null })).toBeNull();
    expect(shotName(null)).toBeNull();
  });
});

describe('helpers', () => {
  test('MISS_REASON_KEYS', () => {
    expect(MISS_REASON_KEYS).toEqual({
      drive: ['driveStart', 'driveContact', 'driveSituation'],
      approach: ['approachStart', 'approachContact', 'approachSituation'],
      short: ['shortResult', 'shortContact', 'shortSituation'],
    });
  });

  test('approachSituation order is part of the UI contract', () => {
    expect(OPTIONS.approachSituation).toEqual([
      'above-feet', 'below-feet', 'uphill', 'downhill', 'blocked', 'bad-lie', 'wind', 'decision',
    ]);
    expect(OPTIONS.start).toEqual(['left', 'center', 'right']);
    expect(OPTIONS.driveContact).toEqual(['top', 'sky', 'toe', 'heel']);
    expect(OPTIONS.driveSituation).toEqual(['wind', 'decision']);
    expect(OPTIONS.approachContact).toEqual(['fat', 'thin', 'toe', 'shank']);
    expect(OPTIONS.shortResult).toEqual(['short', 'long']);
    expect(OPTIONS.shortContact).toEqual(['fat', 'thin']);
    expect(OPTIONS.shortSituation).toEqual(['bad-lie', 'short-sided', 'wrong-shot']);
  });

  test('clearedReasonPatch nulls the type\'s three keys', () => {
    expect(clearedReasonPatch('drive')).toEqual({ driveStart: null, driveContact: null, driveSituation: null });
    expect(clearedReasonPatch('approach')).toEqual({
      approachStart: null, approachContact: null, approachSituation: null,
    });
    expect(clearedReasonPatch('short')).toEqual({ shortResult: null, shortContact: null, shortSituation: null });
  });

  test('situations guards non-arrays', () => {
    expect(situations({ approachSituation: ['wind'] }, 'approachSituation')).toEqual(['wind']);
    expect(situations({ approachSituation: null }, 'approachSituation')).toEqual([]);
    expect(situations({ approachSituation: 'wind' }, 'approachSituation')).toEqual([]);
    expect(situations({}, 'approachSituation')).toEqual([]);
    expect(situations(null, 'approachSituation')).toEqual([]);
    expect(situations(undefined, 'x')).toEqual([]);
  });

  test('hasReason', () => {
    expect(hasReason('drive', {})).toBe(false);
    expect(hasReason('drive', null)).toBe(false);
    expect(hasReason('drive', { driveStart: null, driveContact: null, driveSituation: [] })).toBe(false);
    expect(hasReason('drive', { driveStart: 'left' })).toBe(true);
    expect(hasReason('drive', { driveSituation: ['wind'] })).toBe(true);
    expect(hasReason('approach', { driveStart: 'left' })).toBe(false);
    expect(hasReason('approach', { approachContact: 'fat' })).toBe(true);
    expect(hasReason('short', { shortResult: 'long' })).toBe(true);
    expect(hasReason('short', { shortSituation: [] })).toBe(false);
  });
});

describe('summaryOf', () => {
  const keys = (list) => list.map((m) => m.key);

  test('approach: name, contact, situations', () => {
    const d = {
      approachMiss: 'right', approachStart: 'center', approachContact: 'thin',
      approachSituation: ['uphill', 'wind'],
    };
    expect(keys(summaryOf('approach', d, 'right'))).toEqual([
      'shots.why.name.slice', 'shots.why.contact.thin', 'shots.why.situation.uphill', 'shots.why.situation.wind',
    ]);
    expect(keys(summaryOf('approach', d, 'left'))[0]).toBe('shots.why.name.hook');
  });

  test('approach: start alone when the finish gives no name', () => {
    const d = { approachMiss: 'long', approachStart: 'left', approachContact: 'fat' };
    expect(keys(summaryOf('approach', d))).toEqual(['shots.why.start.left', 'shots.why.contact.fat']);
  });

  test('drive: name from detail.drive, then contact and situations', () => {
    const d = { drive: 'left', driveStart: 'left', driveContact: 'toe', driveSituation: ['decision'] };
    expect(keys(summaryOf('drive', d, 'right'))).toEqual([
      'shots.why.name.pull', 'shots.why.contact.toe', 'shots.why.situation.decision',
    ]);
  });

  test('drive short: a kept start stays out of the summary', () => {
    expect(keys(summaryOf('drive', { drive: 'short', driveStart: 'center', driveContact: 'sky' }))).toEqual([
      'shots.why.contact.sky',
    ]);
  });

  test('approach long: start alone (no name without a side)', () => {
    expect(keys(summaryOf('approach', { approachMiss: 'long', approachStart: 'right' }))).toEqual([
      'shots.why.start.right',
    ]);
  });

  test('short: result, contact, situations', () => {
    const d = { shortResult: 'long', shortContact: 'thin', shortSituation: ['short-sided'] };
    expect(summaryOf('short', d)).toEqual([
      { key: 'shots.why.shortResult.long', params: undefined },
      { key: 'shots.why.contact.thin', params: undefined },
      { key: 'shots.why.situation.short-sided', params: undefined },
    ]);
  });

  test('untagged -> []', () => {
    expect(summaryOf('approach', { approachMiss: 'left' })).toEqual([]);
    expect(summaryOf('drive', { drive: 'left', driveSituation: [] })).toEqual([]);
    expect(summaryOf('short', {})).toEqual([]);
    expect(summaryOf('short', null)).toEqual([]);
  });
});

describe('isBlockedApproach', () => {
  test('reads approachSituation', () => {
    expect(isBlockedApproach({ approachSituation: ['wind', 'blocked'] })).toBe(true);
    expect(isBlockedApproach({ approachSituation: ['wind'] })).toBe(false);
    expect(isBlockedApproach({})).toBe(false);
    expect(isBlockedApproach(null)).toBe(false);
  });
});

describe('classifyMiss (spec §5.1 precedence)', () => {
  const approach = (d) => classifyMiss('approach', { approachMiss: 'right', ...d });
  const swing = (sub, side = null) => ({ family: 'swing', sub, side });

  test('below-feet + curve-right -> lie', () => {
    expect(approach({ approachSituation: ['below-feet'], approachStart: 'center' }))
      .toEqual({ family: 'lie', sub: null, side: null });
  });
  test('blocked + fat -> forced', () => {
    expect(approach({ approachSituation: ['blocked'], approachContact: 'fat' }).family).toBe('forced');
  });
  test('blocked beats lie and decision', () => {
    expect(approach({ approachSituation: ['wind', 'decision', 'blocked'] }).family).toBe('forced');
  });
  test('lie beats decision; decision beats swing', () => {
    expect(approach({ approachSituation: ['decision', 'uphill'] }).family).toBe('lie');
    expect(approach({ approachSituation: ['decision'], approachContact: 'fat' }).family).toBe('decision');
  });
  test('fat + start-right -> lowPoint', () => {
    expect(approach({ approachContact: 'fat', approachStart: 'right' })).toEqual(swing('lowPoint'));
  });
  test('toe + start-right -> start/right (flight beats strike)', () => {
    expect(approach({ approachContact: 'toe', approachStart: 'right' })).toEqual(swing('start', 'right'));
  });
  test('curve takes the finish side', () => {
    expect(approach({ approachStart: 'center' })).toEqual(swing('curve', 'right'));
    expect(approach({ approachStart: 'left', approachMiss: 'right' })).toEqual(swing('curve', 'right'));
  });
  test('shank with no start -> strike with finish side', () => {
    expect(approach({ approachContact: 'shank' })).toEqual(swing('strike', 'right'));
    expect(approach({ approachContact: 'shank', approachMiss: 'long' })).toEqual(swing('strike', null));
  });
  test('untagged -> null', () => {
    expect(approach({})).toBeNull();
    expect(approach({ approachStart: 'center', approachMiss: 'long' })).toBeNull();
    expect(classifyMiss('approach', null)).toBeNull();
    expect(classifyMiss('nope', {})).toBeNull();
  });
  test('blocked is approach only', () => {
    expect(classifyMiss('drive', { drive: 'left', driveSituation: ['wind'] }).family).toBe('lie');
  });
  test('drive: top/sky are lowPoint, toe is strike, start/curve from finish', () => {
    expect(classifyMiss('drive', { drive: 'short', driveContact: 'top' })).toEqual(swing('lowPoint'));
    expect(classifyMiss('drive', { drive: 'left', driveContact: 'sky', driveStart: 'left' })).toEqual(swing('lowPoint'));
    expect(classifyMiss('drive', { drive: 'left', driveContact: 'heel' })).toEqual(swing('strike', 'left'));
    expect(classifyMiss('drive', { drive: 'left', driveStart: 'left' })).toEqual(swing('start', 'left'));
    expect(classifyMiss('drive', { drive: 'right', driveStart: 'center' })).toEqual(swing('curve', 'right'));
  });
  test('short game', () => {
    expect(classifyMiss('short', { shortSituation: ['wrong-shot'] }).family).toBe('decision');
    expect(classifyMiss('short', { shortSituation: ['short-sided'] }).family).toBe('lie');
    expect(classifyMiss('short', { shortSituation: ['bad-lie'] }).family).toBe('lie');
    expect(classifyMiss('short', { shortContact: 'thin' })).toEqual(swing('lowPoint'));
    expect(classifyMiss('short', { shortResult: 'short' })).toBeNull();
  });
});

describe('missReasonStats', () => {
  const holes = [1, 2, 3, 4, 5].map((n) => ({ number: n, par: n === 5 ? 3 : 4 }));
  const round = (details, scores) => ({
    holes,
    scores: { me: scores },
    shotDetails: { me: details },
  });

  test('approach per bucket and pooled, tagged/untagged/blocked, sides', () => {
    const r = round({
      1: { approachBucket: '100-150', approachResult: 'miss', approachMiss: 'right', approachStart: 'right' },
      2: { approachBucket: '100-150', approachResult: 'miss', approachMiss: 'left', approachSituation: ['blocked'] },
      3: { approachBucket: '150-200', approachResult: 'miss', approachMiss: 'long' },
      4: { approachBucket: '150-200', approachResult: 'green', putts: 2 },
      5: { approachBucket: '100-150', approachResult: 'miss', approachContact: 'fat' },
    }, { 1: 5, 2: 5, 3: 5, 4: 4, 5: 3 });
    const { approach } = missReasonStats([r], 'me');
    const b = approach.byBucket['100-150'];
    expect(b).toMatchObject({ misses: 2, tagged: 2, untagged: 0, blocked: 1 });
    expect(b.families).toEqual({ forced: 1, lie: 0, decision: 0, swing: 1 });
    expect(b.subs.start).toEqual({ left: 0, right: 1 });
    expect(approach.byBucket['150-200']).toMatchObject({ misses: 1, tagged: 0, untagged: 1 });
    expect(approach.byBucket['0-50'].misses).toBe(0);
    expect(approach.all).toMatchObject({ misses: 3, tagged: 2, untagged: 1, blocked: 1 });
  });

  test('lowPoint and strike side counts', () => {
    const r = round({
      1: { approachBucket: '50-100', approachResult: 'miss', approachMiss: 'long', approachContact: 'thin' },
      2: { approachBucket: '50-100', approachResult: 'miss', approachMiss: 'left', approachContact: 'shank' },
    }, { 1: 5, 2: 5 });
    const row = missReasonStats([r], 'me').approach.byBucket['50-100'];
    expect(row.subs.lowPoint).toBe(1);
    expect(row.subs.strike).toEqual({ left: 1, right: 0 });
  });

  test('tee counts par 4+ left/right/short drives only', () => {
    const r = round({
      1: { drive: 'left', driveStart: 'left' },
      2: { drive: 'short', driveContact: 'top' },
      3: { drive: 'fairway' },
      5: { drive: 'right' },
    }, { 1: 5, 2: 5, 3: 4, 5: 3 });
    const { tee } = missReasonStats([r], 'me');
    expect(tee).toMatchObject({ misses: 2, tagged: 2 });
    expect(tee.subs.start.left).toBe(1);
    expect(tee.subs.lowPoint).toBe(1);
  });

  test('short counts missed greens not saved with strokes over par', () => {
    const r = round({
      1: { approachResult: 'miss', putts: 2, shortContact: 'fat' },
      2: { approachResult: 'miss', putts: 1, recoveryOutcome: 'up-and-down' },
      3: { approachResult: 'miss', putts: 2 },
    }, { 1: 5, 2: 4, 3: 4 });
    const { short } = missReasonStats([r], 'me');
    expect(short).toMatchObject({ misses: 1, tagged: 1 });
    expect(short.subs.lowPoint).toBe(1);
  });

  test('lies count every lie situation on lie-family misses', () => {
    const r = round({
      1: { approachBucket: '100-150', approachResult: 'miss', approachSituation: ['below-feet', 'wind'] },
      2: { approachBucket: '100-150', approachResult: 'miss', approachSituation: ['below-feet'] },
      3: { approachBucket: '100-150', approachResult: 'miss', approachSituation: ['decision'] },
    }, { 1: 5, 2: 5, 3: 5 });
    const { approach } = missReasonStats([r], 'me');
    expect(approach.all.lies).toEqual({ 'below-feet': 2, wind: 1 });
    expect(missReasonStats([], 'me').tee.lies).toEqual({});
  });

  test('other players / empty input', () => {
    expect(missReasonStats([], 'me').approach.all.misses).toBe(0);
    expect(missReasonStats(null, 'me').tee.misses).toBe(0);
    expect(missReasonStats([round({}, {})], 'other').short.misses).toBe(0);
  });
});
