const light = {
  bg: {
    primary:   '#f6f3ee',
    card:      '#ffffff',
    secondary: '#ece8e1',
    elevated:  '#ffffff',
  },
  accent: {
    primary:   '#1a6b4a',
    light:     '#e8f5ee',
    pressed:   '#155a3e',
  },
  text: {
    primary:   '#1a1a1a',
    secondary: '#6b7280',
    muted:     '#8a8a7a',
    inverse:   '#ffffff',
  },
  border: {
    default:   '#ece8e1',
    subtle:    '#f0ede8',
  },
  shadow: {
    card:     { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 6, elevation: 2 },
    elevated: { shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 2 }, shadowRadius: 12, elevation: 4 },
    accent:   { shadowColor: '#1a6b4a', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
  },
  glass: null,
};

const dark = {
  bg: {
    primary:   '#0e1117',
    card:      'rgba(255,255,255,0.03)',
    secondary: 'rgba(255,255,255,0.04)',
    elevated:  'rgba(255,255,255,0.06)',
  },
  accent: {
    primary:   '#34d399',
    light:     'rgba(52,211,153,0.10)',
    pressed:   '#2bb885',
  },
  text: {
    primary:   '#f0f2f5',
    secondary: '#9aa3b4',
    muted:     '#5a6577',
    inverse:   '#0e1117',
  },
  border: {
    default:   'rgba(255,255,255,0.07)',
    subtle:    'rgba(255,255,255,0.04)',
  },
  shadow: {
    card:     { shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
    elevated: { shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 16, elevation: 6 },
    accent:   { shadowColor: '#34d399', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 3 },
  },
  glass: {
    border:    'rgba(255,255,255,0.08)',
    highlight: 'rgba(255,255,255,0.02)',
  },
};

const semantic = {
  rank: {
    gold:   '#d4af37',
    silver: '#94a3b8',
    bronze: '#c47c3a',
  },
  destructive: {
    light: '#ef4444',
    dark:  '#f87171',
  },
  pair: {
    a: { light: '#1a6b4a', dark: '#34d399' },
    b: { light: '#c47c3a', dark: '#f59e0b' },
  },
  score: {
    excellent: { light: '#1a6b4a', dark: '#34d399' },
    good:      { light: '#3d8b63', dark: '#6ee7b7' },
    neutral:   { light: '#8a8a7a', dark: '#5a6577' },
    poor:      { light: '#ef4444', dark: '#f87171' },
  },
};

const typography = {
  display:  { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
  title:    { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, lineHeight: 28 },
  heading:  { fontSize: 16, fontWeight: '700', letterSpacing: 0,    lineHeight: 22 },
  subhead:  { fontSize: 14, fontWeight: '600', letterSpacing: 0,    lineHeight: 20 },
  body:     { fontSize: 14, fontWeight: '500', letterSpacing: 0,    lineHeight: 20 },
  caption:  { fontSize: 12, fontWeight: '500', letterSpacing: 0,    lineHeight: 16 },
  overline: { fontSize: 10, fontWeight: '600', letterSpacing: 1.5,  lineHeight: 14, textTransform: 'uppercase' },
  tiny:     { fontSize: 10, fontWeight: '500', letterSpacing: 0,    lineHeight: 14 },
};

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const radius  = { sm: 8, md: 10, lg: 14, xl: 16, pill: 20, full: 9999 };

export { light, dark, semantic, typography, spacing, radius };
