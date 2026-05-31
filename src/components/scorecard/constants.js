// Shared constants for the scorecard module: shot-detail schema, driver and
// distance-bucket option sets, and birdie/eagle celebration tiers.

// One per-hole shot-detail record. Distance buckets use the metre ranges in
// FIRST_PUTT_BUCKETS / APPROACH_BUCKETS.
export const DEFAULT_SHOT = {
  putts: null,
  drive: null,
  teePenalties: 0,
  otherPenalties: 0,
  sandShots: 0,
  recoveryOutcome: null,        // 'up-and-down' | 'sand-save' | 'none' | null
  firstPuttBucket: null,        // '0-1' | '1-2' | '2-3' | '3-6' | '6+' | null
  approachBucket: null,         // '0-50' | '50-100' | '100-150' | '150-200' | '200+' | null
  approachResult: null,         // 'green' | 'miss' | null
};

// Driver direction, in display order: miss-left, fairway (on target),
// miss-right, short, then `super` for a stand-out tee shot.
export const DRIVE_ORDER = ['left', 'fairway', 'right', 'short', 'super'];
export const DRIVE_META = {
  left: { label: 'Left', icon: 'arrow-up-left' },
  fairway: { label: 'Fairway', icon: 'circle' },
  right: { label: 'Right', icon: 'arrow-up-right' },
  short: { label: 'Short', icon: 'arrow-down' },
  super: { label: 'Super', icon: 'star' },
};

// Labels omit the unit; the section's "metres" hint already states it.
export const FIRST_PUTT_BUCKETS = ['0-1', '1-2', '2-3', '3-6', '6+'];
export const FIRST_PUTT_LABELS = {
  '0-1': '0-1', '1-2': '1-2', '2-3': '2-3',
  '3-6': '3-6', '6+': '6+',
};

export const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
export const APPROACH_LABELS = {
  '0-50': '0-50', '50-100': '50-100', '100-150': '100-150',
  '150-200': '150-200', '200+': '200+',
};

export const CELEBRATION_TIERS = {
  BIRDIE: {
    eyebrow: 'A BIRDIE',
    accent: '#f0c419', // soft gold
    glow: 'rgba(240,196,25,0.35)',
    icon: 'star',
  },
  EAGLE: {
    eyebrow: 'AN EAGLE',
    accent: '#ffd700', // Augusta gold
    glow: 'rgba(255,215,0,0.45)',
    icon: 'award',
  },
  ALBATROSS: {
    eyebrow: 'AN ALBATROSS',
    accent: '#ffffff',
    glow: 'rgba(255,255,255,0.55)',
    icon: 'star',
  },
  'HOLE IN ONE': {
    eyebrow: 'A HOLE IN ONE',
    accent: '#ffd700',
    glow: 'rgba(255,215,0,0.65)',
    icon: 'target',
  },
};

// Celebration label for a hole result, or null when it isn't notable.
export function celebrationFor(par, strokes) {
  if (!par || !strokes) return null;
  if (strokes === 1 && par > 1) return 'HOLE IN ONE';
  const diff = par - strokes;
  if (diff >= 3) return 'ALBATROSS';
  if (diff === 2) return 'EAGLE';
  if (diff === 1) return 'BIRDIE';
  return null;
}
