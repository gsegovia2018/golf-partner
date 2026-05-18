import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

// Push notification plumbing. Registration is best-effort: a denied
// permission, a web browser, or a missing EAS project id all just mean no
// push — the in-app badge keeps working regardless.

// Foreground behaviour: still show the banner so the user sees the request
// without leaving their current screen.
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Ask permission, fetch this device's Expo push token, and store it. Safe to
// call on every app start — the upsert refreshes updated_at.
export async function registerPushToken() {
  try {
    if (Platform.OS === 'web') return; // Expo push tokens require a device
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    // getExpoPushTokenAsync needs the EAS project id. Read it defensively —
    // if the project has no EAS id yet, this throws and we no-op.
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await supabase.from('push_tokens').upsert(
      {
        user_id: user.id,
        token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );
  } catch {
    // best-effort — push is optional, the in-app badge is the guarantee
  }
}
