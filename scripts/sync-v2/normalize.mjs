// Shared round-trip normalization (spec Amendment 6): put a legacy blob and
// get_game_tournament()'s reassembled output into the same canonical shape
// before comparing them for equality. Used by both the Docker-driven
// validation during development and verify-roundtrip.mjs's live-DB check, so
// the two never drift out of sync with each other.
//
// Rules:
//   - drop `_meta` / `meId` (top-level) and `scoreConflicts` /
//     `scoreResolutions` (per round) from both sides — these are sync
//     bookkeeping, never part of the tournament's "real" shape.
//   - default a round's `scores` / `shotDetails` to `{}` when absent, so a
//     round with no cells compares equal to one that never had the key. Also
//     drop any per-player bucket whose value is an empty object (`{}`): a
//     player entered but with zero scores exists in the legacy blob, but
//     get_game_tournament omits zero-cell players (its aggregate only sees
//     players with a non-null cell), so an empty bucket is a shape-only diff.
//   - canonicalize a round's `notes` through normalizeRoundNotes (the app's
//     own rule, src/store/roundNotes.js) on BOTH sides: a legacy bare-STRING
//     note becomes `{ round: <str> }` (matching what get_game_tournament
//     reassembles from a 'round' note row), an empty `hole: {}` bucket is
//     stripped, and an empty result drops `notes` entirely.
//   - compare `createdAt` as `new Date(x).getTime()` (byte-format
//     differences, e.g. missing trailing zero milliseconds, don't matter).
//   - `dropKind` option: drop the top-level `kind` from BOTH sides. The
//     domain kind ('game'/'tournament') lives in props.kind and
//     get_game_tournament emits it, but one legacy prod blob has NO `kind`
//     key at all — for that row the reassembled side legitimately emits a
//     DERIVED kind (from round count), which isn't a "loss" of an absent
//     field, so the caller passes dropKind=true (computed from whether the
//     source blob carries a `kind` key) to exclude kind from the compare.
//     Rows WHOSE blob carries a kind still compare it strictly (dropKind
//     defaults false).
//   - everything else: left as-is for the caller's own deep-equal. Hole keys
//     are strings on both sides already (jsonb object keys, and
//     get_game_tournament emits `hole::text`) — no coercion needed.
import { normalizeRoundNotes } from '../../src/store/roundNotes.js';

// Drop any per-player bucket that is an empty object ({}) — a player entered
// with zero scores/shotDetails, which get_game_tournament omits entirely.
function dropEmptyPlayerBuckets(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map ?? {};
  const out = {};
  for (const [player, cells] of Object.entries(map)) {
    if (cells && typeof cells === 'object' && !Array.isArray(cells)
      && Object.keys(cells).length === 0) continue;
    out[player] = cells;
  }
  return out;
}

export function normalize(blob, { dropKind = false } = {}) {
  if (blob == null) return blob;
  const out = { ...blob };
  delete out._meta;
  delete out.meId;
  if (dropKind) delete out.kind;

  if (out.createdAt != null) {
    out.createdAt = new Date(out.createdAt).getTime();
  }

  if (Array.isArray(out.rounds)) {
    out.rounds = out.rounds.map((r) => {
      const round = { ...r };
      delete round.scoreConflicts;
      delete round.scoreResolutions;
      round.scores = dropEmptyPlayerBuckets(round.scores ?? {});
      round.shotDetails = dropEmptyPlayerBuckets(round.shotDetails ?? {});
      const notes = normalizeRoundNotes(round.notes);
      if (Object.keys(notes).length === 0) {
        delete round.notes;
      } else {
        round.notes = notes;
      }
      return round;
    });
  }

  return out;
}
