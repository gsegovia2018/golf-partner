# Scoring Mode Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline scoring-mode card list with a compact field that opens a scalable, categorized bottom-sheet selector, and make the automatic mode fallback visible.

**Architecture:** Pure mode data and logic move into a new dependency-free `src/components/scoringModes.js` module so they are unit-testable in isolation. `ScoringModePicker.js` becomes the UI layer: it re-exports the pure helpers (so existing call sites are untouched) and renders `ScoringModeField` (a compact row, the new default export) plus an internal `ScoringModeSheet` bottom-sheet modal.

**Tech Stack:** React Native 0.81, Expo 54, jest + jest-expo. No React Native Testing Library is installed, so pure logic is TDD'd and UI is verified with a structured manual checklist (matches the spec's Testing section).

**Spec:** `docs/superpowers/specs/2026-05-17-scoring-mode-selector-design.md`

---

## File Structure

- **Create `src/components/scoringModes.js`** — pure data + logic: `SCORING_MODES` (now with a `category` field), `isScoringModeAllowed`, `fallbackScoringMode`, `scoringModeCategories`, `fallbackNoticeText`, `getScoringMode`. No React / React Native imports.
- **Create `src/components/__tests__/scoringModes.test.js`** — unit tests for the pure module.
- **Modify `src/components/ScoringModePicker.js`** — drop the inline data/list; import from `scoringModes.js`, re-export the three legacy helpers, and implement `ScoringModeField` (default export) + `ScoringModeSheet`.
- **No changes** to `src/screens/SetupScreen.js` or `src/screens/EditTournamentScreen.js`: both `import ScoringModePicker, { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker'`. The default import binding still resolves (now to `ScoringModeField`) and the named re-exports are preserved. Task 3 verifies this.

---

## Task 1: Pure scoring-mode data and logic module

**Files:**
- Create: `src/components/scoringModes.js`
- Test: `src/components/__tests__/scoringModes.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/scoringModes.test.js`:

```js
import {
  SCORING_MODES,
  isScoringModeAllowed,
  fallbackScoringMode,
  scoringModeCategories,
  fallbackNoticeText,
  getScoringMode,
} from '../scoringModes';

describe('SCORING_MODES', () => {
  test('every mode declares a non-empty category', () => {
    for (const mode of SCORING_MODES) {
      expect(typeof mode.category).toBe('string');
      expect(mode.category.length).toBeGreaterThan(0);
    }
  });
});

describe('isScoringModeAllowed', () => {
  test('matchplay needs exactly 2 players', () => {
    expect(isScoringModeAllowed('matchplay', 2)).toBe(true);
    expect(isScoringModeAllowed('matchplay', 3)).toBe(false);
  });
  test('unknown mode is never allowed', () => {
    expect(isScoringModeAllowed('nope', 4)).toBe(false);
  });
});

describe('fallbackScoringMode', () => {
  test('prefers stableford when the roster allows it', () => {
    expect(fallbackScoringMode(3)).toBe('stableford');
  });
  test('falls back to individual when stableford is not allowed', () => {
    expect(fallbackScoringMode(1)).toBe('individual');
  });
});

describe('scoringModeCategories', () => {
  test('groups modes into ordered sections', () => {
    const sections = scoringModeCategories();
    expect(sections.map((s) => s.category)).toEqual(['Solo', 'Head-to-head', 'Teams']);
    expect(sections[0].modes.map((m) => m.key)).toEqual(['individual', 'stableford']);
    expect(sections[1].modes.map((m) => m.key)).toEqual(['matchplay']);
    expect(sections[2].modes.map((m) => m.key)).toEqual(['bestball']);
  });
  test('every mode appears exactly once across sections', () => {
    const keys = scoringModeCategories().flatMap((s) => s.modes.map((m) => m.key));
    expect(keys.sort()).toEqual(SCORING_MODES.map((m) => m.key).sort());
  });
});

describe('fallbackNoticeText', () => {
  test('explains why the mode changed', () => {
    expect(fallbackNoticeText('matchplay', 'stableford'))
      .toBe('Match Play needs exactly 2 players — switched to Stableford with Partners.');
  });
  test('returns null when either key is unknown', () => {
    expect(fallbackNoticeText('matchplay', 'nope')).toBeNull();
    expect(fallbackNoticeText('nope', 'stableford')).toBeNull();
  });
});

describe('getScoringMode', () => {
  test('returns the matching mode', () => {
    expect(getScoringMode('matchplay').label).toBe('Match Play');
  });
  test('falls back to the first mode for an unknown key', () => {
    expect(getScoringMode('nope')).toBe(SCORING_MODES[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest scoringModes -v`
