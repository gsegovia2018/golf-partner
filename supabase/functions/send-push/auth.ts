// Shared-secret authorization for the send-push webhook.
//
// Supabase database webhooks let you configure custom HTTP headers, but
// there's no built-in signature scheme, so we require an operator-chosen
// shared secret sent as a header on every request. Kept in its own module
// (no `Deno.serve`, no side effects) so `isAuthorized` can be imported and
// unit-tested without spinning up an HTTP server.

/**
 * Constant-time byte comparison. Never short-circuits on the first
 * mismatching byte — always walks the full (max) length so the running
 * time doesn't leak *where* two secrets first differ. A length mismatch is
 * still detectable by an attacker (loop count is public via the code path),
 * but that leaks far less than early-exit byte comparison would.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Extracts the caller-supplied secret from either header convention Supabase
 * DB webhooks commonly use: a custom `x-webhook-secret` header, or a bearer
 * token in `Authorization`. Returns '' when neither is present.
 */
function extractProvidedSecret(headers: Headers): { fromAuth: string; fromCustom: string } {
  const authHeader = headers.get('authorization') ?? '';
  const customHeader = headers.get('x-webhook-secret') ?? '';
  const fromAuth = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length)
    : authHeader;
  return { fromAuth, fromCustom: customHeader };
}

/**
 * Pure authorization decision — no I/O, no env access. Fails closed: an
 * unset/empty `expectedSecret` always returns false, even if a request
 * happens to send an empty header (both would otherwise be "" === "").
 */
export function isAuthorized(
  headers: Headers,
  expectedSecret: string | undefined | null,
): boolean {
  if (!expectedSecret) return false;

  const { fromAuth, fromCustom } = extractProvidedSecret(headers);

  // Compute both comparisons unconditionally (no short-circuit) so overall
  // timing doesn't reveal which header, if either, was closer to correct.
  const authMatches = fromAuth.length > 0 && timingSafeEqual(fromAuth, expectedSecret);
  const customMatches = fromCustom.length > 0 && timingSafeEqual(fromCustom, expectedSecret);

  return authMatches || customMatches;
}
