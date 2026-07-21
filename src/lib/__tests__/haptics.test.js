import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { haptic } from '../haptics';
import { updateAppSettings, __resetAppSettingsForTests } from '../../store/settingsStore';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

beforeEach(() => {
  __resetAppSettingsForTests();
  jest.clearAllMocks();
});

test('fires the matching expo-haptics call per style', () => {
  haptic('selection');
  expect(Haptics.selectionAsync).toHaveBeenCalled();
  haptic('light');
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  haptic('medium');
  expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  haptic('success');
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
});

test('is silent when the haptics setting is off', async () => {
  await updateAppSettings({ haptics: false });
  haptic('selection');
  haptic('medium');
  haptic('success');
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('is a no-op on web', () => {
  const original = Platform.OS;
  Platform.OS = 'web';
  try {
    haptic('medium');
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  } finally {
    Platform.OS = original;
  }
});
