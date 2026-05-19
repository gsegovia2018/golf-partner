# Tees & Handicaps Step Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the New Game / Tournament wizard's "Tees & Handicaps" step as a modern, mobile-friendly compact list of collapsible per-player cards.

**Architecture:** A single component, `src/components/RoundTeeAssignments.js`, is rewritten internally. Its props and `onChange` contract are unchanged, so the host (`SetupScreen`) and all downstream scoring logic are untouched. Two pure helper functions are extracted and exported so they can be unit-tested in the project's existing pure-function style.

**Tech Stack:** React Native (Expo 54), `@expo/vector-icons` (Feather), Jest. No new dependencies.

---

## Spec

`docs/superpowers/specs/2026-05-19-tees-handicaps-step-redesign-design.md`

## File Structure

- **Modify:** `src/components/RoundTeeAssignments.js` — rewritten: adds two
  exported pure helpers, two new state values, a colored-dot tee summary,
  collapsible rows, and an inline expanded editor with a tappable stepper.
- **Create:** `src/components/__tests__/roundTeeAssignments.test.js` — unit
  tests for the two exported pure helpers.
- **Unchanged:** `src/screens/SetupScreen.js`, `src/screens/setupWizard.js`,
  `src/store/*` — the `onChange` patch shape is identical, so nothing else
  needs to change.

---

## Task 1: Pure helpers + tests

Add two exported pure functions to `RoundTeeAssignments.js` and test them.
Test-first. The functions are added at the top of the existing file; the full
component rewrite in Task 2 keeps these exact functions.

**Files:**
- Test: `src/components/__tests__/roundTeeAssignments.test.js` (create)
- Modify: `src/components/RoundTeeAssignments.js` (add two exports near top)

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/roundTeeAssignments.test.js`:

```js
import { playerInitials, clampPlayingHandicap } from '../RoundTeeAssignments';

describe('playerInitials', () => {
  test('two-word name uses first and last initials', () => {
    expect(playerInitials('Marco Specker')).toBe('MS');
  });
  test('three-word name uses first and last initials', () => {
    expect(playerInitials('Mary Anne Jones')).toBe('MJ');
  });
  test('single name uses its first two letters', () => {
    expect(playerInitials('Marco')).toBe('MA');
  });
  test('collapses extra whitespace', () => {
    expect(playerInitials('  Marco   Specker  ')).toBe('MS');
  });
  test('empty or missing name falls back to a placeholder', () => {
    expect(playerInitials('')).toBe('?');
    expect(playerInitials(undefined)).toBe('?');
  });
});

