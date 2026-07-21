import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getAppSettings } from '../store/settingsStore';

// The one haptics helper. Every vibration in the app goes through here so
// the "Haptic feedback" setting is honoured everywhere. No-op on web.
//
//   selection — tiny tick: toggles, pickers, tab presses
//   light     — score taps / stepper changes
//   medium    — bigger actions: hole change, long-press-to-clear
//   success   — round finished / saved
export function haptic(style = 'light') {
  if (Platform.OS === 'web') return;
  if (getAppSettings().haptics === false) return;
  if (style === 'selection') Haptics.selectionAsync();
  else if (style === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
