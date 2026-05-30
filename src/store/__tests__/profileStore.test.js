import { loadProfile, upsertProfile } from '../profileStore';
import { supabase } from '../../lib/supabase';

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
});
