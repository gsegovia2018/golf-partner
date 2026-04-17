# Golf Partner — UI Redesign Spec

## Context

Golf Partner is a React Native (Expo) tournament scoring app for groups of 4 golfers. It currently has a dark-only theme with hardcoded colors across 11 screens, no centralized design system, Unicode characters as icons, and minimal animations. The goal is a radical visual redesign that feels like it was crafted by a senior designer at a top agency — modern, elegant, minimalist, with both light and dark modes.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Light mode aesthetic | Modern Organic — warm backgrounds, forest green, soft shadows |
| Dark mode aesthetic | Tech Glassmorphism — deep dark, glass cards, luminous borders |
| Default mode | Light |
| Accent color | Emerald Mint — `#1a6b4a` (light) → `#34d399` (dark) |
| Typography | Plus Jakarta Sans (Google Fonts via Expo) |
| Animations | Elegant & subtle — transitions, press feedback, staggered lists |
| Scope | Visual redesign + small UX improvements (same screens/flows) |
| Implementation | Custom Theme System (Context + tokens) |

## 1. Design Tokens

### 1.1 Color Palette — Light Mode (Modern Organic)

```js
light: {
  bg: {
    primary:   '#f6f3ee',  // warm cream — main background
    card:      '#ffffff',  // white — card surfaces
    secondary: '#ece8e1',  // muted beige — secondary surfaces, inactive tabs
    elevated:  '#ffffff',  // elevated surfaces (same as card in light)
  },
  accent: {
    primary:   '#1a6b4a',  // emerald — primary actions, active elements
    light:     '#e8f5ee',  // tinted green — badges, highlights
    pressed:   '#155a3e',  // darker emerald — button press state
  },
  text: {
    primary:   '#1a1a1a',  // near-black — headings, primary content
    secondary: '#6b7280',  // gray — body text, descriptions
    muted:     '#8a8a7a',  // warm gray — captions, timestamps
    inverse:   '#ffffff',  // white — text on accent backgrounds
  },
  border: {
    default:   '#ece8e1',  // beige — card borders, dividers
    subtle:    '#f0ede8',  // lighter — subtle separators
  },
  shadow: {
    card:      { color: '#000', opacity: 0.04, offset: { y: 1 }, radius: 6 },
    elevated:  { color: '#000', opacity: 0.08, offset: { y: 2 }, radius: 12 },
    accent:    { color: '#1a6b4a', opacity: 0.2, offset: { y: 2 }, radius: 8 },
  },
}
```

### 1.2 Color Palette — Dark Mode (Tech Glassmorphism)

```js
dark: {
  bg: {
    primary:   '#0e1117',               // deep dark — main background
    card:      'rgba(255,255,255,0.03)', // glass surface
    secondary: 'rgba(255,255,255,0.04)', // secondary glass surface
    elevated:  'rgba(255,255,255,0.06)', // elevated glass surface
  },
  accent: {
    primary:   '#34d399',               // mint — primary actions
    light:     'rgba(52,211,153,0.10)', // tinted mint — badges, highlights
    pressed:   '#2bb885',               // slightly darker mint
  },
  text: {
    primary:   '#f0f2f5',  // near-white — headings
    secondary: '#9aa3b4',  // light gray — body text
    muted:     '#5a6577',  // muted — captions
    inverse:   '#0e1117',  // dark — text on solid accent
  },
  border: {
    default:   'rgba(255,255,255,0.07)', // subtle glass border
    subtle:    'rgba(255,255,255,0.04)', // very subtle
  },
  glass: {
    blur:       10,                       // backdrop blur radius
    border:     'rgba(255,255,255,0.08)', // luminous glass border
    highlight:  'rgba(255,255,255,0.02)', // inner highlight
  },
  shadow: {
    card:      { color: '#000', opacity: 0.2, offset: { y: 2 }, radius: 8 },
    elevated:  { color: '#000', opacity: 0.3, offset: { y: 4 }, radius: 16 },
    accent:    { color: '#34d399', opacity: 0.15, offset: { y: 2 }, radius: 8 },
  },
}
```

### 1.3 Semantic Colors (shared across modes)

```js
semantic: {
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
    excellent: { light: '#1a6b4a', dark: '#34d399' }, // eagle/birdie (3+ pts)
    good:      { light: '#3d8b63', dark: '#6ee7b7' }, // par (2 pts)
    neutral:   { light: '#8a8a7a', dark: '#5a6577' }, // bogey (1 pt)
    poor:      { light: '#ef4444', dark: '#f87171' }, // double+ (0 pts)
  },
}
```

### 1.4 Typography — Plus Jakarta Sans

