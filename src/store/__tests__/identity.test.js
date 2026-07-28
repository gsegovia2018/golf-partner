import { deriveMeIdFromAuth } from '../tournamentStore';

describe('deriveMeIdFromAuth', () => {
  it('points meId at the player whose user_id matches auth', () => {
    const t = {
      meId: null,
      players: [
        { id: 'p1', name: 'Alice', user_id: 'u-alice' },
        { id: 'p2', name: 'Bob', user_id: 'u-bob' },
      ],
    };
    expect(deriveMeIdFromAuth(t, 'u-bob').meId).toBe('p2');
  });

  it('corrects a stale meId left over from another device', () => {
    // Without this, a fetched/cached blob's stale local meId (e.g. after an
    // account switch on the same device) would stick around unchallenged.
    const t = {
      meId: 'p1',
      players: [
        { id: 'p1', name: 'Alice', user_id: 'u-alice' },
        { id: 'p2', name: 'Bob', user_id: 'u-bob' },
      ],
    };
    expect(deriveMeIdFromAuth(t, 'u-bob').meId).toBe('p2');
  });

  it('returns the same object reference when meId already matches', () => {
    const t = {
      meId: 'p2',
      players: [{ id: 'p2', name: 'Bob', user_id: 'u-bob' }],
    };
    expect(deriveMeIdFromAuth(t, 'u-bob')).toBe(t);
  });

  it('clears meId when it points at another user and this user has no player', () => {
    const t = {
      meId: 'p1',
      players: [{ id: 'p1', name: 'Alice', user_id: 'u-alice' }],
    };
    expect(deriveMeIdFromAuth(t, 'u-stranger').meId).toBeNull();
  });

  it('is a no-op for null tournament or null auth user', () => {
    expect(deriveMeIdFromAuth(null, 'u-bob')).toBeNull();
    const t = { meId: null, players: [] };
    expect(deriveMeIdFromAuth(t, null)).toBe(t);
  });

  it('ignores players with a null user_id (unclaimed slots)', () => {
    const t = {
      meId: null,
      players: [
        { id: 'p1', name: 'Empty', user_id: null },
        { id: 'p2', name: 'Bob', user_id: 'u-bob' },
      ],
    };
    expect(deriveMeIdFromAuth(t, null)).toBe(t);
    expect(deriveMeIdFromAuth(t, 'u-bob').meId).toBe('p2');
  });

  it('clears a stale meId pointing at another account when this user has no player', () => {
    // Heals legacy data where a joiner's setMe push corrupted meId to a
    // player belonging to another account. Nulling triggers the existing
    // "which player are you?" picker in HoleView.
    const t = {
      meId: 'p2',
      players: [
        { id: 'p1', name: 'Guest', user_id: null },
        { id: 'p2', name: 'Bob', user_id: 'u-bob' },
      ],
    };
    expect(deriveMeIdFromAuth(t, 'u-charlie').meId).toBeNull();
  });

  it('keeps meId when it points at a player with no claimed account (guest slot)', () => {
    // A guest player legitimately picked via the picker — leave it alone.
    const t = {
      meId: 'p1',
      players: [
        { id: 'p1', name: 'Guest', user_id: null },
        { id: 'p2', name: 'Bob', user_id: 'u-bob' },
      ],
    };
    expect(deriveMeIdFromAuth(t, 'u-charlie')).toBe(t);
  });
});

// Migration 20260728000000 made get_game_tournament project user_id from the
// game_players COLUMN, so an unclaimed slot now arrives with the key ABSENT
// where it used to arrive as an explicit null (measured on prod: 27 players
// across 14 of 48 tournaments carried a null-valued key). That is only safe
// because nothing can tell the two apart — every read in src/ is truthiness or
// equality against a real uuid, and no consumer does a key-presence check.
// These pin the equivalence: if someone later writes a read that distinguishes
// them, this fails rather than the roster quietly mis-identifying a player.
describe('an absent user_id behaves exactly like a null one', () => {
  const pair = (first) => ({
    meId: null,
    players: [first, { id: 'p2', name: 'Bob', user_id: 'u-bob' }],
  });

  it('an unclaimed slot resolves identically whether null or absent', () => {
    // Compare the DECISION, not the objects: the inputs differ by exactly the
    // key under test, so a deep-equal would always fail and prove nothing.
    const fromNull = deriveMeIdFromAuth(pair({ id: 'p1', name: 'Guest', user_id: null }), 'u-charlie');
    const fromAbsent = deriveMeIdFromAuth(pair({ id: 'p1', name: 'Guest' }), 'u-charlie');
    expect(fromNull.meId).toBe(fromAbsent.meId);
    expect(fromAbsent.meId).toBeNull();
  });

  it('still matches a genuinely claimed slot alongside an absent one', () => {
    expect(deriveMeIdFromAuth(pair({ id: 'p1', name: 'Guest' }), 'u-bob').meId).toBe('p2');
  });

  it('clears a stale meId identically whether the other slot is null or absent', () => {
    const withNull = {
      meId: 'p2',
      players: [{ id: 'p1', user_id: null }, { id: 'p2', user_id: 'u-bob' }],
    };
    const withAbsent = {
      meId: 'p2',
      players: [{ id: 'p1' }, { id: 'p2', user_id: 'u-bob' }],
    };
    expect(deriveMeIdFromAuth(withNull, 'u-charlie').meId).toBeNull();
    expect(deriveMeIdFromAuth(withAbsent, 'u-charlie').meId).toBeNull();
  });
});