describe('clampPlayingHandicap', () => {
  test('keeps a value already in range', () => {
    expect(clampPlayingHandicap(18)).toBe(18);
  });
  test('clamps below the floor to -9', () => {
    expect(clampPlayingHandicap(-20)).toBe(-9);
  });
  test('clamps above the ceiling to 54', () => {
    expect(clampPlayingHandicap(99)).toBe(54);
  });
  test('rounds a non-integer input', () => {
    expect(clampPlayingHandicap(12.6)).toBe(13);
  });
  test('non-numeric input falls back to 0', () => {
    expect(clampPlayingHandicap('abc')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- roundTeeAssignments`
Expected: FAIL — `playerInitials`/`clampPlayingHandicap` are `undefined`
(not yet exported).

- [ ] **Step 3: Add the two helpers to the component**

In `src/components/RoundTeeAssignments.js`, immediately after the existing
`import` block (before the `RoundTeeAssignments` function), insert:

```js
// Common golf tee colours, keyed by lower-cased label.
const TEE_COLORS = {
  white: '#FFFFFF', yellow: '#F2C200', red: '#D7372E', blue: '#2F6FB5',
  black: '#23262B', gold: '#C9A227', green: '#2F7D5B', orange: '#E5862B',
  silver: '#B8BCC2', bronze: '#A9712E',
};

// Resolve a tee label to a swatch colour, or null when unknown.
function teeColor(label) {
  return TEE_COLORS[String(label || '').trim().toLowerCase()] || null;
}

// Up to two uppercase initials for a player's avatar badge.
export function playerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Clamp a playing handicap to a sane integer range.
export function clampPlayingHandicap(n) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return 0;
  return Math.max(-9, Math.min(54, v));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- roundTeeAssignments`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/RoundTeeAssignments.js src/components/__tests__/roundTeeAssignments.test.js
git commit -m "feat: add tee/handicap pure helpers with tests"
```

---

## Task 2: Rewrite the component as a compact collapsible list

Replace the entire body of `RoundTeeAssignments.js` with the compact-list
design. The two helpers and colour map from Task 1 are kept verbatim. The
existing state, both effects, and `recomputeAuto` / `setPlayerTee` /
`resetAllToAuto` are preserved unchanged; two new state values and two new
handicap functions are added.

**Files:**
- Modify: `src/components/RoundTeeAssignments.js` (full file replace)

- [ ] **Step 1: Replace the entire file contents**

Write `src/components/RoundTeeAssignments.js` with exactly this content:

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { calcPlayingHandicap, lastTeeForPlayerOnCourse } from '../store/tournamentStore';
import { middleTee } from '../store/tees';

// Common golf tee colours, keyed by lower-cased label.
const TEE_COLORS = {
  white: '#FFFFFF', yellow: '#F2C200', red: '#D7372E', blue: '#2F6FB5',
  black: '#23262B', gold: '#C9A227', green: '#2F7D5B', orange: '#E5862B',
  silver: '#B8BCC2', bronze: '#A9712E',
};

// Resolve a tee label to a swatch colour, or null when unknown.
function teeColor(label) {
  return TEE_COLORS[String(label || '').trim().toLowerCase()] || null;
}

// Up to two uppercase initials for a player's avatar badge.
export function playerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Clamp a playing handicap to a sane integer range.
export function clampPlayingHandicap(n) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return 0;
  return Math.max(-9, Math.min(54, v));
}

// Per-round, per-player tee picker + playing-handicap editor.
//
// Props:
//   round    - { courseId, tees, holes, playerTees, playerHandicaps, manualHandicaps }
//   players  - [{ id, name, handicap }]   (handicap = base index)
//   onChange - (patch) => void, patch = { playerTees, playerHandicaps, manualHandicaps }
//              playerHandicaps values are numbers.
//   theme    - theme object
//
// Hosts MUST pass key={round.id} (and, where base indexes can change, fold a
// base-index signature into the key) so the component remounts and re-resolves.
export default function RoundTeeAssignments({ round, players = [], onChange, theme }) {
  const s = makeStyles(theme);
  const tees = round?.tees ?? [];
  const holes = round?.holes ?? [];
  const courseId = round?.courseId ?? null;
  const totalPar = holes.reduce((sum, h) => sum + (h.par || 0), 0);

  // playerTees: { [playerId]: { label, slope, rating } }
  const [playerTees, setPlayerTees] = useState(() => ({ ...(round?.playerTees ?? {}) }));
  // playerHandicaps: { [playerId]: string } — editable
  const [playerHandicaps, setPlayerHandicaps] = useState(() => {
    const init = {};
    players.forEach((p) => {
      const existing = round?.playerHandicaps?.[p.id];
      init[p.id] = existing != null ? String(existing) : String(p.handicap);
    });
    return init;
  });
  const [manualHandicaps, setManualHandicaps] = useState(
    () => ({ ...(round?.manualHandicaps ?? {}) }),
  );
  // expandedId: which player's row is open (only one at a time).
  // editingHandicapId: which player's handicap is in type-to-edit mode.
  const [expandedId, setExpandedId] = useState(null);
  const [editingHandicapId, setEditingHandicapId] = useState(null);

  const isFirstRender = useRef(true);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // On mount: ensure every player has a tee (last-used on this course, else
  // the middle tee), then align non-manual playing handicaps to each tee.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = { ...playerTees };
      for (const p of players) {
        if (resolved[p.id]) continue;
        let tee = null;
        if (courseId) {
          try { tee = await lastTeeForPlayerOnCourse(courseId, p.id); } catch (_) {}
        }
        if (!tee) {
          const mid = middleTee(tees);
          if (mid) tee = { label: mid.label, slope: mid.slope, rating: mid.rating };
        }
        if (tee) resolved[p.id] = tee;
      }
      if (cancelled) return;
      // Only update tee state when a missing tee was actually resolved —
      // avoids a spurious onChange (and autosave) when every player already
      // had a tee.
      const teesChanged = players.some((p) => playerTees[p.id] == null && resolved[p.id] != null);
      if (teesChanged) setPlayerTees(resolved);
      setPlayerHandicaps((prev) => {
        const next = { ...prev };
        let changed = false;
        players.forEach((p) => {
          if (manualHandicaps[p.id]) return;
          const tee = resolved[p.id];
          const auto = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
          if (next[p.id] !== auto) { next[p.id] = auto; changed = true; }
        });
        return changed ? next : prev;
      });
    })();
    return () => { cancelled = true; };
    // Run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emit changes to the host (skip the initial render).
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const parsedHandicaps = {};
    players.forEach((p) => { parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0; });
    onChangeRef.current({
      playerTees,
      playerHandicaps: parsedHandicaps,
      manualHandicaps,
    });
  }, [playerTees, playerHandicaps, manualHandicaps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute non-manual handicaps from each player's current tee.
  function recomputeAuto(nextPlayerTees, manual) {
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        if (manual[p.id]) return;
        const tee = nextPlayerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  // Assign a tee to one player and refresh their auto handicap.
  function setPlayerTee(playerId, tee) {
    const snapshot = { label: tee.label, slope: tee.slope, rating: tee.rating };
    const next = { ...playerTees, [playerId]: snapshot };
    setPlayerTees(next);
    recomputeAuto(next, manualHandicaps);
  }

  // Explicit "Reset all to auto": clear manual overrides, recompute from tees.
  function resetAllToAuto() {
    setManualHandicaps({});
    setPlayerHandicaps(() => {
      const next = {};
      players.forEach((p) => {
        const tee = playerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, totalPar));
      });
      return next;
    });
  }

  // Set a player's handicap to an explicit value and mark it a manual override.
  function setHandicapValue(playerId, value) {
    setPlayerHandicaps((prev) => ({ ...prev, [playerId]: value }));
    setManualHandicaps((prev) => ({ ...prev, [playerId]: true }));
  }

  // Nudge a player's handicap by delta (+/-1), clamped to a sane range.
  function stepHandicap(playerId, delta) {
    const current = parseInt(playerHandicaps[playerId], 10) || 0;
    setHandicapValue(playerId, String(clampPlayingHandicap(current + delta)));
  }

  if (players.length === 0) {
    return <Text style={s.emptyText}>Add players first.</Text>;
  }

  const anyManual = Object.values(manualHandicaps).some(Boolean);

  return (
    <View>
      {tees.length > 0 && (
        <Text style={s.hint}>Tap a player to set their tee. Handicaps auto-calculate.</Text>
      )}
      {anyManual && (
        <TouchableOpacity style={s.resetBtn} onPress={resetAllToAuto} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel="Reset all handicaps to auto">
          <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.resetBtnText}>Reset all to auto</Text>
        </TouchableOpacity>
      )}
      {players.map((p) => {
        const expanded = expandedId === p.id;
        const pTee = playerTees[p.id];
        const teeLabel = pTee?.label || null;
        const dotColor = teeColor(teeLabel);
        const valueStr = playerHandicaps[p.id] ?? '';
        const overridden = !!manualHandicaps[p.id];
        const editing = editingHandicapId === p.id;
        return (
          <View key={p.id} style={[s.card, expanded && s.cardExpanded]}>
            <TouchableOpacity
              style={s.rowHeader}
              activeOpacity={0.7}
              onPress={() => {
                setEditingHandicapId(null);
                setExpandedId(expanded ? null : p.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${teeLabel ? teeLabel + ' tee' : 'no tee selected'}, playing handicap ${valueStr || 'unset'}`}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{playerInitials(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <View style={s.teeSummary}>
                  {teeLabel ? (
                    <>
                      <View style={[s.teeDot, { backgroundColor: dotColor || theme.bg.secondary }]} />
                      <Text style={s.teeSummaryText}>{teeLabel} tee</Text>
                    </>
                  ) : (
                    <Text style={s.teeSummaryMuted}>
                      {tees.length === 0 ? 'No tees on this course' : 'Pick a tee'}
                    </Text>
                  )}
                  {overridden && <Text style={s.editedTag}>· Edited</Text>}
                </View>
              </View>
              <View style={s.hcpPill}>
                <Text style={s.hcpPillText}>{valueStr || '—'}</Text>
              </View>
              <Feather
                name={expanded ? 'chevron-down' : 'chevron-right'}
                size={18}
                color={theme.text.muted}
                style={{ marginLeft: 6 }}
              />
            </TouchableOpacity>

            {expanded && (
              <View style={s.editor}>
                <Text style={s.editorLabel}>TEE</Text>
                {tees.length === 0 ? (
                  <Text style={s.teeSummaryMuted}>No tees on this course</Text>
                ) : (
                  <View style={s.teePills}>
                    {tees.map((tee) => {
                      const selected = playerTees[p.id]?.label === tee.label;
                      const tColor = teeColor(tee.label);
                      return (
                        <TouchableOpacity
                          key={tee.id ?? tee.label}
                          style={[s.teePill, selected && s.teePillActive]}
                          onPress={() => setPlayerTee(p.id, tee)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`${p.name} tee ${tee.label || 'unnamed'}`}
                        >
                          <View style={[s.teeDot, { backgroundColor: tColor || theme.bg.secondary }]} />
                          <Text style={[s.teePillText, selected && s.teePillTextActive]}>
                            {tee.label || '—'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <Text style={s.editorLabel}>PLAYING HANDICAP</Text>
                <View style={s.stepper}>
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => stepHandicap(p.id, -1)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease ${p.name} handicap`}
                  >
                    <Feather name="minus" size={18} color={theme.accent.primary} />
                  </TouchableOpacity>
                  {editing ? (
                    <TextInput
                      style={s.stepInput}
                      keyboardType="numeric"
                      maxLength={4}
                      autoFocus
                      keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                      selectionColor={theme.accent.primary}
                      value={playerHandicaps[p.id] ?? ''}
                      onChangeText={(v) => setHandicapValue(p.id, v)}
                      onBlur={() => {
                        setHandicapValue(
                          p.id,
                          String(clampPlayingHandicap(parseInt(playerHandicaps[p.id], 10) || 0)),
                        );
                        setEditingHandicapId(null);
                      }}
                    />
                  ) : (
                    <TouchableOpacity
                      style={s.stepValueWrap}
                      onPress={() => setEditingHandicapId(p.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${p.name} handicap, currently ${valueStr || '0'}`}
                    >
                      <Text style={s.stepValue}>{valueStr || '0'}</Text>
                      <Feather name="edit-2" size={12} color={theme.text.muted} style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.stepBtn}
                    onPress={() => stepHandicap(p.id, 1)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${p.name} handicap`}
                  >
                    <Feather name="plus" size={18} color={theme.accent.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  emptyText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13 },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 12, marginBottom: 10 },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 8,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10,
  },
  resetBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },

  card: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    marginBottom: 8,
  },
  cardExpanded: { borderColor: theme.accent.primary + '66' },
  rowHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 11 },

  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: theme.accent.light,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },

  name: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  teeSummary: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  teeDot: {
    width: 13, height: 13, borderRadius: 7,
    borderWidth: 1, borderColor: theme.border.default, marginRight: 6,
  },
  teeSummaryText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary, fontSize: 12 },
  teeSummaryMuted: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
  editedTag: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11, marginLeft: 6 },

  hcpPill: {
    backgroundColor: theme.accent.light, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 5, minWidth: 40, alignItems: 'center',
  },
  hcpPillText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },

  editor: {
    paddingHorizontal: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: theme.border.default,
  },
  editorLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
    fontSize: 10, letterSpacing: 0.6, marginTop: 12, marginBottom: 7,
  },
  teePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  teePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.isDark ? theme.bg.card : theme.bg.secondary,
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  teePillActive: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  teePillText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
  teePillTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 12 },

  stepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.isDark ? theme.bg.card : theme.bg.secondary,
    borderRadius: 12, padding: 5,
  },
  stepBtn: {
    width: 40, height: 40, borderRadius: 9,
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  stepValueWrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  stepValue: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 20 },
  stepInput: {
    flex: 1, marginHorizontal: 8, textAlign: 'center',
    color: theme.text.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 20,
    padding: 0,
  },
});
```

- [ ] **Step 2: Run the helper tests to confirm they still pass**

Run: `npm test -- roundTeeAssignments`
Expected: PASS — the 10 helper tests from Task 1 are unaffected by the rewrite.

- [ ] **Step 3: Run lint on the changed file**

Run: `npm run lint`
Expected: no new errors for `src/components/RoundTeeAssignments.js`.

- [ ] **Step 4: Commit**

```bash
git add src/components/RoundTeeAssignments.js
git commit -m "feat: redesign Tees & Handicaps step as compact collapsible list"
```

---

## Task 3: Full verification

Confirm no regression across the whole test suite and the web build.

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green (the existing ~256 tests plus the 10 new
helper tests). No suite references `RoundTeeAssignments` rendering, so the
component rewrite cannot break a test.

- [ ] **Step 2: Verify the web build compiles**

Run: `npm run build:web`
Expected: build completes without errors (this exercises that the rewritten
JSX and imports are valid).

- [ ] **Step 3: Manual smoke check (reviewer, optional)**

Start the app (`npm run web`), create a New Game with 2+ players, advance to
the "Tees & Handicaps" step, and confirm:
- Each player shows as a collapsed card with avatar, name, colored tee dot +
  label, and a handicap pill.
- Tapping a card expands it; tapping another collapses the first.
- Selecting a different tee pill updates the handicap and the collapsed dot.
- The `−`/`+` stepper changes the handicap; tapping the number lets you type
  one; an edited player shows the "· Edited" marker and the "Reset all to
  auto" button appears.

- [ ] **Step 4: Commit (only if Step 3 surfaced fixes)**

```bash
git add -A
git commit -m "fix: address Tees & Handicaps redesign smoke-test findings"
```

---

## Self-Review Notes

- **Spec coverage:** collapsed row (Task 2), expanded editor + tee pills +
  stepper with tappable value (Task 2), one-row-at-a-time expand (Task 2,
  `expandedId`), −9…54 clamp (`clampPlayingHandicap`, Tasks 1–2), no-tees and
  no-players edge cases (Task 2), override indicator + "Reset all to auto"
  (Task 2), preserved `onChange` contract / mount effect / remount key
  (Task 2 keeps them verbatim), tournaments unchanged (host untouched),
  pure-helper tests (Task 1). All spec sections map to a task.
- **No placeholders:** every code step contains complete content.
- **Type consistency:** `playerInitials`, `clampPlayingHandicap`, `teeColor`,
  `setHandicapValue`, `stepHandicap`, `expandedId`, `editingHandicapId` are
  named identically across Tasks 1–2.
