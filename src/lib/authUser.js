import { supabase } from './supabase';

// Who is signed in, without a network call. Stores used to ask
// supabase.auth.getUser(), a round-trip to /auth/v1/user that holds the auth
// client's lock for its whole duration: every other auth call (AuthContext's
// getSession, the next store's getUser) queued behind it, so on a weak signal
// the app sat on its splash until the first one came back. Stores only ever
// need the id (and the profile the email) — the server checks the JWT on
// every request, the client id only picks which rows to ask for.
//
// AuthContext hands over the session user it holds (including the stored
// session it keeps offline with an expired token). Until it has, the session
// on the device answers — getSession reads storage and only touches the
// network to refresh an expired token.
let _known = false;
let _user = null;

export function setAuthUser(user) {
  _known = true;
  _user = user ? { id: user.id, email: user.email ?? null } : null;
}

// The signed-in user ({ id, email }) or null when signed out. Throws when the
// device session can't be read (offline with an expired token before
// AuthContext has restored it), so a caller can tell "signed out" from
// "unknown" — see profileStore's onboarding note.
export async function authUser() {
  if (_known) return _user;
  const { data, error } = await supabase.auth.getSession();
  const user = data?.session?.user ?? null;
  if (!user && error) throw error;
  return user ? { id: user.id, email: user.email ?? null } : null;
}

// The signed-in user's id, or null (signed out or unknown). Never throws.
export async function authUserId() {
  try {
    return (await authUser())?.id ?? null;
  } catch {
    return null;
  }
}

// Tests only.
export function __resetAuthUserForTests() {
  _known = false;
  _user = null;
}
