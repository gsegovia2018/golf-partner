import { shouldHandleStoreChange } from '../navigationFocus';

describe('shouldHandleStoreChange', () => {
  test('skips background reloads when the navigation tree is not focused', () => {
    expect(shouldHandleStoreChange({ isFocused: () => false })).toBe(false);
  });

  test('allows reloads for focused screens', () => {
    expect(shouldHandleStoreChange({ isFocused: () => true })).toBe(true);
  });

  test('allows reloads when focus information is unavailable', () => {
    expect(shouldHandleStoreChange({})).toBe(true);
  });
});
