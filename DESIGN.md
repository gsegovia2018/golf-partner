---
name: Golf Partner
description: Casual clubhouse scoring for friends playing weekend golf rounds.
colors:
  clubhouse-green: "#006747"
  clubhouse-green-pressed: "#005538"
  fairway-mint: "#e6f0eb"
  canvas-warm: "#f6f3ee"
  card-white: "#ffffff"
  bunker-wash: "#ece8e1"
  ink: "#1a1a1a"
  slate: "#6b7280"
  olive-muted: "#8a8a7a"
  night-green: "#0c1a14"
  night-accent: "#4fae8a"
  gold-marker: "#ffd700"
  rank-silver: "#94a3b8"
  bronze-marker: "#c47c3a"
  score-good: "#2a7d56"
  error: "#ef4444"
  error-dark: "#f87171"
typography:
  display:
    fontFamily: "PlayfairDisplay-Black, Playfair Display, Georgia, serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: "38px"
    letterSpacing: "-0.5px"
  title:
    fontFamily: "PlusJakartaSans-Bold, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "30px"
    letterSpacing: "-0.3px"
  heading:
    fontFamily: "PlusJakartaSans-Bold, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "22px"
    letterSpacing: "0"
  body:
    fontFamily: "PlusJakartaSans-Medium, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "0"
  label:
    fontFamily: "PlusJakartaSans-SemiBold, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0"
  overline:
    fontFamily: "PlusJakartaSans-SemiBold, Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "1.5px"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  pill: "20px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  xxxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.clubhouse-green}"
    textColor: "{colors.card-white}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  button-secondary:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.slate}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "13px"
  chip-selected:
    backgroundColor: "{colors.clubhouse-green}"
    textColor: "{colors.card-white}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "6px 10px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Golf Partner

## 1. Overview

**Creative North Star: "The Clubhouse Score Ledger"**

Golf Partner should feel like a familiar clubhouse table after a round: scores are present, names matter, and the interface supports friendly rivalry without turning the group into tournament operators. The system is a restrained product UI with one clear green accent, warm neutral surfaces, concise cards, and direct mobile controls.

The app already carries two visual voices. Plus Jakarta Sans does the operational work for labels, buttons, scores, and lists. Playfair Display is reserved for brand moments, modal titles, and scorecard landmarks where the app can feel more social and memorable. Keep that split. Do not let the serif become routine UI chrome.

**Key Characteristics:**
- People and recency lead before raw scoring tables.
- Green marks action, selection, current state, and official golf identity.
- Cards are compact containers, not decorative page sections.
- Mobile outdoor use wins over visual flourish: high contrast, clear tap targets, and stable layouts.
- Social surfaces may feel warm; scoring surfaces must stay fast and unambiguous.

## 2. Colors

The palette is a restrained clubhouse green system over warm neutral surfaces, with gold and bronze reserved for scoring, ranking, and brand ceremony.

### Primary

- **Clubhouse Green**: The primary action, selected state, live indicator, pair A, excellent score, and brand field color. Use it sparingly so selected controls and game actions are instantly visible.
- **Pressed Clubhouse Green**: The active or pressed version of primary controls. Use for touch feedback, not as a second brand color.
- **Fairway Mint**: The pale green support color for notices, selected backgrounds, and dark-mode primary buttons where full green would feel too heavy.

### Secondary

- **Bronze Marker**: The pair B and bronze-rank color. It creates friendly contrast with green without making the app read as a full orange palette.
- **Gold Marker**: The ceremonial marker used for the splash, rank gold, and special scorecard highlights. Never use it for routine controls.

### Neutral

- **Warm Canvas**: The light app background. It creates a softer golf-club feel than plain white while leaving cards readable.
- **Card White**: Primary card, sheet, input, and list-row surface in light mode.
- **Bunker Wash**: Secondary surface, low-contrast border, and inactive control fill.
- **Ink**: Primary text in light mode.
- **Slate**: Secondary metadata text.
- **Olive Muted**: Muted text and neutral score state. Use carefully; it is lower contrast than Slate.
- **Night Green**: Dark-mode background.
- **Night Accent**: Dark-mode green for actions, selected states, and positive scores.

