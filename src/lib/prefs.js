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
