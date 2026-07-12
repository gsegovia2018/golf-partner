// Normalizes a round's raw `notes` field into the canonical shape used
// everywhere in the app. Mirrors get_game_tournament's assembly exactly
// (see the sync_v2 migration's notes jsonb_build_object): `round` is only
// present when there's a round-scope note, and `hole` is only present when
// there's at least one hole note — an empty `hole: {}` bucket is NEVER
// injected just because a round note exists (that was a parity bug: local
// mutations used to always force `hole: {}`, so a device that authored a
// note locally disagreed with the shape of the same tournament refetched
// from the server, which never emits an empty `hole`). Callers that read
// notes.hole must use `notes.hole ?? {}` — see mutate.js's note.set and
// mutationWrites.js's round.resetContent.
export function normalizeRoundNotes(rawNotes) {
  if (rawNotes && typeof rawNotes === 'object' && !Array.isArray(rawNotes)) {
    const notes = { ...rawNotes };
    if (rawNotes.hole && typeof rawNotes.hole === 'object' && !Array.isArray(rawNotes.hole)
      && Object.keys(rawNotes.hole).length > 0) {
      notes.hole = { ...rawNotes.hole };
    } else {
      delete notes.hole;
    }
    return notes;
  }

  if (typeof rawNotes === 'string' && rawNotes) {
    return { round: rawNotes };
  }

  return {};
}

export function roundNoteText(rawNotes) {
  const notes = normalizeRoundNotes(rawNotes);
  return typeof notes.round === 'string' ? notes.round : '';
}
