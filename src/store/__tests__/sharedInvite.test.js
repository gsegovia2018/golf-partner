import { buildJoinLink, findClaimedSlot } from '../tournamentStore';

describe('buildJoinLink', () => {
  test('builds a path URL from an origin and code', () => {
    expect(buildJoinLink('https://golf.example.com', 'ABC123'))
      .toBe('https://golf.example.com/join-tournament/ABC123');
  });

  test('strips a trailing slash from the origin', () => {
    expect(buildJoinLink('https://golf.example.com/', 'ABC123'))
      .toBe('https://golf.example.com/join-tournament/ABC123');
  });

  test('falls back to the production origin when none is given', () => {
    expect(buildJoinLink('', 'XYZ789'))
      .toBe('https://golf.app/join-tournament/XYZ789');
  });

  test('upper-cases the code', () => {
    expect(buildJoinLink('https://golf.app', 'abc123'))
      .toBe('https://golf.app/join-tournament/ABC123');
  });
});

describe('findClaimedSlot', () => {
  const players = [
    { id: 'p1', name: 'Ann', user_id: 'uid-ann' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Cat', user_id: 'uid-cat' },
  ];

  test('returns the slot whose user_id matches the joiner', () => {
    expect(findClaimedSlot(players, 'uid-cat')).toEqual(
      { id: 'p3', name: 'Cat', user_id: 'uid-cat' });
  });

  test('returns null when no slot is pre-bound to the joiner', () => {
    expect(findClaimedSlot(players, 'uid-zoe')).toBeNull();
  });

  test('returns null for an empty roster or missing uid', () => {
    expect(findClaimedSlot([], 'uid-ann')).toBeNull();
    expect(findClaimedSlot(players, null)).toBeNull();
  });
});
