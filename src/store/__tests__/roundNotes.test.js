import { normalizeRoundNotes, roundNoteText } from '../roundNotes';

// Task 13.1 parity fix: get_game_tournament (see the sync_v2 migration) only
// ever emits `round` when a round-scope note row exists, and only ever emits
// `hole` when at least one hole-note row exists — it never adds an empty
// bucket for the side that's absent. normalizeRoundNotes must match exactly,
// so a device that authors a note locally sees the same shape a refetch from
// the server would produce.
describe('normalizeRoundNotes', () => {
  test('undefined/null/missing notes normalize to an empty object', () => {
    expect(normalizeRoundNotes(undefined)).toEqual({});
    expect(normalizeRoundNotes(null)).toEqual({});
  });

  test('an empty string normalizes to an empty object', () => {
    expect(normalizeRoundNotes('')).toEqual({});
  });

  test('a legacy plain-string note becomes { round }, with no hole key', () => {
    const notes = normalizeRoundNotes('Great round');
    expect(notes).toEqual({ round: 'Great round' });
    expect(notes).not.toHaveProperty('hole');
  });

  test('a round-only object note keeps { round }, with no hole key', () => {
    const notes = normalizeRoundNotes({ round: 'Windy back nine' });
    expect(notes).toEqual({ round: 'Windy back nine' });
    expect(notes).not.toHaveProperty('hole');
  });

  test('a hole-only object note keeps { hole }, with no round key', () => {
    const notes = normalizeRoundNotes({ hole: { 5: 'Fairway bunker' } });
    expect(notes).toEqual({ hole: { 5: 'Fairway bunker' } });
    expect(notes).not.toHaveProperty('round');
  });

  test('an explicit empty hole bucket is stripped, not preserved', () => {
    const notes = normalizeRoundNotes({ round: 'Windy', hole: {} });
    expect(notes).toEqual({ round: 'Windy' });
    expect(notes).not.toHaveProperty('hole');
  });

  test('both round and hole notes are preserved together', () => {
    const notes = normalizeRoundNotes({ round: 'Windy', hole: { 3: 'Lost ball' } });
    expect(notes).toEqual({ round: 'Windy', hole: { 3: 'Lost ball' } });
  });

  test('a fully empty object note normalizes to an empty object', () => {
    expect(normalizeRoundNotes({})).toEqual({});
  });
});

describe('roundNoteText', () => {
  test('returns the round text when present', () => {
    expect(roundNoteText({ round: 'Windy back nine' })).toBe('Windy back nine');
  });

  test('returns an empty string when there is no round note', () => {
    expect(roundNoteText({ hole: { 3: 'Lost ball' } })).toBe('');
    expect(roundNoteText(undefined)).toBe('');
    expect(roundNoteText({})).toBe('');
  });
});
