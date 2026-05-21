import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// One active magic token per device. Set when a player opens an invite link.
const TOKEN_KEY = '@golf_official_token';

export async function saveToken(token) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

// Resolve a token to its roster player + tournament context. If an app
// account is signed in on this device, link it so the round reaches that
// account's history (best-effort — link failure must not block play).
export async function redeemToken(token) {
  const { data, error } = await supabase.rpc('redeem_token', { p_token: token });
  if (error) throw error;
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.rpc('link_token_to_user', { p_token: token }).catch(() => {});
  }
  return data; // { roster_id, display_name, handicap, tournament_id, withdrawn }
}