```js
typography: {
  family: 'PlusJakartaSans',
  weights: {
    light:     '300',
    regular:   '400',
    medium:    '500',
    semibold:  '600',
    bold:      '700',
    extrabold: '800',
  },
  sizes: {
    display:   { size: 28, weight: '800', letterSpacing: -0.5, lineHeight: 34 },
    title:     { size: 22, weight: '700', letterSpacing: -0.3, lineHeight: 28 },
    heading:   { size: 16, weight: '700', letterSpacing: 0,    lineHeight: 22 },
    subhead:   { size: 14, weight: '600', letterSpacing: 0,    lineHeight: 20 },
    body:      { size: 14, weight: '500', letterSpacing: 0,    lineHeight: 20 },
    caption:   { size: 12, weight: '500', letterSpacing: 0,    lineHeight: 16 },
    overline:  { size: 10, weight: '600', letterSpacing: 1.5,  lineHeight: 14, textTransform: 'uppercase' },
    tiny:      { size: 10, weight: '500', letterSpacing: 0,    lineHeight: 14 },
  },
}
```

### 1.5 Spacing & Radius

```js
spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 }
radius:  { sm: 8, md: 10, lg: 14, xl: 16, pill: 20, full: 9999 }
```

## 2. Component Patterns

### 2.1 Cards

**Light:** White background, 1px `border.default` border, `shadow.card`, radius `xl` (16px), padding `lg` (16px).

**Dark:** Glass background (`bg.card`), 1px `glass.border`, radius `xl`, padding `lg`. No box-shadow on glass cards (the luminous border provides depth).

### 2.2 Buttons

**Primary:**
- Light: Solid `accent.primary` background, white text, `shadow.accent`, radius `lg` (14px).
- Dark: Glass `accent.light` background, `accent.primary` border, `accent.primary` text, radius `lg`.
- Press: Scale to 0.97 + opacity 0.85 (60ms spring via Reanimated).

**Secondary:**
- Light: `bg.primary` background, `border.default` border, `accent.primary` text.
- Dark: `bg.secondary` background, `border.default` border, `text.secondary` text.

**Destructive:**
- Light: Transparent background, `destructive` text + border.
- Dark: `rgba(248,113,113,0.1)` background, `destructive` text + border.

**Icon button:**
- 36x36px, radius `md` (10px).
- Light: White background, border, subtle shadow.
- Dark: Glass background, glass border.

### 2.3 Inputs

- Light: White background, `border.default`, radius `md` (10px). Focus: `accent.primary` border.
- Dark: `bg.secondary`, `border.default`, radius `md`. Focus: `accent.primary` border.
- Placeholder: `text.muted`.
- Score inputs (scorecard): 48x48px, centered text, `heading` typography.

### 2.4 Badges / Pills

- Radius `pill` (20px), padding 3px 10px.
- Status "En juego": `accent.light` background, `accent.primary` text.
- Rank: Gold/Silver/Bronze backgrounds with tinted versions.

### 2.5 Tab Bar

- Active tab: `accent.primary` background, `text.inverse` text.
- Inactive tab: `bg.secondary` background, `text.muted` text.
- Radius `md` (10px), padding 8px 16px.

### 2.6 Icons

Replace all Unicode characters with Feather icons from `@expo/vector-icons`:
- Close (✕) → `x`
- Back (‹) → `chevron-left`
- Forward (›) → `chevron-right`
- Add → `plus`
- Delete → `trash-2`
- Edit → `edit-2`
- Players → `users`
- Courses → `grid` or `map`
- Settings → `settings`
- Score → `target`

### 2.7 Empty States

When no items exist (tournaments, players, courses):
- Large Feather icon (48px, `text.muted`)
- Heading text (e.g., "Sin torneos aún")
- Subtitle text (e.g., "Crea tu primer torneo para empezar")
- CTA button (primary style)
- Centered vertically with padding.

## 3. Animations

All animations use `react-native-reanimated` with `useNativeDriver`.

### 3.1 Button Press

```
onPressIn:  withTiming({ scale: 0.97, opacity: 0.85 }, { duration: 60 })
onPressOut: withSpring({ scale: 1, opacity: 1 }, { damping: 15 })
```

### 3.2 Screen Transitions

Custom stack navigator transition:
```
entering: FadeIn.duration(250)
exiting:  FadeOut.duration(150)
```
Combined with a slight horizontal slide (translateX 20px → 0).

### 3.3 Staggered List Entry

Cards/rows appear with staggered delay:
```
each item: FadeInDown.delay(index * 50).duration(300).springify()
```

### 3.4 Pair Reveal (Enhanced)

