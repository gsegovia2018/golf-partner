// Pure helpers for the send-push webhook's Expo interaction. No Deno.serve,
// no I/O — importable and unit-testable without an HTTP harness.

/** Split `items` into consecutive slices of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ExpoReceipt = { status?: string; details?: { error?: string } };

/**
 * Maps ONE chunk's Expo response back to the tokens that were sent in that
 * same chunk, returning the tokens Expo reported as no longer registered.
 *
 * Alignment is strictly LOCAL to the chunk — receipt[i] corresponds to
 * chunkTokens[i]. If Expo's returned data isn't an array whose length
 * matches the number of tokens we sent in this chunk, we CANNOT trust the
 * positional mapping, so we prune nothing for this chunk and let the caller
 * log it. This guarantees a malformed or short response for one chunk can
 * never shift the token→receipt mapping of any other chunk.
 */
export function staleTokensForChunk(
  chunkTokens: { token: string }[],
  chunkData: unknown,
): string[] {
  if (!Array.isArray(chunkData) || chunkData.length !== chunkTokens.length) {
    return [];
  }
  const stale: string[] = [];
  (chunkData as ExpoReceipt[]).forEach((r, i) => {
    if (r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered') {
      stale.push(chunkTokens[i].token);
    }
  });
  return stale;
}
