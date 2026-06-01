export function normalizeRoundNotes(rawNotes) {
  if (rawNotes && typeof rawNotes === 'object' && !Array.isArray(rawNotes)) {
    const notes = { ...rawNotes };
    notes.hole = rawNotes.hole && typeof rawNotes.hole === 'object' && !Array.isArray(rawNotes.hole)
      ? { ...rawNotes.hole }
      : {};
    return notes;
  }

  if (typeof rawNotes === 'string' && rawNotes) {
    return { round: rawNotes, hole: {} };
  }

  return { hole: {} };
}

export function roundNoteText(rawNotes) {
  const notes = normalizeRoundNotes(rawNotes);
  return typeof notes.round === 'string' ? notes.round : '';
}
