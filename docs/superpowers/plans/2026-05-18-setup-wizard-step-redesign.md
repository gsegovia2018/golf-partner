# Setup Wizard Step Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the middle content of the Players and Course steps in the New Game / Tournament setup wizard — a 2×2 player slot grid and a per-round course card — without touching steps, titles, or the Back/Next bar.

**Architecture:** Purely presentational change inside `src/screens/SetupScreen.js`. The `renderPlayersStep` and `renderCourseStep` function bodies are rewritten and their styles in `makeStyles` are updated; all state, navigation, validation, and handler logic is reused unchanged except for one new `renamingIndex` state for inline course renaming.

**Tech Stack:** React Native, `@expo/vector-icons` (Feather), the app's `ThemeContext`.

---

## Notes on Testing

This is a visual redesign of two render functions. The codebase has **no component
tests** for `SetupScreen` — only pure-helper tests in
`src/screens/__tests__/setupWizard.test.js`, which this work does not touch.
There is therefore no meaningful unit test to write first; do **not** fabricate
one. Verification for each task is:

1. `npm test` — the full Jest suite still passes (regression check).
2. A manual visual checklist (spelled out per task).

Both must pass before committing.

## File Structure

- **Modify** `src/screens/SetupScreen.js`:
  - Import list — add `Image`.
  - New state — `renamingIndex`.
  - `removeRound` — add one line resetting `renamingIndex`.
  - `renderPlayersStep` — rewritten body.
  - `renderCourseStep` — rewritten body.
  - `makeStyles` — remove dead styles, add new ones.

No new files. No store, navigation, schema, or test-file changes.

---

## Task 1: Players step — 2×2 slot grid

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Add the `Image` import**

In `src/screens/SetupScreen.js`, the React Native import (currently lines 2–5)
reads:

```js
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
```

Change it to add `Image`:

```js
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
```

- [ ] **Step 2: Rewrite `renderPlayersStep`**

Replace the entire `renderPlayersStep` constant (currently lines 318–354) with:

```js
  const renderPlayersStep = () => {
    const emptySlots = Math.max(0, 4 - players.length);
    return (
      <>
        <Text style={s.stepOverline}>PLAYERS</Text>
        <Text style={s.stepPrompt}>Who's playing?</Text>
        <Text style={s.stepSubtitle}>Add 1–4 golfers from your library.</Text>
        <View style={s.slotGrid}>
          {players.map((p) => (
            <View key={p.id} style={s.slotFilled}>
              <TouchableOpacity
                style={s.slotRemove}
                onPress={() => removePlayer(p.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={13} color={theme.destructive} />
              </TouchableOpacity>
              <View style={s.slotAvatar}>
                {p.avatar_url
                  ? <Image source={{ uri: p.avatar_url }} style={s.slotAvatarImg} />
                  : <Text style={s.slotAvatarText}>{(p.name ?? '?').slice(0, 2).toUpperCase()}</Text>}
              </View>
              <Text style={s.slotName} numberOfLines={1}>{p.name}</Text>
              <Text style={s.slotHcp}>HCP {p.handicap}</Text>
            </View>
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <TouchableOpacity
              key={`empty-${i}`}
              style={s.slotEmpty}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('PlayerPicker', {
                alreadySelectedIds: players.map((pl) => pl.id),
              })}
            >
              <View style={s.slotPlus}>
                <Feather name="plus" size={16} color={theme.accent.primary} />
              </View>
              <Text style={s.slotEmptyLabel}>ADD PLAYER</Text>
            </TouchableOpacity>
          ))}
        </View>
      </>
    );
  };
```

Note: the three `<Text>` title lines (overline / prompt / subtitle) are byte-for-byte
the same as before — only the content below them changes.

- [ ] **Step 3: Swap player styles in `makeStyles`**

In `makeStyles`, **delete** these now-unused style keys: `playerCard`,
`playerInfo`, `playerName`, `playerHcp`, `removeBtn`, `emptyHint`,
`emptyHintText`. (Leave `pickBtn` / `pickBtnText` — Task 2 removes them.)

Then **add** these new keys to the same `StyleSheet.create({ ... })` object
(place them after the `/* Input */` block):

```js
    /* Players slot grid */
    slotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    slotFilled: {
      width: '48%',
      marginBottom: 10,
      minHeight: 116,
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 14,
      alignItems: 'center',
      justifyContent: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    slotRemove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    slotAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.isDark ? theme.bg.secondary : '#006747',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginBottom: 8,
    },
    slotAvatarImg: { width: '100%', height: '100%' },
    slotAvatarText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: '#ffd700',
      fontSize: 15,
    },
    slotName: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 14,
      maxWidth: '100%',
    },
    slotHcp: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 3,
    },
    slotEmpty: {
      width: '48%',
      marginBottom: 10,
      minHeight: 116,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: theme.accent.primary + '40',
      borderStyle: 'dashed',
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 14,
    },
    slotPlus: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: theme.accent.primary,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    slotEmptyLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 11,
      letterSpacing: 0.8,
    },
```

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS — same suite result as before (the `setupWizard.test.js` tests
are untouched; no new failures).