Expected: FAIL — `Cannot find module '../scoringModes'`.

- [ ] **Step 3: Create the module**

Create `src/components/scoringModes.js`:

```js
// Pure data and logic for the scoring modes. Deliberately free of React /
// React Native imports so it stays unit-testable in isolation.
// ScoringModePicker.js re-exports SCORING_MODES / isScoringModeAllowed /
// fallbackScoringMode so existing call sites keep their import path.
//
// Order is fixed: solo modes first, then head-to-head, then team modes.

export const SCORING_MODES = [
  {
    key: 'individual',
    label: 'Stableford',
    subtitle: 'Highest points wins',
    icon: 'user',
    category: 'Solo',
    // Solo ranking — needs at least 2 players to be a contest.
    isAllowed: (count) => count >= 2,
    requirement: 'Requires 2+ players',
  },
  {
    key: 'stableford',
    label: 'Stableford with Partners',
    subtitle: 'Random partners each round',
    icon: 'users',
    category: 'Solo',
    isAllowed: (count) => count >= 2,
    requirement: 'Requires 2+ players',
  },
  {
    key: 'matchplay',
    label: 'Match Play',
    subtitle: 'Head-to-head, hole by hole',
    icon: 'flag',
    category: 'Head-to-head',
    // Match play is strictly 1-vs-1.
    isAllowed: (count) => count === 2,
    requirement: 'Requires exactly 2 players',
  },
  {
    key: 'bestball',
    label: 'Best Ball / Worst Ball',
    subtitle: 'Two pairs, best & worst score',
    icon: 'award',
    category: 'Teams',
    // Two pairs of two.
    isAllowed: (count) => count === 4,
    requirement: 'Requires exactly 4 players',
  },
];

// Returns true when `mode` is valid for the given player count.
export function isScoringModeAllowed(mode, playerCount) {
  const def = SCORING_MODES.find((m) => m.key === mode);
  return def ? def.isAllowed(playerCount) : false;
}

// Picks a safe fallback mode when the current one becomes invalid.
export function fallbackScoringMode(playerCount) {
  return isScoringModeAllowed('stableford', playerCount) ? 'stableford' : 'individual';
}

// Returns the mode definition for `key`, or the first mode as a defensive
// default so the UI can always render something.
export function getScoringMode(key) {
  return SCORING_MODES.find((m) => m.key === key) ?? SCORING_MODES[0];
}

// Groups SCORING_MODES into ordered { category, modes } sections, preserving
// declaration order for both the categories and the modes within them.
export function scoringModeCategories() {
  const sections = [];
  for (const mode of SCORING_MODES) {
    let section = sections.find((s) => s.category === mode.category);
    if (!section) {
      section = { category: mode.category, modes: [] };
      sections.push(section);
    }
    section.modes.push(mode);
  }
  return sections;
}

// Builds the note shown when the player count forced a mode change.
// Returns null when either key is unknown.
export function fallbackNoticeText(prevKey, nextKey) {
  const prev = SCORING_MODES.find((m) => m.key === prevKey);
  const next = SCORING_MODES.find((m) => m.key === nextKey);
  if (!prev || !next) return null;
  const reason = prev.requirement.replace(/^Requires/, 'needs');
  return `${prev.label} ${reason} — switched to ${next.label}.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest scoringModes -v`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/components/scoringModes.js src/components/__tests__/scoringModes.test.js
git commit -m "feat: extract pure scoring-mode data into testable module"
```

