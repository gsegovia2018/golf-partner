// ============================================================================
// Pure tee helpers. A "tee" is one set of markers on a course; each carries
// its own course rating and slope. A course owns an ordered list of tees
// (longest first). These functions have no IO and no module state.
// ============================================================================

// The middle tee of an ordered list — the sensible default when a player has
// no recorded tee history on a course. floor(length / 2): index 1 of 3,
// index 2 of 4. Returns null for an empty/missing list.
export function middleTee(tees) {
  if (!Array.isArray(tees) || tees.length === 0) return null;
  return tees[Math.floor(tees.length / 2)];
}

// Find a tee by label, case-insensitive and trimmed. Returns null when there
// is no match or inputs are missing.
export function teeByLabel(tees, label) {
  if (!Array.isArray(tees) || label == null) return null;
  const key = String(label).trim().toLowerCase();
  if (!key) return null;
  return tees.find((t) => String(t.label ?? '').trim().toLowerCase() === key) ?? null;
}

// A fresh empty tee for the editor. The id is client-generated so React keys
// are stable while editing; it is NOT persisted as a stable DB id (tees are
// saved delete-then-insert).
export function blankTee() {
  const id = `tee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, label: '', rating: null, slope: null, ratingWomen: null, slopeWomen: null };
}

// Effective {label, rating, slope} snapshot for one player on a tee. Every
// physical tee carries two WHS rating pairs — base (men) and optional
// women's (ratingWomen/slopeWomen — same markers, different conversion).
// Female players get the women's pair, falling back per-field when a course
// only has one rating set. Missing or unknown gender behaves as male.
export function resolveTeeForPlayer(tee, gender) {
  if (!tee) return null;
  const female = gender === 'female';
  return {
    label: tee.label,
    rating: female ? (tee.ratingWomen ?? tee.rating) : tee.rating,
    slope: female ? (tee.slopeWomen ?? tee.slope) : tee.slope,
  };
}
