// Normalize a raw handicap text-input value so a locale comma decimal
// (e.g. "12,5", which is what comma-locale Android keyboards emit from a
// `decimal-pad`/`numeric` keyboard) parses the same as a period decimal.
// Single source of truth for every handicap entry point — call this before
// showing/parsing a value so all call sites stay in sync (see task-5-brief.md:
// only ProfileScreen used to do this, so every other screen silently saved
// comma input as a handicap of 0).
export function normalizeHandicapInput(value) {
  return String(value ?? '').replace(',', '.');
}

// Parse a handicap-index string (WHS allows 0–54 to one decimal place).
// Accepts a comma OR period decimal separator (normalized internally via
// normalizeHandicapInput) so callers never need to remember to normalize
// first. Returns { ok: true, value: number } or { ok: false, reason: string }.
// Callers may treat `reason: 'required'` differently from 'invalid' (e.g.,
// coerce empty input to 0 in optional fields) — but must NEVER silently
// coerce an 'invalid' (garbage/out-of-range) result to 0; that badly skews
// net scoring. Surface an inline error and block the save, or keep the
// prior value, instead.
export function parseHandicapIndex(input) {
  const trimmed = normalizeHandicapInput(input).trim();
  if (trimmed === '') return { ok: false, reason: 'required' };
  if (!/^\d+(\.\d)?$/.test(trimmed)) return { ok: false, reason: 'invalid' };
  const value = parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 54) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, value };
}