### Named Rules

**The Green Means Action Rule.** Green is for primary actions, selected filters, live state, pair A, and excellent scoring. If everything is green, nothing is actionable.

**The Gold Is Ceremony Rule.** Gold belongs to splash, rank, and special score moments. It is prohibited for normal buttons, tabs, or helper text.

**The Neutral Must Read Rule.** Muted text must stay legible outdoors. If a label competes with sunlight or a tinted background, move it from Olive Muted to Slate or Ink.

## 3. Typography

**Display Font:** Playfair Display, using the loaded `PlayfairDisplay-*` family names with Georgia fallback.
**Body Font:** Plus Jakarta Sans, using the loaded `PlusJakartaSans-*` family names with system-ui fallback.
**Label/Mono Font:** Plus Jakarta Sans. There is no mono layer in the current app.

**Character:** The pairing is social but task-oriented. Plus Jakarta Sans carries the product workload; Playfair Display appears only where a screen benefits from clubhouse warmth or a scorecard headline.

### Hierarchy

- **Display** (900, 30px, 38px): Brand wordmarks, major scorecard numerals, and high-emphasis social titles. Use sparingly.
- **Title** (700, 24px, 30px): Screen section heroes, modal titles, sheet titles, and major summaries.
- **Heading** (700, 16px, 22px): Card titles, list row names, and compact section headings.
- **Body** (500, 14px, 20px): Operational copy, metadata, descriptions, and form helper text. Keep longer explanatory copy under 75 characters per line when possible.
- **Label** (600, 12px, 16px): Chips, counters, field labels, badges, and compact controls.
- **Overline** (600, 10px, 14px, 1.5px letter spacing, uppercase): Rare section labels only. It is not a default heading style.

### Named Rules

**The Sans Does The Work Rule.** Buttons, tabs, scoring cells, inputs, tables, and state labels always use Plus Jakarta Sans.

**The Serif Earns The Moment Rule.** Playfair Display is allowed for brand, modal, and scorecard moments. It is forbidden inside dense controls, small labels, and data rows.

## 4. Elevation

Golf Partner uses a hybrid depth model: light mode uses subtle card and accent shadows; dark mode relies mostly on tonal layering and translucent borders. Surfaces should feel touchable, but not like floating marketing cards.

### Shadow Vocabulary

- **Card Shadow** (`shadowOpacity: 0.04`, offset 0x1, radius 6, elevation 2): Light-mode cards and list rows that need separation from Warm Canvas.
- **Elevated Shadow** (`shadowOpacity: 0.08`, offset 0x2, radius 12, elevation 4): Modal-like panels, prominent overlays, or stronger surface separation.
- **Accent Shadow** (`shadowColor: Clubhouse Green`, `shadowOpacity: 0.2`, offset 0x2, radius 8, elevation 3): Primary action buttons in light mode.
- **Floating Tab Shadow** (`shadowOpacity: 0.16`, offset 0x8, radius 18, elevation 14): Reserved for the persistent bottom tab bar.
- **Dark Surface Layering**: Dark mode prefers translucent green cards, white-alpha elevated surfaces, and green-tinted borders over heavy shadows.

### Named Rules

**The Touch Only Rule.** Elevation exists to separate controls, sheets, tabs, and tappable cards. It is not background decoration.

**The Dark Mode Layer Rule.** In dark mode, use tonal layers and borders first. Heavy black shadows on already-dark surfaces are prohibited.

## 5. Components

### Buttons

- **Shape:** Gently rounded rectangles for action buttons (14px). Icon-only square actions usually use 12px radius or a circular hit target.
- **Primary:** Clubhouse Green in light mode with white text, ExtraBold Plus Jakarta Sans, and 14 to 16px vertical padding. In dark mode, prefer Fairway Mint style fills with Night Accent text and a faint green border.
- **Secondary / Ghost:** White or transparent surfaces with Bunker Wash borders and Slate text. Use for Back, Cancel, Share later, and non-destructive alternates.
- **Disabled / Loading:** Reduce opacity around 0.5 to 0.6 and keep layout dimensions stable. Use inline activity indicators inside the button, not separate spinners.

