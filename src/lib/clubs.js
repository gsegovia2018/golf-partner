// Canonical golf-club catalog + "your bag" helpers. Pure, no I/O — the bag
// itself lives in profiles.settings.bag (see settingsStore) and shots
// reference a club by its `key` here. Nominal carries are men's-ish averages
// used only for default ordering and as a soft fallback when a club has no
// logged shots yet; real recommendations come from the player's own data
// (see shotStats.js).

// Order is longest → shortest, putter last. `nominal` is metres of carry.
export const CLUB_CATALOG = [
  { key: 'driver', label: 'Driver', nominal: 230 },
  { key: '3w', label: '3 Wood', nominal: 210 },
  { key: '5w', label: '5 Wood', nominal: 195 },
  { key: '7w', label: '7 Wood', nominal: 180 },
  { key: '2h', label: '2 Hybrid', nominal: 195 },
  { key: '3h', label: '3 Hybrid', nominal: 185 },
  { key: '4h', label: '4 Hybrid', nominal: 175 },
  { key: '5h', label: '5 Hybrid', nominal: 165 },
  { key: '2i', label: '2 Iron', nominal: 190 },
  { key: '3i', label: '3 Iron', nominal: 180 },
  { key: '4i', label: '4 Iron', nominal: 170 },
  { key: '5i', label: '5 Iron', nominal: 160 },
  { key: '6i', label: '6 Iron', nominal: 150 },
  { key: '7i', label: '7 Iron', nominal: 140 },
  { key: '8i', label: '8 Iron', nominal: 130 },
  { key: '9i', label: '9 Iron', nominal: 118 },
  { key: 'pw', label: 'Pitching Wedge', nominal: 105 },
  { key: 'gw', label: 'Gap Wedge', nominal: 92 },
  { key: 'sw', label: 'Sand Wedge', nominal: 80 },
  { key: 'lw', label: 'Lob Wedge', nominal: 65 },
  { key: 'putter', label: 'Putter', nominal: 0 },
];

const BY_KEY = new Map(CLUB_CATALOG.map((c) => [c.key, c]));
const ORDER = new Map(CLUB_CATALOG.map((c, i) => [c.key, i]));

export const ALL_CLUB_KEYS = CLUB_CATALOG.map((c) => c.key);

// A sensible 14-club default set for players who haven't picked a bag yet.
export const DEFAULT_BAG = [
  'driver', '3w', '5w', '4h', '5i', '6i', '7i', '8i', '9i', 'pw', 'gw', 'sw', 'lw', 'putter',
];

export function clubLabel(key) { return BY_KEY.get(key)?.label ?? key; }
export function clubNominal(key) { return BY_KEY.get(key)?.nominal ?? null; }
export function isClubKey(key) { return BY_KEY.has(key); }

// Catalog index — sorts any club list longest → shortest (putter last).
export function clubOrder(key) { return ORDER.has(key) ? ORDER.get(key) : Number.MAX_SAFE_INTEGER; }

// Coerce an arbitrary stored value into a valid bag: keep only known club
// keys, de-dupe, and sort into catalog order. Empty/invalid input (including
// a missing settings blob) falls back to DEFAULT_BAG so the UI is never empty.
export function sanitizeBag(bag) {
  if (!Array.isArray(bag)) return [...DEFAULT_BAG];
  const seen = new Set();
  const out = [];
  for (const k of bag) {
    if (BY_KEY.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  if (!out.length) return [...DEFAULT_BAG];
  return out.sort((a, b) => clubOrder(a) - clubOrder(b));
}

// The bag minus the putter — the clubs offered when logging a full shot
// (you don't pick "putter" as the club you hit from the fairway; putts are
// handled as their own thing).
export function swingClubs(bag) {
  return sanitizeBag(bag).filter((k) => k !== 'putter');
}
