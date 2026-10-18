import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useFocusTarget } from '../useFocusTarget';
import { loadFocus } from '../../store/coachFocus';
import { focusTarget } from '../../store/focusTarget';

jest.mock('../../store/coachFocus', () => ({ loadFocus: jest.fn() }));
jest.mock('../../store/focusTarget', () => ({ focusTarget: jest.fn() }));

const TARGET = { shot: 'approach', kind: 'swing', bucket: null, lie: null, title: { key: 't' }, cue: { key: 'c' } };
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

beforeEach(() => {
  jest.clearAllMocks();
  loadFocus.mockResolvedValue(null);
  focusTarget.mockReturnValue(null);
});

test('resolves a stored focus to a target', async () => {
  loadFocus.mockResolvedValue({ v: 2 });
  focusTarget.mockReturnValue(TARGET);
  const { result } = renderHook(() => useFocusTarget('u1'));
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current).toBe(TARGET));
  expect(loadFocus).toHaveBeenCalledWith('u1');
});

test('null without a focus, and no extra render', async () => {
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return useFocusTarget('u1'); });
  await flush();
  expect(result.current).toBeNull();
  expect(renders).toBe(1);
});

test('reloads on a user change', async () => {
  loadFocus.mockResolvedValue({ v: 2 });
  focusTarget.mockReturnValue(TARGET);
  const { result, rerender } = renderHook(({ id }) => useFocusTarget(id), { initialProps: { id: 'u1' } });
  await waitFor(() => expect(result.current).toBe(TARGET));
  focusTarget.mockReturnValue(null);
  rerender({ id: 'u2' });
  await waitFor(() => expect(result.current).toBeNull());
  expect(loadFocus).toHaveBeenLastCalledWith('u2');
});
