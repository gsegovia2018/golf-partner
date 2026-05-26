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
    // Without this, mergeTournaments preserves a stale local meId that no
    // longer matches the auth user (e.g. account-switch on the same device).
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