- [ ] **Step 5: Manual visual check**

Start the app (`npm start`) and open New Game → Players step. Verify:
- 0 players → four dashed "+ ADD PLAYER" tiles in a 2×2 grid.
- Tapping any empty tile opens the Player Picker.
- After adding players, filled tiles show avatar (photo or initials), name, "HCP n".
- A filled tile shows a ✕ in its top-right corner; tapping it shows the remove
  confirm dialog and removes the player on confirm.
- At 4 players, no empty tiles remain.
- The "PLAYERS" overline, "Who's playing?" prompt, subtitle, and the Back/Next
  bar are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "feat: redesign Players wizard step as a 2x2 slot grid"
```

---

## Task 2: Course step — per-round course card

**Files:**
- Modify: `src/screens/SetupScreen.js`

- [ ] **Step 1: Add the `renamingIndex` state**

In the `SetupScreen` component, next to the other `useState` calls (the block
around lines 58–65, after `const [rawStep, setStep] = useState(0);`), add:

```js
  // Which round's course name is being edited inline (null = none).
  const [renamingIndex, setRenamingIndex] = useState(null);
```

- [ ] **Step 2: Reset `renamingIndex` when a round is removed**

In `removeRound` (currently lines 202–215), after the existing
`setRounds((prev) => prev.filter((_, i) => i !== index));` line, add:

```js
    setRenamingIndex(null);
```

So the end of `removeRound` reads:

```js
    if (!ok) return;
    setRounds((prev) => prev.filter((_, i) => i !== index));
    setRenamingIndex(null);
  }