### Chips

- **Style:** Compact pill controls with 9999px radius, 6px vertical padding, and SemiBold 12px labels.
- **State:** Selected chips fill with Clubhouse Green and invert text. Unselected chips sit on Bunker Wash or dark secondary surfaces. Icons inherit the same active/inactive text colors.
- **Usage:** Chips are filters, round selectors, mode toggles, and score-detail selectors. They should not become decorative badges.

### Cards / Containers

- **Corner Style:** Most cards use 14 to 16px radii. Bottom sheets can use 22 to 24px top corners. Avoid larger radii unless the element is a pill or a ball.
- **Background:** Card White on light mode; translucent green or white-alpha surfaces on dark mode.
- **Shadow Strategy:** Apply Card Shadow only in light mode when separation is needed. Dark cards use borders and tonal contrast.
- **Border:** Hairline or 1px borders use Bunker Wash in light mode and green/white alpha borders in dark mode.
- **Internal Padding:** 16px is the standard card padding. Dense controls may use 12px; modal sheets use 20 to 22px.

### Inputs / Fields

- **Style:** 10 to 12px rounded fields with Card White or Warm Canvas fill, 1px Bunker Wash border, 13 to 14px padding, and Medium Plus Jakarta Sans.
- **Focus:** Native selection and cursor use Clubhouse Green. Web inputs should remove default outlines only when a clear themed focus treatment exists.
- **Error / Disabled:** Error borders and text use the semantic red tokens. Disabled controls reduce opacity but retain shape and spacing.

### Navigation

- **Bottom Tabs:** The persistent nav is a centered floating pill bar, 62px high, with three task tabs: Feed, Play, History. The active tab expands into a green pill with label text; inactive tabs are icon-only with muted color.
- **Headers:** Screen headers use 17px Bold Plus Jakarta Sans, simple icon buttons, and a primary-background surface. Avoid large marketing-style headers inside task screens.
- **Sheets:** Bottom sheets slide from the bottom with a dark backdrop, rounded top corners, and a small drag handle. They should be used for focused choices or sharing flows, not as the first answer for every edit.

### Score And Stat Surfaces

- **Stat Tiles:** Title-sized numeric values over compact captions, usually inside a card or green hero card. Positive values use green, destructive trends use red, and neutral values use Ink or white depending on surface.
- **Score Signals:** Color can support score quality, but labels, icons, rank order, or text must carry the meaning too.
- **Round Cards:** Keep people, course, round status, and primary actions visible without requiring the user to parse full score tables first.

## 6. Do's and Don'ts

### Do:

- **Do** lead with people, recency, and active game state before dense scoring data.
- **Do** keep scoring controls compact, predictable, and readable on mobile outdoors.
- **Do** use Clubhouse Green for primary actions, selected state, and live state only.
- **Do** reserve Playfair Display for brand and scorecard moments; use Plus Jakarta Sans for everything operational.
- **Do** keep cards at 14 to 16px radius unless they are true pills, balls, or bottom sheets.
- **Do** pair color with text, icon, rank, or layout for score quality and error states.
- **Do** keep web and Android surfaces visually aligned from the same token vocabulary.

### Don't:

- **Don't** make the app feel like enterprise sports admin dashboards.
- **Don't** create sterile spreadsheet-like leaderboards that hide who played and what happened.
- **Don't** make a generic social feed that hides the golf context.
- **Don't** add decorative golf nostalgia that slows down scoring workflows.
- **Don't** use gold for everyday CTAs, tabs, search fields, or filters.
- **Don't** put Playfair Display inside buttons, chips, dense rows, or score inputs.
- **Don't** rely on color alone for rankings, selected filters, score quality, or errors.
- **Don't** use side-stripe card borders, gradient text, glassmorphism, or repeated identical marketing card grids.
