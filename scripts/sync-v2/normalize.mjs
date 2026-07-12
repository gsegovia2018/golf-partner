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
//     round with no cells compares equal to one that never had the key.
//   - drop `notes` entirely when it's absent or only holds empty objects
//     (`{}`, `{ hole: {} }`, ...) — get_game_tournament never emits an empty
//     `notes`, but the legacy blob sometimes carries one as leftover shape
//     from an earlier edit.
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
export function stripEmptyNotesDeep(notes) {
  if (!notes || typeof notes !== 'object') return notes;
  const out = {};
  for (const [k, v] of Object.entries(notes)) {
    if (k === 'hole' && v && typeof v === 'object' && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

function isEmptyNotes(notes) {
  if (notes == null) return true;
  return Object.keys(stripEmptyNotesDeep(notes)).length === 0;
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
      round.scores = round.scores ?? {};
      round.shotDetails = round.shotDetails ?? {};
      if (isEmptyNotes(round.notes)) {
        delete round.notes;
      } else {
        round.notes = stripEmptyNotesDeep(round.notes);
      }
      return round;
    });
  }

  return out;
}
