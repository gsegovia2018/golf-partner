// Where a new sign-in lands when it started on a public page (plan 2026-10-31-swing-share):
// "Create account" on a shared swing sends the new player to the Swing tab. Stored, because a
// Google sign-in on the web leaves the page and comes back, and an email sign-up signs in later.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'golf_after_auth.v1';
export const AFTER_AUTH_TTL_MS = 24 * 60 * 60 * 1000;

/** Remember where to land after the next sign-in ('swing'). */
export async function setAfterAuth(target, now = Date.now()) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify({ target, at: now })); } catch { /* best effort */ }
}

/** The target stored within the last day, removed as it is read; else null. */
export async function takeAfterAuth(now = Date.now()) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    const v = JSON.parse(raw);
    return v?.target && now - (v.at ?? 0) < AFTER_AUTH_TTL_MS ? v.target : null;
  } catch {
    return null;
  }
}
