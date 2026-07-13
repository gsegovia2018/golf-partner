jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
import { supabase } from '../../lib/supabase';
import { submitScore, resolveScore } from '../tournamentRepo';

beforeEach(() => supabase.rpc.mockReset());

test('submitScore calls submit_game_score with p_ params and returns data', async () => {
  supabase.rpc.mockResolvedValue({ data: { status: 'agreed', effective: 4, candidates: [] }, error: null });
  const out = await submitScore({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, authorId: 'a', strokes: 4 });
  expect(supabase.rpc).toHaveBeenCalledWith('submit_game_score', {
    p_tournament_id: 't', p_round_id: 'r', p_player_id: 'p', p_hole: 3, p_author_id: 'a', p_strokes: 4,
  });
  expect(out).toEqual({ status: 'agreed', effective: 4, candidates: [] });
});

test('resolveScore calls resolve_game_score', async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: null });
  await resolveScore({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, value: 4, resolvedBy: 'a' });
  expect(supabase.rpc).toHaveBeenCalledWith('resolve_game_score', {
    p_tournament_id: 't', p_round_id: 'r', p_player_id: 'p', p_hole: 3, p_value: 4, p_resolver: 'a',
  });
});
