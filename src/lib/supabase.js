import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
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
