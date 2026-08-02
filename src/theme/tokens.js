// The one light-theme red: Masters red. Referenced by semantic.masters.red,
// light destructive, and the light "poor" score tone so light surfaces never
// mix two different reds. Dark surfaces keep the lighter #f87171.
const MASTERS_RED = '#c8102e';

// Dark hero surfaces — "green plays, navy thinks". DEEP_GREEN carries
// play & results (LiveRoundCard, leaderboard, FormHero, CourseStats);
// DEEP_INFO carries analysis & records (ShotDashboard, CoachHero,
// CareerMilestones — the dark surface of semantic.info). #006747 stays the
// interactive accent (buttons, chips, active states). Same values both themes.
const DEEP_GREEN = '#00553c';
const DEEP_INFO = '#2b4766';

const light = {
  bg: {
    primary:   '#f6f3ee',
    card:      '#ffffff',
    secondary: '#ece8e1',
    elevated:  '#ffffff',
    deep:      DEEP_GREEN,
    deepInfo:  DEEP_INFO,
  },
  accent: {
    primary:   '#006747',
    light:     '#e6f0eb',
    pressed:   '#005538',
  },
  text: {
    primary:   '#1a1a1a',
    secondary: '#6b7280',
    muted:     '#8a8a7a',
    inverse:   '#ffffff',
  },
  border: {
    default:   '#e7e2d5',
    subtle:    '#f0ede8',
  },
  shadow: {
    card:     { shadowColor: '#000', shadowOpacity: 0, shadowOffset: { width: 0, height: 0 }, shadowRadius: 0, elevation: 0 },
    elevated: { shadowColor: DEEP_GREEN, shadowOpacity: 0.10, shadowOffset: { width: 0, height: 4 }, shadowRadius: 14, elevation: 4 },
    accent:   { shadowColor: '#006747', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
  },
  glass: null,
};

const dark = {
  bg: {
    primary:   '#0c1a14',
    card:      'rgba(6,103,71,0.08)',
    secondary: 'rgba(255,255,255,0.04)',
    elevated:  'rgba(255,255,255,0.06)',
    deep:      DEEP_GREEN,
    deepInfo:  DEEP_INFO,
  },
  accent: {
    primary:   '#4fae8a',
    light:     'rgba(79,174,138,0.10)',
    pressed:   '#3d9a75',
  },
  text: {
    primary:   '#f0f2f5',
    secondary: '#9aa3b4',
    muted:     '#5a6577',
    inverse:   '#0c1a14',
  },
  border: {
    default:   'rgba(255,255,255,0.07)',
    subtle:    'rgba(255,255,255,0.04)',
  },
  shadow: {
    card:     { shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
    elevated: { shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 16, elevation: 6 },
    accent:   { shadowColor: '#4fae8a', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
  },
  glass: {
    border:    'rgba(79,174,138,0.12)',
    highlight: 'rgba(255,255,255,0.02)',
  },
};

const semantic = {
  rank: {
    gold:   '#d4af37',
    silver: '#94a3b8',
    bronze: '#c47c3a',
  },
  // Winner gold, three duties: `light` is a deep ledger gold that reads on
  // light cards (bright golds wash out on white), `dark` is the full Masters
  // gold for dark/tinted surfaces, `soft` is the muted gold the round summary
  // uses in dark mode where #ffd700 would shout.
  winner: {
    light: '#8a6d00',
    dark:  '#ffd700',
    soft:  '#e8c45f',
  },
  // Score-conflict amber — two devices recorded different scores for the
  // same cell. Same value in both themes (it always sits on its own tinted
  // chip/card). `ink` is for text/icons ON the amber chip: white fails AA
  // there (~3.4:1), this warm near-black clears 5:1.
  conflict: {
    base: '#c77a0a',
    ink:  '#231303',
  },
  destructive: {
    light: MASTERS_RED,
    dark:  '#f87171',
  },
  // Informational — for stats that are neither good nor bad (counts,
  // magnitudes, progress-to-unlock). Green means good, red means bad;
  // this slate blue means "just a fact".
  info: {
    light: '#3e638f',
    dark:  '#8fb0d6',
  },
  // In-progress / caution — GPS acquiring a fix, and any "working on it"
  // state that isn't yet good or bad. Amber reads as transient, not alarming.
  warning: {
    light: '#b8791a',
    dark:  '#e0b24d',
  },
  pair: {
    a: { light: '#006747', dark: '#4fae8a' },
    b: { light: '#c47c3a', dark: '#f59e0b' },
  },
  score: {
    excellent: { light: '#006747', dark: '#4fae8a' },
    good:      { light: '#2a7d56', dark: '#6ee7b7' },
    neutral:   { light: '#8a8a7a', dark: '#5a6577' },
    poor:      { light: MASTERS_RED, dark: '#f87171' },
  },
  masters: {
    yellow: '#ffd700',
    red:    MASTERS_RED,
    pink:   '#d4729b',
  },
};

// Fixed dark chrome for the GPS/map overlays — hole flyover sheet, shot
// tracker, club wheel, geo editor. They float over satellite imagery, where
// themed (possibly white) surfaces would glare outdoors and wash out against
// the map, so this palette is deliberately theme-independent, like a camera
// viewfinder. The accent is the dark theme's brand green so map chrome
// speaks the same green as the rest of the app.
const hud = {
  bg:        '#0a0d10',            // full-screen sheet surface
  card:      '#12171c',            // floating cards & dialogs
  inset:     '#131c17',            // inactive segmented buttons
  border:    '#23332a',            // hairlines on inset surfaces
  line:      'rgba(255,255,255,0.12)', // card outlines
  fill:      'rgba(255,255,255,0.06)', // subtle button fills
  accent:    '#4fae8a',            // actions & active states
  accentPressed: '#3d9a75',
  onAccent:  '#0a0d10',            // text/icons on accent fills
  text:      '#ffffff',
  textDim:   'rgba(255,255,255,0.55)', // de-emphasised wheel rows
  textSoft:  '#cfe3d5',            // secondary labels
  textMuted: '#9fb0a4',            // hints & metadata
  danger:    '#e8a0a0',            // destructive labels on dark chrome
  scrim:     'rgba(4,6,8,0.6)',    // modal backdrop
};

const typography = {
  display:  { fontSize: 30, fontWeight: '900', letterSpacing: -0.5, lineHeight: 38 },
  title:    { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, lineHeight: 30 },
  heading:  { fontSize: 16, fontWeight: '700', letterSpacing: 0,    lineHeight: 22 },
  subhead:  { fontSize: 14, fontWeight: '600', letterSpacing: 0,    lineHeight: 20 },
  body:     { fontSize: 14, fontWeight: '500', letterSpacing: 0,    lineHeight: 20 },
  caption:  { fontSize: 12, fontWeight: '500', letterSpacing: 0,    lineHeight: 16 },
  overline: { fontSize: 10, fontWeight: '600', letterSpacing: 1.5,  lineHeight: 14, textTransform: 'uppercase' },
  tiny:     { fontSize: 10, fontWeight: '500', letterSpacing: 0,    lineHeight: 14 },
};

const fonts = {
  serif: 'PlayfairDisplay',
  sans:  'PlusJakartaSans',
};

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const radius  = { sm: 8, md: 10, lg: 14, xl: 20, pill: 20, full: 9999 };

export { light, dark, semantic, hud, typography, fonts, spacing, radius };
