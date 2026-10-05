import { supabase } from './supabase';

// Turning a guest (anonymous) session into a keepable account: attaching an
// email makes Supabase send a confirmation link, and confirming it converts
// the same user (same id, same data) into a permanent account.

export const EMAIL_TAKEN_MESSAGE = 'That email already has a Golf Partner account.';

// GoTrue answers 422 `email_exists` when the address belongs to another user.
export function isEmailTakenError(error) {
  if (!error) return false;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(String(error.message ?? ''));
}

// The built-in SMTP is heavily rate-limited on the free tier.
export function isEmailThrottledError(error) {
  if (!error) return false;
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) return true;
  return /rate limit/i.test(String(error.message ?? ''));
}

// Attach `email` (and the name, as user metadata) to the current guest.
// Resolves 'sent', or 'throttled' when the confirmation email could not be
// sent right now (the guest can still join; the email is not attached).
// Throws the AuthError otherwise — check it with isEmailTakenError().
export async function attachEmailToGuest({ email, name }) {
  const fullName = String(name ?? '').trim();
  const { error } = await supabase.auth.updateUser({
    email: String(email ?? '').trim(),
    data: { full_name: fullName, display_name: fullName },
  });
  if (!error) return 'sent';
  if (isEmailThrottledError(error)) return 'throttled';
  throw error;
}
