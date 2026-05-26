// Parse a handicap-index string (WHS allows 0–54 to one decimal place).
// Returns { ok: true, value: number } or { ok: false, reason: string }.
// Callers may treat `reason: 'required'` differently from 'invalid' (e.g.,
// coerce empty input to 0 in optional fields).
export function parseHandicapIndex(input) {
  const trimmed = String(input ?? '').trim();
  if (trimmed === '') return { ok: false, reason: 'required' };
  if (!/^\d+(\.\d)?$/.test(trimmed)) return { ok: false, reason: 'invalid' };
  const value = parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 54) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, value };
}
