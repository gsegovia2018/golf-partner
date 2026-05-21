import AsyncStorage from '@react-native-async-storage/async-storage';

export const SHOW_RUNNING_SCORE_KEY = '@scorecard_show_running_score';

// Default ON: new users see per-player running points until they opt out.
export async function getShowRunningScore() {
  const v = await AsyncStorage.getItem(SHOW_RUNNING_SCORE_KEY);
  if (v == null) return true;
  return v === '1';
}

export async function setShowRunningScore(enabled) {
  await AsyncStorage.setItem(SHOW_RUNNING_SCORE_KEY, enabled ? '1' : '0');
}

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
