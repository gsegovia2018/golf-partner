import AsyncStorage from '@react-native-async-storage/async-storage';

export const SHOT_DETAIL_COLLAPSED_KEY = '@scorecard_shot_detail_collapsed';

// Default OFF (expanded): new users see the shot detail section until they
// collapse it. The choice persists across app sessions.
export async function getShotDetailCollapsed() {
  const v = await AsyncStorage.getItem(SHOT_DETAIL_COLLAPSED_KEY);
  if (v == null) return false;
  return v === '1';
}

export async function setShotDetailCollapsed(collapsed) {
  await AsyncStorage.setItem(SHOT_DETAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
}