Keep existing 3-2-1 countdown but enhance:
- Numbers: scale(0) → scale(1.2) → scale(1) with blur(20) → blur(0)
- Pairs: SlideInRight with spring (damping: 12, stiffness: 100)
- Action buttons: FadeInUp.delay(400)

### 3.5 Theme Toggle

- Cross-fade between modes (200ms)
- Persist selection in AsyncStorage key `@golf_theme_mode`

## 4. UX Improvements

1. **Empty states** on all list screens (Home, PlayersLibrary, CoursesLibrary)
2. **Theme toggle** in Home header (sun/moon icon button)
3. **Better visual feedback** on all interactive elements (scale + opacity)
4. **Input focus states** with animated border color transition
5. **Pull-to-refresh indicator** styled with accent color on library screens
6. **Staggered card entrance** on Home and library screens

## 5. Architecture

### 5.1 New Files

```
src/theme/
  tokens.js          — Light & dark token definitions (colors, typography, spacing, radius)
  ThemeContext.js     — createContext + ThemeProvider + useTheme hook
```

### 5.2 ThemeProvider Pattern

```js
// ThemeContext.js
const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('light'); // default light

  useEffect(() => {
    // Load saved preference from AsyncStorage
    AsyncStorage.getItem('@golf_theme_mode').then(saved => {
      if (saved) setMode(saved);
    });
  }, []);

  const toggle = () => {
    const next = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    AsyncStorage.setItem('@golf_theme_mode', next);
  };

  const theme = mode === 'light' ? lightTokens : darkTokens;

  return (
    <ThemeContext.Provider value={{ theme, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

### 5.3 Screen Refactoring Pattern

Each screen replaces hardcoded colors with theme tokens:

```js
// Before
const styles = StyleSheet.create({
  container: { backgroundColor: '#070d15' },
  title: { color: '#f1f5f9' },
});

// After
function HomeScreen() {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  // ...
}

const makeStyles = (t) => StyleSheet.create({
  container: { backgroundColor: t.bg.primary },
  title: { color: t.text.primary, ...t.typography.display },
});
```

### 5.4 Dependencies

```
New:
  @expo-google-fonts/plus-jakarta-sans   — Typography
  react-native-reanimated                — Animations

Already present:
  @expo/vector-icons                     — Ships with Expo (Feather icon set)

Note on glassmorphism:
  The glass effect is achieved via semi-transparent rgba backgrounds + luminous
  borders. No actual backdrop-filter/blur needed — this approach works consistently
  across iOS, Android, and Web without extra dependencies.
```

## 6. Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add new dependencies |
| `App.js` | Wrap in ThemeProvider, load fonts, custom navigator transitions |
| `src/theme/tokens.js` | **NEW** — Full token definitions |
| `src/theme/ThemeContext.js` | **NEW** — Theme context + provider + hook |
| `src/screens/HomeScreen.js` | Apply tokens, icons, empty state, theme toggle, staggered cards, card redesign |
| `src/screens/SetupScreen.js` | Apply tokens, icons, button animations, input focus states |
| `src/screens/ScorecardScreen.js` | Apply tokens, icons, score input redesign, tab redesign |
| `src/screens/NextRoundScreen.js` | Apply tokens, enhanced reveal animations |
| `src/screens/CourseEditorScreen.js` | Apply tokens, icons, input styling |
| `src/screens/EditTournamentScreen.js` | Apply tokens, icons, section styling |
| `src/screens/PlayersLibraryScreen.js` | Apply tokens, icons, empty state, staggered list |
| `src/screens/CoursesLibraryScreen.js` | Apply tokens, icons, empty state, staggered list |
| `src/screens/CourseLibraryDetailScreen.js` | Apply tokens, icons, input styling |
| `src/screens/PlayerPickerScreen.js` | Apply tokens, icons, selection styling |
| `src/screens/CoursePickerScreen.js` | Apply tokens, icons, selection styling |

## 7. Verification

1. **Visual**: Launch with `npx expo start --web`, verify Home screen in light mode matches mockup
2. **Theme toggle**: Toggle between light/dark, verify all screens render correctly in both modes
3. **Persistence**: Toggle to dark, reload app, verify dark mode persists
4. **Animations**: Verify button press feedback, staggered list entry, screen transitions
5. **Icons**: Verify no Unicode characters remain (search for ✕, ›, ‹, &, ·)
6. **Typography**: Verify Plus Jakarta Sans loads and renders on all screens
7. **Scoring**: Create a tournament, enter scores, verify all scoring logic still works
8. **Libraries**: CRUD players and courses, verify Supabase operations unaffected
