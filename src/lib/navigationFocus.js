export function shouldHandleStoreChange(navigation) {
  if (typeof navigation?.isFocused !== 'function') return true;
  try {
    return navigation.isFocused();
  } catch {
    return true;
  }
}