```

- [ ] **Step 3: Rewrite `renderCourseStep`**

Replace the entire `renderCourseStep` constant (currently lines 356–444) with:

```js
  const renderCourseStep = () => (
    <>
      <Text style={s.stepOverline}>{isGame ? 'COURSE' : 'ROUNDS'}</Text>
      <Text style={s.stepPrompt}>Where are you playing?</Text>
      <Text style={s.stepSubtitle}>
        {isGame
          ? 'Pick a course, then fine-tune the holes if needed.'
          : 'Add each round and pick its course.'}
      </Text>
      {rounds.map((r, i) => {
        const totalPar = r.holes.reduce((sum, h) => sum + h.par, 0);
        const hasCourse = !!r.courseName.trim();
        const isRenaming = renamingIndex === i;
        return (
          <View key={r.id ?? `round-${i}`} style={s.courseBlock}>
            <View style={s.roundHeader}>
              {!isGame && <Text style={s.roundLabel}>Round {i + 1}</Text>}
              {rounds.length > 1 && (
                <TouchableOpacity onPress={() => removeRound(i)} style={s.removeRoundBtn}>
                  <Feather name="trash-2" size={14} color={theme.destructive} />
                  <Text style={s.removeRoundText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            {hasCourse ? (
              <View style={s.courseCard}>
                <View style={s.courseCardTop}>
                  {isRenaming ? (
                    <>
                      <View style={s.coursePin}>
                        <Feather name="map-pin" size={15} color={theme.accent.primary} />
                      </View>
                      <TextInput
                        style={s.courseNameInput}
                        value={r.courseName}
                        onChangeText={(v) => updateCourseName(i, v)}
                        onBlur={() => setRenamingIndex(null)}
                        onSubmitEditing={() => setRenamingIndex(null)}
                        autoFocus
                        placeholder="Course name"
                        placeholderTextColor={theme.text.muted}
                        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                        selectionColor={theme.accent.primary}
                      />
                    </>
                  ) : (
                    <TouchableOpacity
                      style={s.courseIdentity}
                      activeOpacity={0.7}
                      onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
                    >
                      <View style={s.coursePin}>
                        <Feather name="map-pin" size={15} color={theme.accent.primary} />
                      </View>
                      <Text style={s.courseCardName} numberOfLines={1}>{r.courseName}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.coursePencil}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => setRenamingIndex(isRenaming ? null : i)}
                  >
                    <Feather
                      name={isRenaming ? 'check' : 'edit-2'}
                      size={14}
                      color={isRenaming ? theme.accent.primary : theme.text.muted}
                    />
                  </TouchableOpacity>
                </View>

                <View style={s.courseStats}>
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{totalPar}</Text>
                    <Text style={s.courseStatLabel}>PAR</Text>
                  </View>
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{r.holes.length}</Text>
                    <Text style={s.courseStatLabel}>HOLES</Text>
                  </View>
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{r.slope ?? '—'}</Text>
                    <Text style={s.courseStatLabel}>SLOPE</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={s.courseConfigRow}
                  onPress={() =>
                    navigation.navigate('CourseEditor', {
                      roundIndex: i,
                      courseName: r.courseName || `Round ${i + 1}`,
                      initialHoles: r.holes,
                      onSave: handleHolesSaved,
                      players: players,
                      initialSlope: r.slope,
                      initialCourseRating: r.courseRating ?? null,
                      initialPlayerHandicaps: r.playerHandicaps,
                      initialManualHandicaps: r.manualHandicaps ?? {},
                      courseId: r.courseId ?? null,
                    })
                  }
                >
                  <Feather name="settings" size={14} color={theme.accent.primary} />
                  <Text style={s.courseConfigText}>Configure holes</Text>
                  <Feather name="chevron-right" size={16} color={theme.text.muted} style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={s.courseEmpty}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
                >
                  <View style={s.courseEmptyPin}>
                    <Feather name="map-pin" size={20} color={theme.accent.primary} />
                  </View>
                  <Text style={s.courseEmptyTitle}>Pick a course from library</Text>
                  <Text style={s.courseEmptyHint}>Tap to choose where you're playing</Text>
                </TouchableOpacity>
                <Text style={s.errorText}>
                  {isGame ? 'A course is required.' : `Round ${i + 1} needs a course.`}
                </Text>
              </>
            )}
          </View>
        );
      })}
      {!isGame && (
        <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
          <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.addRoundBtnText}>Add Round</Text>
        </TouchableOpacity>
      )}
    </>
  );
```

Note: the overline / prompt / subtitle title lines, the `roundHeader` block, the
`errorText`, and the "Add Round" button are unchanged from the original — only
the per-round body (pick button + text input + edit-holes button) is replaced by
the course card / empty tile.

- [ ] **Step 4: Swap course styles in `makeStyles`**

In `makeStyles`, **delete** these now-unused style keys: `input`, `pickBtn`,
`pickBtnText`, `editHolesBtn`, `editHolesBtnText`. (`courseBlock`, `roundHeader`,
`roundLabel`, `removeRoundBtn`, `removeRoundText`, `addRoundBtn`,
`addRoundBtnText`, `errorText` stay — they are still used.)

Then **add** these new keys to the same `StyleSheet.create({ ... })` object
(place them after the `/* Rounds */` `courseBlock` block):

```js
    /* Course card */
    courseCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    courseCardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 13,
    },
    courseIdentity: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    coursePin: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    courseCardName: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
    },
    courseNameInput: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
      padding: 0,
      borderBottomWidth: 1,
      borderBottomColor: theme.accent.primary,
    },
    coursePencil: {
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 6,
    },
    courseStats: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 13,
      paddingBottom: 13,
    },
    courseStat: {
      flex: 1,
      backgroundColor: theme.bg.secondary,
      borderRadius: 10,
      paddingVertical: 8,
      alignItems: 'center',
    },
    courseStatValue: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
    },
    courseStatLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 9,
      letterSpacing: 0.6,
      marginTop: 2,
    },
    courseConfigRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 13,
      borderTopWidth: 1,
      borderTopColor: theme.border.subtle,
    },
    courseConfigText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 14,
    },
    courseEmpty: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: theme.accent.primary + '40',
      borderStyle: 'dashed',
      paddingVertical: 26,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    courseEmptyPin: {
      width: 44,
      height: 44,
      borderRadius: 13,
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    courseEmptyTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 14,
    },
    courseEmptyHint: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 12,
      marginTop: 3,
    },
```

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS — same suite result as before, no new failures.

- [ ] **Step 6: Manual visual check**

Start the app (`npm start`). Check **New Game** (single course) and a
**Tournament** (multi-round):
- No course → a dashed tile with a pin, "Pick a course from library", and the
  "Tap to choose where you're playing" hint; the round-required error shows
  below it; Next is disabled.
- Tapping the empty tile opens the Course Picker.
- After picking, the card shows course name, Par / Holes / Slope chips (Slope
  shows "—" when unknown), and a "Configure holes" row.
- Tapping the pin / name area re-opens the Course Picker (swap course).
- Tapping the pencil turns the name into an editable field (icon becomes a
  check); editing updates the name; blur / check collapses it back.
- Tapping "Configure holes" opens the Course Editor; saving there updates the
  Par / Holes / Slope chips.
- Tournament: each round renders its own card; "Round N" labels, per-round
  Remove, and "Add Round" all still work.
- The "COURSE"/"ROUNDS" overline, "Where are you playing?" prompt, subtitle, and
  the Back/Next bar are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "feat: redesign Course wizard step as a per-round course card"
```

---

## Final Verification

- [ ] **Run the full suite once more**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Confirm no dead styles remain**

Run: `grep -nE 'playerCard|playerInfo|playerHcp|emptyHint|editHolesBtn|pickBtn|s\.input' src/screens/SetupScreen.js`
Expected: no output (every removed style key is gone from both `makeStyles` and
all JSX references). `playerName` may still appear in other screens — only check
`SetupScreen.js`.
