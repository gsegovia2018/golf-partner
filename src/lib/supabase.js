import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const isWeb = Platform.OS === 'web';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // PKCE flow: OAuth redirects back with a `?code=` that we exchange for a
      // session (see AuthScreen `signInWithProvider`). The default `implicit`
      // flow returns tokens in the URL hash instead, which the native sign-in
      // path never reads — so login silently fails on Android.
      flowType: 'pkce',
      // Web: Supabase auto-exchanges the `?code=` in the URL on load.
      detectSessionInUrl: isWeb,
    },
  },
);

// Documented Supabase React Native pattern: drive the token auto-refresh
// ticker from AppState. Native has no visibilitychange, so without this the
// ticker keeps running against frozen JS timers while backgrounded and —
// more importantly — nothing proactively refreshes on resume; refreshing the
// moment the app is foregrounded (while there is usually still coverage)
// keeps the access token from being expired at the next cold start, which is
// the state the offline fallback in AuthContext exists to survive.
if (!isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
