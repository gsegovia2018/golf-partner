import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  activeSpotClaims, pendingSpotClaims, claimForUser, pastCardCount, memberAdminErrorKey,
  loadSeenClaims, markClaimsSeen, membershipHistory,
} from '../leagueMembersAdmin';

const ev = (id, kind, extra = {}) => ({
  id, kind, userId: null, inviteeId: null, actorUserId: null, data: {}, at: `2026-10-1${id}T10:00:00Z`, ...extra,
});
const members = [
  { userId: 'a', leftAt: null }, { userId: 'k', leftAt: null }, { userId: 't', leftAt: '2026-10-12T00:00:00Z' },
];

describe('activeSpotClaims', () => {
  test('a claim stands until released', () => {
    const events = [
      ev(1, 'spot_claimed', { userId: 'k', inviteeId: 'i1', data: { spot_name: 'Kike Moreno', name: 'Enrique M.', handicap: 22.1 } }),
      ev(2, 'spot_claimed', { userId: 'x', inviteeId: 'i2', data: { spot_name: 'Ana' } }),
      ev(3, 'spot_released', { userId: 'x', inviteeId: 'i2' }),
    ];
    expect(activeSpotClaims(events, [...members, { userId: 'x', leftAt: null }])).toEqual([
      expect.objectContaining({ eventId: 1, inviteeId: 'i1', userId: 'k', spotName: 'Kike Moreno', accountName: 'Enrique M.', handicap: 22.1 }),
    ]);
  });

  test('a re-claim after a release counts again; an account that left does not', () => {
    const events = [
      ev(1, 'spot_claimed', { userId: 'k', inviteeId: 'i1' }),
      ev(2, 'spot_released', { userId: 'k', inviteeId: 'i1' }),
      ev(3, 'spot_claimed', { userId: 'k', inviteeId: 'i1' }),
      ev(4, 'spot_claimed', { userId: 't', inviteeId: 'i2' }),
    ];
    expect(activeSpotClaims(events, members).map((c) => c.eventId)).toEqual([3]);
  });

  test('ignores other kinds and tolerates no events', () => {
    expect(activeSpotClaims([ev(1, 'removed', { userId: 'k' })], members)).toEqual([]);
    expect(activeSpotClaims(undefined, members)).toEqual([]);
  });
});

test('pendingSpotClaims drops the dismissed ones, comparing ids as text', () => {
  const claims = [{ eventId: 1 }, { eventId: 2 }];
  expect(pendingSpotClaims(claims, ['1'])).toEqual([{ eventId: 2 }]);
  expect(pendingSpotClaims(claims, null)).toHaveLength(2);
});

test('claimForUser and pastCardCount', () => {
  expect(claimForUser([{ userId: 'k', eventId: 1 }], 'k')).toEqual({ userId: 'k', eventId: 1 });
  expect(claimForUser([], 'k')).toBeNull();
  const cards = [
    { userId: 'a', status: 'confirmed' }, { userId: 'a', status: 'void' }, { userId: 'a', status: 'announced' }, { userId: 'b', status: 'confirmed' },
  ];
  expect(pastCardCount(cards, 'a')).toBe(2);
});

test('memberAdminErrorKey maps the server hints', () => {
  expect(memberAdminErrorKey({ hint: 'last_admin' })).toBe('league.members.errLastAdmin');
  expect(memberAdminErrorKey({ hint: 'not_claimed' })).toBe('league.members.errNotClaimed');
  expect(memberAdminErrorKey({ hint: 'other' })).toBeNull();
  expect(memberAdminErrorKey(null)).toBeNull();
});

describe('seen claims', () => {
  beforeEach(() => AsyncStorage.clear());

  test('are remembered per league and accumulate', async () => {
    expect(await loadSeenClaims('L1')).toEqual([]);
    expect(await markClaimsSeen('L1', [1, 2])).toEqual(['1', '2']);
    expect(await markClaimsSeen('L1', [2, 3])).toEqual(['1', '2', '3']);
    expect(await loadSeenClaims('L1')).toEqual(['1', '2', '3']);
    expect(await loadSeenClaims('L2')).toEqual([]);
  });

  test('survive a broken store', async () => {
    const get = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('x'));
    const set = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('x'));
    expect(await loadSeenClaims('L1')).toEqual([]);
    expect(await markClaimsSeen('L1', [5])).toEqual(['5']);
    get.mockRestore();
    set.mockRestore();
  });
});

test('membershipHistory lists the log newest first with who and what', () => {
  const nameOf = (id) => ({ a: 'Marcos', k: 'Kike' }[id] ?? 'Former member');
  const out = membershipHistory([
    ev(1, 'promoted', { userId: 'k', data: { name: 'Kike' } }),
    ev(2, 'invite_code_rotated', { actorUserId: 'a' }),
    ev(3, 'removed', { userId: 'k', actorUserId: 'a', data: { name: 'Kike' } }),
    ev(4, 'mystery'),
  ], nameOf);
  expect(out.map((l) => [l.key, l.params])).toEqual([
    ['league.members.histRemoved', { name: 'Kike', actor: 'Marcos' }],
    ['league.members.histCode', { actor: 'Marcos' }],
    ['league.members.histPromoted', { name: 'Kike' }],
  ]);
});
