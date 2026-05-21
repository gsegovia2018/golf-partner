import { renderHook } from '@testing-library/react-native';
import { useOfficialRound } from '../useOfficialRound';

// Casual rounds still call useOfficialRound (Rules of Hooks) with a null
// token, where it no-ops. The hook's return object must be referentially
// stable across renders — ScorecardScreen builds several useCallbacks on top
// of it, and a fresh object each render recreates all of them, defeating the
// scorecard's HolePage memoization on every +/- tap.
describe('useOfficialRound', () => {
  test('returns a referentially stable object across re-renders (null token)', () => {
    const { result, rerender } = renderHook(
      (props) => useOfficialRound(props),
      { initialProps: { token: null, roundId: null } },
    );
    const first = result.current;
    rerender({ token: null, roundId: null });
    expect(result.current).toBe(first);
  });
});