---

## Task 2: ScoringModeField + ScoringModeSheet UI

**Files:**
- Modify: `src/components/ScoringModePicker.js` (full rewrite of the file)

There is no React Native Testing Library in this project, so this task has no unit test. It uses a manual verification step instead. Do not skip the manual checklist.

- [ ] **Step 1: Rewrite `src/components/ScoringModePicker.js`**

Replace the entire file contents with:

```js
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  SCORING_MODES,
  isScoringModeAllowed,
  fallbackScoringMode,
  scoringModeCategories,
  fallbackNoticeText,
  getScoringMode,
} from './scoringModes';

// Re-export the pure helpers so existing call sites
// (`import { isScoringModeAllowed } from '../components/ScoringModePicker'`)
// keep working now that the data/logic lives in scoringModes.js.
export { SCORING_MODES, isScoringModeAllowed, fallbackScoringMode };

// Cap the sheet list at ~70% of the screen so it always scrolls rather
// than pushing the sheet past the top of the screen.
const SHEET_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.7);

// --- Bottom-sheet mode list ----------------------------------------------

function ScoringModeSheet({ visible, value, playerCount, onSelect, onClose }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const sections = scoringModeCategories();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Choose scoring mode</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
              <Feather name="x" size={22} color={theme.text.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={s.sheetScroll} showsVerticalScrollIndicator={false}>
            {sections.map((section) => (
              <View key={section.category}>
                <Text style={s.sectionHeader}>{section.category.toUpperCase()}</Text>
                {section.modes.map((mode) => {
                  const allowed = mode.isAllowed(playerCount);
                  const active = value === mode.key;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      style={[s.row, !allowed && s.rowDisabled]}
                      activeOpacity={allowed ? 0.7 : 1}
                      onPress={() => { if (allowed) onSelect(mode.key); }}
                      accessibilityState={{ disabled: !allowed, selected: active }}
                    >
                      <Feather
                        name={mode.icon}
                        size={20}
                        color={allowed ? theme.accent.primary : theme.text.muted}
                      />
                      <View style={s.rowText}>
                        <Text style={[s.rowLabel, !allowed && s.rowLabelDisabled]}>
                          {mode.label}
                        </Text>
                        {allowed ? (
                          <Text style={s.rowSubtitle}>{mode.subtitle}</Text>
                        ) : (
                          <View style={s.reqPill}>
                            <Text style={s.reqPillText}>{mode.requirement}</Text>
                          </View>
                        )}
                      </View>
                      {active && (
                        <Feather name="check" size={20} color={theme.accent.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// --- Compact field shown on the setup screens ----------------------------

export default function ScoringModeField({ value, onChange, playerCount, settings, onSettingsChange }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  // prevValueRef tracks the last value we rendered. userPickedRef is set when
  // the change came from a sheet tap — so we can tell an intentional pick
  // apart from the parent's auto-fallback and only surface the latter.
  const prevValueRef = useRef(value);
  const userPickedRef = useRef(false);

  useEffect(() => {
    if (value === prevValueRef.current) return;
    if (userPickedRef.current) {
      userPickedRef.current = false;
    } else {
      setNotice(fallbackNoticeText(prevValueRef.current, value));
    }
    prevValueRef.current = value;
  }, [value]);

  const current = getScoringMode(value);

  function handleSelect(key) {
    userPickedRef.current = true;
    setNotice(null);
    setSheetOpen(false);
    onChange(key);
  }

  function openSheet() {
    setNotice(null);
    setSheetOpen(true);
  }

  return (
    <View>
      <TouchableOpacity style={s.field} onPress={openSheet} activeOpacity={0.7}>
        <Feather name={current.icon} size={20} color={theme.accent.primary} />
        <View style={s.fieldText}>
          <Text style={s.fieldLabel}>{current.label}</Text>
          <Text style={s.fieldSubtitle}>{current.subtitle}</Text>
        </View>
        <Feather name="chevron-down" size={20} color={theme.text.muted} />
      </TouchableOpacity>

      {notice && (
        <View style={s.notice}>
          <Feather name="info" size={14} color={theme.accent.primary} />
          <Text style={s.noticeText}>{notice}</Text>
          <TouchableOpacity onPress={() => setNotice(null)} accessibilityLabel="Dismiss">
            <Feather name="x" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        </View>
      )}

      {value === 'bestball' && settings && onSettingsChange && (
        <View style={s.valueRow}>
          <View style={s.valueBlock}>
            <Text style={s.valueLabel}>Best Ball</Text>
            <TextInput
              style={s.valueInput}
              keyboardType="numeric"
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              maxLength={2}
              value={String(settings.bestBallValue)}
              onChangeText={(v) => onSettingsChange({ ...settings, bestBallValue: v })}
            />
            <Text style={s.valueSuffix}>pts / hole</Text>
          </View>
          <View style={s.valueBlock}>
            <Text style={s.valueLabel}>Worst Ball</Text>
            <TextInput
              style={s.valueInput}
              keyboardType="numeric"
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              maxLength={2}
              value={String(settings.worstBallValue)}
              onChangeText={(v) => onSettingsChange({ ...settings, worstBallValue: v })}
            />
            <Text style={s.valueSuffix}>pts / hole</Text>
          </View>
        </View>
      )}

      <ScoringModeSheet
        visible={sheetOpen}
        value={value}
        playerCount={playerCount}
        onSelect={handleSelect}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  /* Compact field */
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  fieldText: { flex: 1 },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15,
  },
  fieldSubtitle: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 2,
  },

  /* Fallback notice */
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.accent.light,
    borderRadius: 10, borderWidth: 1, borderColor: theme.accent.primary + '40',
    padding: 10, marginTop: 8,
  },
  noticeText: {
    flex: 1, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12,
  },

  /* Bottom sheet */
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.bg.primary, padding: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
  sheetScroll: { maxHeight: SHEET_MAX_HEIGHT },
  sectionHeader: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11,
    letterSpacing: 1.8, textTransform: 'uppercase', marginTop: 16, marginBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
  },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1 },
  rowLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15,
  },
  rowLabelDisabled: { color: theme.text.muted },
  rowSubtitle: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, marginTop: 2,
  },
  reqPill: {
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: theme.bg.secondary,
    borderRadius: 6, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 2, paddingHorizontal: 8,
  },
  reqPillText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
  },

  /* Best/Worst ball value inputs (unchanged from the previous picker) */
  valueRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  valueBlock: {
    flex: 1, backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, alignItems: 'center', gap: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  valueLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 12, letterSpacing: 0.5,
  },
  valueInput: {
    backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.secondary,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default,
    width: 56, textAlign: 'center', fontSize: 22,
    fontFamily: 'PlusJakartaSans-ExtraBold', padding: 8,
  },
  valueSuffix: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 11 },
});
```

