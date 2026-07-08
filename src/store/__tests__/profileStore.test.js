import { loadProfile, upsertProfile, computePersonalStats } from '../profileStore';
import { supabase } from '../../lib/supabase';
import * as tournamentStore from '../tournamentStore';

// computePersonalStats pulls tournaments via loadAllTournaments; keep every
// other tournamentStore export real (isTournamentFinished, roundTotals,
// tournamentStablefordLeaderboard) and only stub the data-loading call.
jest.mock('../tournamentStore', () => {
  const actual = jest.requireActual('../tournamentStore');
  return { ...actual, loadAllTournaments: jest.fn() };
});

// Jest hoists jest.mock() before imports, so the chain object must be built
// entirely inside the factory. We attach it to globalThis so tests can
// reference it for assertions without triggering the hoisting problem.
jest.mock('../../lib/supabase', () => {
  const chain = {
    from: jest.fn(),
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
  };
  // Wire every chainable method to return the same chain object.
  chain.from.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);

  // Expose chain on globalThis so test-level code can access it.
  globalThis.__supabaseChain = chain;

  return {
    supabase: {
      from: (...a) => chain.from(...a),
      auth: { getUser: jest.fn() },
    },
  };
});

// Convenience alias to the chain exposed by the factory.
const getChain = () => globalThis.__supabaseChain;

describe('profileStore — target_handicap', () => {
  beforeEach(() => {
    const chain = getChain();
    // Reset call history but keep return-value wiring intact.
    Object.values(chain).forEach((fn) => fn.mockReset());
    // Re-wire chainable returns after mockReset clears them.
    chain.from.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.update.mockReturnValue(chain);
    chain.insert.mockResolvedValue({ error: null });

    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b' } } });
  });

  test('loadProfile exposes target_handicap as targetHandicap', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', target_handicap: 12.5, handicap: 18 },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.targetHandicap).toBe(12.5);
  });

  test('loadProfile returns targetHandicap=null when not set', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', target_handicap: null, handicap: 18 },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.targetHandicap).toBeNull();
  });

  test('upsertProfile writes target_handicap when row exists (update path)', async () => {
    const chain = getChain();
    // First maybeSingle: existence check -> row found -> update path.
    chain.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null });
    // upsertProfile calls: from().select().eq().maybeSingle() for existence check,
    // then from().update(row).eq() for the update.
    // eq() is called twice: once chained before maybeSingle (returns chain),
    // once as the terminal await on the update (must resolve with {error:null}).
    chain.eq
      .mockReturnValueOnce(chain)              // existence-check .eq() -> chain (so .maybeSingle works)
      .mockResolvedValueOnce({ error: null }); // update .eq() -> terminal promise
    await upsertProfile({ targetHandicap: 14 });
    expect(chain.update).toHaveBeenCalledTimes(1);
    const call = chain.update.mock.calls[0][0];
    expect(call.target_handicap).toBe(14);
  });

  test('upsertProfile writes decimal handicap when row exists', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null });
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: null });
    await upsertProfile({ handicap: '12.5' });
    expect(chain.update).toHaveBeenCalledTimes(1);
    const call = chain.update.mock.calls[0][0];
    expect(call.handicap).toBe(12.5);
  });

  test('upsertProfile writes null to clear target_handicap (update path)', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null });
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: null });
    await upsertProfile({ targetHandicap: null });
    const call = chain.update.mock.calls[0][0];
    expect(call.target_handicap).toBeNull();
  });

  test('upsertProfile does not touch target_handicap when key omitted', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null });
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: null });
    await upsertProfile({ displayName: 'Marcos' });
    const call = chain.update.mock.calls[0][0];
    expect(call).not.toHaveProperty('target_handicap');
  });

  test('upsertProfile uses insert path when row does not exist', async () => {
    const chain = getChain();
    // Existence check: no row found -> insert path.
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await upsertProfile({ targetHandicap: 10 });
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const call = chain.insert.mock.calls[0][0];
    expect(call.target_handicap).toBe(10);
  });

  test('loadProfile returns gender from the profile row', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', gender: 'female' },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.gender).toBe('female');
  });

  test('upsertProfile writes valid gender and nulls invalid', async () => {
    const chain = getChain();
    chain.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null });
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: null });
    await upsertProfile({ gender: 'female' });
    expect(chain.update.mock.calls[0][0].gender).toBe('female');

    chain.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'u1' }, error: null });
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error: null });
    await upsertProfile({ gender: 'other' });
    expect(chain.update.mock.calls[1][0].gender).toBeNull();
  });
});

describe('computePersonalStats — scramble win credit', () => {
  const HOLE = { number: 1, par: 4, strokeIndex: 1 };
  const p1 = { id: 'p1', name: 'Ann', handicap: 0, user_id: 'u-p1' };
  const p2 = { id: 'p2', name: 'Bob', handicap: 0, user_id: 'u-p2' };
  const p3 = { id: 'p3', name: 'Cam', handicap: 0, user_id: 'u-p3' };
  const p4 = { id: 'p4', name: 'Dan', handicap: 0, user_id: 'u-p4' };

  // Uniform scramble tournament — settings.scoringMode is scramblepairs for
  // the whole tournament (no per-round override needed). Only captains carry
  // scores, as real scramble rounds do (team ball).
  const scrambleRound = {
    id: 'r0',
    holes: [HOLE],
    pairs: [[p1, p2], [p3, p4]],
    playerHandicaps: {},
    // Team 1 (captain p1): 2 + (4-3) = 3 pts. Team 2 (captain p3): 2 + (4-5) = 1 pt.
    scores: { p1: { 1: 3 }, p3: { 1: 5 } },
  };

  const scrambleTournament = {
    id: 't-scramble',
    kind: 'tournament',
    name: 'Uniform Scramble',
    settings: { scoringMode: 'scramblepairs' },
    players: [p1, p2, p3, p4],
    rounds: [scrambleRound],
    currentRound: 0,
    // Explicitly archived so isTournamentFinished is true regardless of the
    // (scramble-specific) per-player score-completeness check.
    finishedAt: '2026-07-01T00:00:00Z',
  };

  beforeEach(() => {
    tournamentStore.loadAllTournaments.mockReset();
    tournamentStore.loadAllTournaments.mockResolvedValue([scrambleTournament]);
  });

  // Regression: with tournamentLeaderboard (individual-ball board), scramble
  // rounds were skipped entirely, so every player's points stayed 0 and the
  // win check (`leaderboard[0]?.points > 0`) never fired for anyone —
  // including the winning captain, who got credit pre-branch.
  test('winning team captain gets win credit', async () => {
    const stats = await computePersonalStats({ userId: 'u-p1', displayName: 'Ann' });
    expect(stats.wins).toBe(1);
  });

  // tournamentStablefordLeaderboard attributes the team's points to every
  // member (not just the scramble captain), so whichever winning-team member
  // sorts first also gets win credit — an improvement over the old
  // captain-only credit. Reordering the roster so the non-captain (p2) is
  // listed before the captain (p1) proves the credit isn't captain-specific.
  test('winning team non-captain member gets win credit when listed first in the roster', async () => {
    const reordered = { ...scrambleTournament, players: [p2, p1, p3, p4] };
    tournamentStore.loadAllTournaments.mockResolvedValue([reordered]);
    const stats = await computePersonalStats({ userId: 'u-p2', displayName: 'Bob' });
    expect(stats.wins).toBe(1);
  });

  test('losing team member gets no win credit', async () => {
    const stats = await computePersonalStats({ userId: 'u-p3', displayName: 'Cam' });
    expect(stats.wins).toBe(0);
  });
});
