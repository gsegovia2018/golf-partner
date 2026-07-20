// Shared constants for the scorecard module: shot-detail schema, driver and
// distance-bucket option sets, and birdie/eagle celebration tiers.

import { semantic } from '../../theme/tokens';

// One per-hole shot-detail record. Distance buckets use the metre ranges in
// FIRST_PUTT_BUCKETS / APPROACH_BUCKETS.
export const DEFAULT_SHOT = {
  putts: null,
  drive: null,
  teeClub: null,                // 'driver' | 'wood' | 'hybrid' | 'iron' | null (null = driver)

  driveLie: null,               // 'fairway' | 'rough' | 'sand' | 'trouble' | null (derived from drive when null)
  driveDistBucket: null,        // '0-150' | '150-180' | '180-210' | '210-240' | '240+' | null (metres)
  teePenalties: 0,
  otherPenalties: 0,
  sandShots: 0,
  recoveryOutcome: null,        // 'up-and-down' | 'sand-save' | 'none' | null
  firstPuttBucket: null,        // '0-1' | '1-2' | '2-3' | '3-6' | '6+' | null
  approachBucket: null,         // '0-50' | '50-100' | '100-150' | '150-200' | '200+' | null
  approachResult: null,         // 'green' | 'miss' | null
  approachLie: null,            // 'fairway' | 'rough' | 'sand' | null (null = fairway)
};

// Which DEFAULT_SHOT fields belong to each configurable tracking group
// (Settings → Stats tracking). Hiding a group hides exactly these inputs.
export const STAT_GROUP_FIELDS = {
  putting: ['putts', 'firstPuttBucket'],
  teeShot: ['teeClub', 'drive', 'driveLie', 'driveDistBucket'],
  approach: ['approachBucket', 'approachResult', 'approachLie'],
  shortGame: ['sandShots', 'recoveryOutcome'],
  penalties: ['teePenalties', 'otherPenalties'],
};

// Club hit off the tee. Driver is the default and stays unstored (null);
// the off-the-tee SG benchmark scales down for shorter clubs.
export const TEE_CLUBS = ['driver', 'wood', 'hybrid', 'iron'];
export const TEE_CLUB_LABELS = { driver: 'Driver', wood: 'Wood', hybrid: 'Hybrid', iron: 'Iron' };

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

export const DRIVE_DIST_BUCKETS = ['0-150', '150-180', '180-210', '210-240', '240+'];
export const DRIVE_DIST_LABELS = {
  '0-150': '<150', '150-180': '150-180', '180-210': '180-210',
  '210-240': '210-240', '240+': '240+',
};

// Yard-equivalent display labels for the meter-defined buckets (storage keys
// never change). Rounded to friendly 5s.
export const DRIVE_DIST_LABELS_YD = {
  '0-150': '<165', '150-180': '165-195', '180-210': '195-230',
  '210-240': '230-260', '240+': '260+',
};
export const APPROACH_LABELS_YD = {
  '0-50': '0-55', '50-100': '55-110', '100-150': '110-165',
  '150-200': '165-220', '200+': '220+',
};
export const FIRST_PUTT_LABELS_YD = {
  '0-1': '0-1', '1-2': '1-2', '2-3': '2-3', '3-6': '3-7', '6+': '7+',
};

// Where a missed drive finished. Fairway hits need no lie — the direction
// chip already says fairway; the engine derives rough for unset misses.
export const DRIVE_MISS_LIES = ['rough', 'sand', 'trouble'];
export const DRIVE_MISS_LIE_LABELS = { rough: 'Rough', sand: 'Sand', trouble: 'Trouble' };

export const APPROACH_LIES = ['fairway', 'rough', 'sand'];
export const APPROACH_LIE_LABELS = { fairway: 'Fairway', rough: 'Rough', sand: 'Sand' };

export const CELEBRATION_TIERS = {
  BIRDIE: {
    eyebrow: 'A BIRDIE',
    accent: '#f0c419', // soft gold
    glow: 'rgba(240,196,25,0.35)',
    icon: 'star',
  },
  EAGLE: {
    eyebrow: 'AN EAGLE',
    accent: semantic.winner.dark, // Augusta gold
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
    accent: semantic.winner.dark,
    glow: 'rgba(255,215,0,0.65)',
    icon: 'target',
  },
  NOELADA: {
    eyebrow: 'WHAT A NOELADA!',
    accent: '#e74c3c', // shame red
    glow: 'rgba(231,76,60,0.35)',
    icon: 'frown',
  },
};

// Celebration label for a hole result, or null when it isn't notable.
// Double bogey or worse gets the NOELADA anti-celebration.
export function celebrationFor(par, strokes) {
  if (!par || !strokes) return null;
  if (strokes === 1 && par > 1) return 'HOLE IN ONE';
  const diff = par - strokes;
  if (diff >= 3) return 'ALBATROSS';
  if (diff === 2) return 'EAGLE';
  if (diff === 1) return 'BIRDIE';
  if (diff <= -2) return 'NOELADA';
  return null;
}

// Classify a hole's strokes relative to par, for the scorecard shape overlay
// (circle for birdie, double circle for eagle-or-better, square for bogey,
// double square for double-bogey-or-worse, nothing for par). Pure; returns
// null when par or strokes are missing / non-positive.
//   'eagle'  — strokes <= par - 2 (eagle or better; a hole-in-one on any
//              par > 1 also counts here)
//   'birdie' — par - 1
//   'par'    — level par
//   'bogey'  — par + 1
//   'double' — strokes >= par + 2 (double bogey or worse)
export function classifyHoleResult(par, strokes) {
  if (!par || !strokes || par < 1 || strokes < 1) return null;
  if (strokes === 1 && par > 1) return 'eagle';
  const diff = strokes - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  return 'double';
}