- [ ] **Step 2: Run lint and the test suite**

Run: `npx eslint src/components/ScoringModePicker.js src/components/scoringModes.js`
Expected: no errors.

Run: `npx jest`
Expected: PASS — the full suite, including `scoringModes.test.js`, stays green. (No existing test imports `ScoringModePicker.js`, so the re-export change cannot regress them.)

- [ ] **Step 3: Manual verification**

Start the app (`npx expo start`) and on the **New Game / New Tournament** screen with 2+ players added, confirm:
- The Scoring section shows a single compact row with the current mode's icon, label and subtitle, and a down-chevron.
- Tapping the row opens a bottom sheet titled "Choose scoring mode" with `SOLO` / `HEAD-TO-HEAD` / `TEAMS` section headers.
- With 2 players: `Best Ball / Worst Ball` shows a dimmed "Requires exactly 4 players" pill and does not respond to taps.
- With 3 players: `Match Play` shows a dimmed "Requires exactly 2 players" pill.
- Selecting an allowed mode closes the sheet and updates the field row.
- Selecting `Best Ball / Worst Ball` (with 4 players) shows the Best Ball / Worst Ball point inputs inline below the field.
- The currently-selected mode shows a check mark in the sheet.
- Tapping the backdrop or the X closes the sheet without changing the mode.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScoringModePicker.js
git commit -m "feat: scoring mode bottom-sheet selector replaces inline list"
```

---

## Task 3: Verify the visible fallback and screen integration

**Files:**
- No code changes. `SetupScreen.js` and `EditTournamentScreen.js` consume the default export and the re-exported helpers unchanged; this task confirms that and the fallback note.

- [ ] **Step 1: Confirm the call sites still resolve**

Run: `grep -n "ScoringModePicker" src/screens/SetupScreen.js src/screens/EditTournamentScreen.js`
Expected: each file imports `ScoringModePicker` as the default plus `{ isScoringModeAllowed, fallbackScoringMode }`. No edit needed — the default export is now `ScoringModeField` and the named helpers are re-exported.

- [ ] **Step 2: Manual verification — visible fallback on SetupScreen**

Start the app, open **New Tournament**, add exactly 2 players, open the scoring sheet and pick **Match Play**. Then add a 3rd player. Confirm:
- The field row updates to `Stableford with Partners` (the fallback).
- A note appears below the row: "Match Play needs exactly 2 players — switched to Stableford with Partners." with an info icon and a dismiss (X) control.
- Tapping the dismiss X removes the note.
- Opening the sheet again also clears the note.
- Removing players back to 2 and picking Match Play again, then opening the sheet via tap, shows **no** note (an intentional pick is not flagged).

- [ ] **Step 3: Manual verification — EditTournamentScreen**

Open an existing tournament's **Edit** screen. Confirm the scoring field renders the tournament's current mode, the sheet opens, selecting a mode persists after the debounced save (the save status pill shows "saved"), and reopening the screen shows the chosen mode.

- [ ] **Step 4: Final full check**

Run: `npx jest`
Expected: PASS — full suite green.

Run: `npx eslint src/`
Expected: no new errors introduced by this change.

- [ ] **Step 5: Commit**

No code changed in this task. If Steps 1–4 all pass, there is nothing to commit — record completion in the executing-plans tracking instead. If a defect was found and fixed, commit it:

```bash
git add -A
git commit -m "fix: scoring mode selector integration issues found in verification"
```

---

## Self-Review Notes

- **Spec coverage:** Compact field (Task 2) ✓; bottom sheet with scrollable categorized list (Task 2) ✓; disabled modes shown with requirement pill, non-tappable (Task 2) ✓; `category` field added to `SCORING_MODES` (Task 1) ✓; visible fallback note (Tasks 2–3) ✓; Best Ball inputs stay inline (Task 2) ✓; helpers unchanged in contract / re-exported (Tasks 1–3) ✓; search deferred — not built, spec Non-Goal ✓.
- **Type consistency:** `scoringModeCategories()` returns `{ category, modes }[]`; `fallbackNoticeText(prevKey, nextKey)` returns `string | null`; `getScoringMode(key)` returns a mode object. `ScoringModeSheet` props (`visible`, `value`, `playerCount`, `onSelect`, `onClose`) and `ScoringModeField` props (`value`, `onChange`, `playerCount`, `settings`, `onSettingsChange`) are used consistently between definition and call site.
- **No placeholders:** every code step contains complete, runnable code.
