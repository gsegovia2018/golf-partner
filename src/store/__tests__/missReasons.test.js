import {
  MISS_REASON_KEYS,
  OPTIONS,
  clearedReasonPatch,
  situations,
  hasReason,
  flightOf,
  shotName,
  summaryOf,
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
