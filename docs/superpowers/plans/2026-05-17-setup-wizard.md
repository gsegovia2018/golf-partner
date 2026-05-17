# New Game / Tournament Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-scroll New Game / New Tournament screen with a modern stepped wizard (Players → Course/Rounds → Scoring → Review) with a progress bar and a green-hero Review step.

**Architecture:** `SetupScreen.js` stays one mounted component with an internal `step` index (not separate nav routes) so library-picker round-trips preserve position. Step membership is computed by a new pure module `setupWizard.js`. Two new presentational components — `WizardProgress` (header + progress bar) and `WizardNav` (sticky Back/Next bar) — frame the step bodies. All existing setup state and `handleStart()` logic are unchanged.

**Tech Stack:** React Native (Expo), React Navigation, Jest. Theme via `useTheme()` / `src/theme/tokens.js`. Icons via `@expo/vector-icons` Feather.

**Spec:** `docs/superpowers/specs/2026-05-17-setup-wizard-design.md`

---

## File Structure

- **Create** `src/screens/setupWizard.js` — pure helpers `wizardSteps()` and `isStepValid()`. No React, no theme. Unit-tested.
- **Create** `src/screens/__tests__/setupWizard.test.js` — Jest tests for the helpers.
- **Create** `src/components/setup/WizardProgress.js` — presentational header: back chevron, step label, segmented progress bar.
- **Create** `src/components/setup/WizardNav.js` — presentational sticky bottom Back/Next bar.
- **Modify** `src/screens/SetupScreen.js` — refactor render into the wizard orchestrator; add `step` state, step bodies, and the Review step.

---

## Task 1: `setupWizard.js` pure helpers

**Files:**
- Create: `src/screens/setupWizard.js`
- Test: `src/screens/__tests__/setupWizard.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/setupWizard.test.js`:

```js
import { wizardSteps, isStepValid } from '../setupWizard';

describe('wizardSteps', () => {
  test('solo game omits the scoring step', () => {
    expect(wizardSteps('game', 1)).toEqual(['players', 'course', 'review']);
  });
  test('multiplayer game includes the scoring step', () => {
    expect(wizardSteps('game', 2)).toEqual(['players', 'course', 'scoring', 'review']);
  });
  test('solo tournament uses the rounds step and omits scoring', () => {
    expect(wizardSteps('tournament', 1)).toEqual(['players', 'rounds', 'review']);
  });
  test('multiplayer tournament uses rounds and includes scoring', () => {
    expect(wizardSteps('tournament', 3)).toEqual(['players', 'rounds', 'scoring', 'review']);
  });
});

describe('isStepValid', () => {
  test('players step needs at least one player', () => {
    expect(isStepValid('players', { players: [], rounds: [] })).toBe(false);
    expect(isStepValid('players', { players: [{ id: 'a' }], rounds: [] })).toBe(true);
  });
  test('course step needs the round to have a course name', () => {
    expect(isStepValid('course', { players: [], rounds: [{ courseName: '' }] })).toBe(false);
    expect(isStepValid('course', { players: [], rounds: [{ courseName: 'Pebble' }] })).toBe(true);
  });
  test('rounds step is invalid when any round lacks a course', () => {
    expect(isStepValid('rounds', {
      players: [], rounds: [{ courseName: 'A' }, { courseName: '  ' }],
    })).toBe(false);
    expect(isStepValid('rounds', {
      players: [], rounds: [{ courseName: 'A' }, { courseName: 'B' }],
    })).toBe(true);
  });
  test('scoring and review steps are always valid', () => {
    expect(isStepValid('scoring', { players: [], rounds: [] })).toBe(true);
    expect(isStepValid('review', { players: [], rounds: [] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/setupWizard.test.js`
Expected: FAIL — `Cannot find module '../setupWizard'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/screens/setupWizard.js`:

```js
// Pure helpers for the New Game / Tournament setup wizard.
//
// The wizard is a sequence of steps whose membership depends on the
// tournament kind and roster size: the Scoring step only exists once there
// are 2+ players (a solo game is always solo play, so there is nothing to
// choose). Keeping this logic pure makes it unit-testable in isolation.

/**
 * Ordered list of step keys for the current setup.
 * @param {'game'|'tournament'} kind
 * @param {number} playerCount
 * @returns {string[]}
 */
export function wizardSteps(kind, playerCount) {
  const courseStep = kind === 'tournament' ? 'rounds' : 'course';
  const steps = ['players', courseStep];
  if (playerCount >= 2) steps.push('scoring');
  steps.push('review');
  return steps;
}

/**
 * Whether the given step's requirements are satisfied. Gates the Next button.
 * @param {string} stepKey
 * @param {{ players: any[], rounds: { courseName?: string }[] }} state
 * @returns {boolean}
 */
export function isStepValid(stepKey, { players, rounds }) {
  switch (stepKey) {
    case 'players':
      return players.length >= 1;
    case 'course':
    case 'rounds':
      return rounds.every((r) => (r.courseName || '').trim().length > 0);
    case 'scoring':
    case 'review':
      return true;
    default:
      return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/__tests__/setupWizard.test.js`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/screens/setupWizard.js src/screens/__tests__/setupWizard.test.js
git commit -m "$(cat <<'EOF'
feat: pure step helpers for setup wizard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `WizardProgress` component

**Files:**
- Create: `src/components/setup/WizardProgress.js`

- [ ] **Step 1: Write the component**

Create `src/components/setup/WizardProgress.js`:

```js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Wizard header: back chevron, "STEP X OF N" label, and a segmented progress
// bar. Purely presentational — all behaviour comes from props.
//
// Props:
//   step       0-based index of the active step
//   totalSteps total number of steps
//   onBack     called when the chevron is tapped
export default function WizardProgress({ step, totalSteps, onBack }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} accessibilityLabel="Go back">
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.label}>{`STEP ${step + 1} OF ${totalSteps}`}</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={s.bar}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[s.seg, i <= step ? s.segOn : s.segOff]} />
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    label: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.muted,
      fontSize: 11, letterSpacing: 1.6,
    },
    bar: { flexDirection: 'row', gap: 5, marginTop: 12 },
    seg: { flex: 1, height: 4, borderRadius: 2 },
    segOn: { backgroundColor: theme.accent.primary },
    segOff: { backgroundColor: theme.border.default },
  });
}
```

- [ ] **Step 2: Verify the bundle still compiles**

Run: `npx jest` (the full suite — confirms no import-resolution regression).
Expected: PASS — same test count as before this task plus Task 1's 9 tests.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/WizardProgress.js
git commit -m "$(cat <<'EOF'
feat: WizardProgress header component for setup wizard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `WizardNav` component

**Files:**
- Create: `src/components/setup/WizardNav.js`

- [ ] **Step 1: Write the component**

Create `src/components/setup/WizardNav.js`:

```js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Sticky bottom navigation bar for the setup wizard.
//
// Props:
//   isFirstStep  hides the Back button when true
//   isLastStep   shows a play icon and treats Next as the "Start" action
//   nextEnabled  greys out and disables Next when false
//   nextLabel    text on the Next/Start button
//   onBack       called when Back is tapped
//   onNext       called when Next/Start is tapped
export default function WizardNav({
  isFirstStep, isLastStep, nextEnabled, nextLabel, onBack, onNext,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const iconColor = theme.isDark ? theme.accent.primary : theme.text.inverse;
  return (
    <View style={s.bar}>
      {!isFirstStep && (
        <TouchableOpacity style={s.backBtn} onPress={onBack} activeOpacity={0.8}>
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[s.nextBtn, !nextEnabled && { opacity: 0.5 }]}
        onPress={onNext}
        disabled={!nextEnabled}
        activeOpacity={0.8}
      >
        {isLastStep && (
          <Feather name="play" size={16} color={iconColor} style={{ marginRight: 8 }} />
        )}
        <Text style={s.nextText}>{nextLabel}</Text>
        {!isLastStep && (
          <Feather name="chevron-right" size={18} color={iconColor} style={{ marginLeft: 4 }} />
        )}
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row', gap: 10,
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
      backgroundColor: theme.bg.primary,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    backBtn: {
      minWidth: 92,
      alignItems: 'center', justifyContent: 'center',
      borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 16, paddingHorizontal: 18,
    },
    backText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.secondary, fontSize: 14,
    },
    nextBtn: {
      flex: 1,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
      borderRadius: 14,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
      paddingVertical: 16,
      ...(theme.isDark ? {} : theme.shadow.accent),
    },
    nextText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.isDark ? theme.accent.primary : theme.text.inverse,
      fontSize: 15,
    },
  });
}
```

- [ ] **Step 2: Verify the bundle still compiles**

Run: `npx jest`
Expected: PASS — no change in test count from Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/components/setup/WizardNav.js
git commit -m "$(cat <<'EOF'
feat: WizardNav bottom bar component for setup wizard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Refactor `SetupScreen.js` into the wizard

This task replaces the entire contents of `src/screens/SetupScreen.js`. All
domain logic (`newRoundId`, `confirmDialog`, `buildGameName`, the focus-effect
consume logic, `handleHolesSaved`, `removePlayer`, `updateCourseName`,
`addRound`, `removeRound`, `handleStart`) is carried over unchanged. Only the
render tree, the new `step` state, and the styles change.

**Files:**
- Modify: `src/screens/SetupScreen.js` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Overwrite `src/screens/SetupScreen.js` with exactly:

```js
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';

import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { createTournament, saveTournament, randomPairs, DEFAULT_SETTINGS, deriveRoundPlayingHandicap } from '../store/tournamentStore';
import { defaultHoles, fetchCourses, fetchPlayers } from '../store/libraryStore';
import { consumePendingPlayers, consumePendingCourses } from '../lib/selectionBridge';
import { useTheme } from '../theme/ThemeContext';
import ScoringModePicker, { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';
import { scoringModeUsesTeams, getScoringMode } from '../components/scoringModes';
import WizardProgress from '../components/setup/WizardProgress';
import WizardNav from '../components/setup/WizardNav';
import { wizardSteps, isStepValid } from './setupWizard';

// Deep green used for the Review hero band — fixed in both themes so white
// hero text always has strong contrast.
const HERO_GREEN = '#024d36';

// Stable id for a round so React keys / removal survive reordering.
let _roundIdSeq = 0;
function newRoundId() { return `setup-r${Date.now()}-${_roundIdSeq++}`; }

async function confirmDialog(title, message, confirmLabel = 'Remove') {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise((resolve) => Alert.alert(
    title, message,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
     { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) }],
  ));
}

function buildGameName(courseName) {
  const d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const stamp = `${d.getDate()} ${months[d.getMonth()]}`;
  const trimmed = (courseName || '').trim();
  if (!trimmed) return `Game · ${stamp}`;
  // Keep the title short — golf course names can be very long and clip
  // in the tournament header. Trim to ~22 chars with an ellipsis when
  // combined with the date.
  const MAX = 22;
  const shortCourse = trimmed.length > MAX ? `${trimmed.slice(0, MAX - 1).trimEnd()}…` : trimmed;
  return `${shortCourse} · ${stamp}`;
}

export default function SetupScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const kind = route?.params?.kind === 'game' ? 'game' : 'tournament';
  const isGame = kind === 'game';

  const [tournamentName, setTournamentName] = useState(() =>
    isGame ? buildGameName('') : 'Weekend Golf',
  );
  const [nameTouched, setNameTouched] = useState(false);
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([{ id: newRoundId(), courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [step, setStep] = useState(0);

  // The active step list depends on kind + roster size (Scoring only exists
  // for 2+ players). stepKey is the key of the currently displayed step.
  const steps = useMemo(() => wizardSteps(kind, players.length), [kind, players.length]);
  const stepKey = steps[step] ?? steps[steps.length - 1];

  // When the roster shrinks the Scoring step away, the steps array gets
  // shorter — clamp the active index so it never points past the array.
  useEffect(() => {
    setStep((prev) => Math.min(prev, steps.length - 1));
  }, [steps.length]);

  // Whenever the player count makes the chosen scoring mode invalid, fall
  // back to a mode that is always valid for the current roster.
  useEffect(() => {
    if (!isScoringModeAllowed(settings.scoringMode, players.length)) {
      setSettings((prev) => ({ ...prev, scoringMode: fallbackScoringMode(players.length) }));
    }
  }, [players.length, settings.scoringMode]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;

    const picked = consumePendingPlayers();
    if (picked && picked.length > 0) {
      (async () => {
        // Re-fetch from the library to pick up renames / handicap edits that
        // may have happened between the picker tap and this screen gaining
        // focus. Fall back to the picker snapshot if the library read fails.
        let fresh = picked;
        try {
          const all = await fetchPlayers();
          fresh = picked.map((p) => {
            const latest = all.find((x) => x.id === p.id);
            return latest ? { ...p, name: latest.name, handicap: latest.handicap } : p;
          });
        } catch (_) { /* keep snapshot */ }
        if (cancelled) return;
        setPlayers((prev) => {
          const next = [...prev];
          for (const p of fresh) {
            if (next.length >= 4 || next.find((x) => x.id === p.id)) continue;
            // Carry user_id / avatar_url so the embedded player links back to
            // a real account (feed attribution, friend stats). Guest players
            // added via the picker form simply have these undefined.
            next.push({
              id: p.id,
              name: p.name,
              handicap: p.handicap,
              user_id: p.user_id ?? null,
              avatar_url: p.avatar_url ?? null,
            });
          }
          return next;
        });
      })();
    }

    const pc = consumePendingCourses();
    if (pc && pc.courses.length > 0) {
      const { startRoundIndex, courses } = pc;
      (async () => {
        let freshCourses = courses;
        try {
          const all = await fetchCourses();
          freshCourses = courses.map((c) => all.find((x) => x.id === c.id) ?? c);
        } catch (_) { /* keep snapshot */ }
        if (cancelled) return;
        setRounds((prev) => {
          const next = [...prev];
          freshCourses.forEach((course, i) => {
            const idx = startRoundIndex + i;
            const roundData = {
              courseId: course.id,
              courseName: course.name,
              // Deep-copy so later edits in CourseEditor don't mutate the
              // library's in-memory hole objects.
              holes: course.holes.map((h) => ({ ...h })),
              slope: course.slope,
              courseRating: course.rating ?? null,
              playerHandicaps: null,
            };
            if (idx < next.length) {
              next[idx] = { ...next[idx], ...roundData };
            } else {
              // Stable id so React keys / removal survive reordering.
              next.push({ id: newRoundId(), ...roundData });
            }
          });
          return next;
        });
        if (isGame && !nameTouched && startRoundIndex === 0 && freshCourses[0]?.name) {
          setTournamentName(buildGameName(freshCourses[0].name));
        }
      })();
    }

    return () => { cancelled = true; };
  }, []));

  const handleHolesSaved = useCallback((roundIndex, holes, slope, courseRating, playerHandicaps, manualHandicaps) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes, slope, courseRating, playerHandicaps,
        manualHandicaps: { ...(manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);

  async function removePlayer(id) {
    const player = players.find((p) => p.id === id);
    const ok = await confirmDialog(
      'Remove player',
      `Remove ${player?.name ?? 'this player'} from the ${isGame ? 'game' : 'tournament'}?`,
    );
    if (!ok) return;
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }

  function updateCourseName(index, value) {
    setRounds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], courseName: value };
      return next;
    });
    if (isGame && !nameTouched && index === 0) {
      setTournamentName(buildGameName(value));
    }
  }

  function addRound() {
    setRounds((prev) => [...prev, { id: newRoundId(), courseName: '', holes: defaultHoles(), slope: null, courseRating: null, playerHandicaps: null, manualHandicaps: {} }]);
  }

  async function removeRound(index) {
    const round = rounds[index];
    // Setup-stage rounds carry no entered scores yet, but a course may have
    // been configured — still confirm so a stray tap doesn't wipe holes/slope.
    const hasCourse = !!(round?.courseName || '').trim();
    const ok = await confirmDialog(
      'Remove round',
      hasCourse
        ? `Round ${index + 1} (${round.courseName}) and its hole setup will be removed.`
        : `Remove Round ${index + 1}?`,
    );
    if (!ok) return;
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  const missingCourseName = rounds.some((r) => !r.courseName.trim());
  const canStart = players.length >= 1 && !missingCourseName;

  async function handleStart() {
    if (players.length < 1) {
      Alert.alert('Missing info', 'Select at least 1 player.');
      return;
    }
    if (missingCourseName) {
      Alert.alert('Missing info', 'All course names are required.');
      return;
    }

    // Pairs are built from the scoring mode: team modes get random pairs,
    // every solo mode (including match play and sindicato) gets one
    // singleton pair per player. scoringModeUsesTeams is the single source
    // of truth, so new solo modes need no change here.
    const isMatchPlay = settings.scoringMode === 'matchplay';
    const buildPairs = () => (
      scoringModeUsesTeams(settings.scoringMode, players.length)
        ? randomPairs(players)
        : players.map((p) => [p])
    );

    const builtRounds = rounds.map((r, i) => {
      // Auto-derive WHS playing handicaps when the user never opened
      // Configure Holes (r.playerHandicaps still null). r already carries
      // holes / slope / courseRating here, so deriveRoundPlayingHandicap
      // yields the real playing handicap rather than the raw index.
      const playerHandicaps = r.playerHandicaps
        ?? Object.fromEntries(players.map((p) => [p.id, deriveRoundPlayingHandicap(p.handicap, r)]));
      return {
        id: `r${i}`,
        courseId: r.courseId ?? null,
        courseName: r.courseName.trim(),
        holes: r.holes,
        slope: r.slope ?? null,
        courseRating: r.courseRating ?? null,
        playerHandicaps,
        manualHandicaps: { ...(r.manualHandicaps ?? {}) },
        notes: '',
        pairs: buildPairs(),
        scores: {},
      };
    });

    const tournament = createTournament({
      kind,
      name: tournamentName.trim() || (isGame ? 'Game' : 'Weekend Golf'),
      players,
      rounds: builtRounds,
      settings: isMatchPlay
        ? { ...settings, scoringMode: 'matchplay', bestBallValue: 1, worstBallValue: 0 }
        : {
            ...settings,
            bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
            worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
          },
    });

    try {
      await saveTournament(tournament);
      // saveTournament marks the new tournament active, so jumping straight
      // to the Tournament view (Game menu) lands the user on what they just
      // created instead of bouncing back to the Home list.
      navigation.replace('Tournament');
    } catch (err) {
      const msg = err?.message ?? 'Could not create tournament';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  // ---- Wizard navigation -------------------------------------------------

  function handleBack() {
    // Step 0's back exits the screen entirely; later steps go back one step.
    if (step === 0) navigation.goBack();
    else setStep((p) => p - 1);
  }

  function handleNext() {
    if (stepKey === 'review') handleStart();
    else setStep((p) => Math.min(p + 1, steps.length - 1));
  }

  function goToStep(key) {
    const idx = steps.indexOf(key);
    if (idx >= 0) setStep(idx);
  }

  const isLastStep = stepKey === 'review';
  const nextEnabled = isStepValid(stepKey, { players, rounds })
    && (!isLastStep || canStart);
  const nextLabel = isLastStep
    ? (isGame ? 'Start Game' : 'Start Tournament')
    : 'Next';

  // ---- Step bodies -------------------------------------------------------

  const renderPlayersStep = () => (
    <>
      <Text style={s.stepOverline}>PLAYERS</Text>
      <Text style={s.stepPrompt}>Who's playing?</Text>
      <Text style={s.stepSubtitle}>Add 1–4 golfers from your library.</Text>
      {players.length === 0 && (
        <View style={s.emptyHint}>
          <Feather name="users" size={16} color={theme.text.muted} style={{ marginRight: 8 }} />
          <Text style={s.emptyHintText}>
            Add at least 1 player to {isGame ? 'start the game' : 'start the tournament'}.
          </Text>
        </View>
      )}
      {players.map((p) => (
        <View key={p.id} style={s.playerCard}>
          <View style={s.playerInfo}>
            <Text style={s.playerName}>{p.name}</Text>
            <Text style={s.playerHcp}>HCP {p.handicap}</Text>
          </View>
          <TouchableOpacity onPress={() => removePlayer(p.id)} style={s.removeBtn}>
            <Feather name="x" size={16} color={theme.destructive} />
          </TouchableOpacity>
        </View>
      ))}
      {players.length < 4 && (
        <TouchableOpacity
          style={s.pickBtn}
          onPress={() => navigation.navigate('PlayerPicker', {
            alreadySelectedIds: players.map((p) => p.id),
          })}
        >
          <Feather name="plus" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.pickBtnText}>Add Player from Library</Text>
        </TouchableOpacity>
      )}
    </>
  );

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
        const missingName = !r.courseName.trim();
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
            <TouchableOpacity
              style={s.pickBtn}
              onPress={() => navigation.navigate('CoursePicker', { roundIndex: i })}
            >
              <Feather
                name={r.courseName ? 'map-pin' : 'plus'}
                size={16}
                color={theme.accent.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={s.pickBtnText}>
                {r.courseName ? `Course: ${r.courseName}` : 'Pick Course from Library'}
              </Text>
            </TouchableOpacity>
            {missingName && (
              <Text style={s.errorText}>
                {isGame ? 'A course is required.' : `Round ${i + 1} needs a course.`}
              </Text>
            )}
            {r.courseName ? (
              <>
                <TextInput
                  style={s.input}
                  placeholder="Course name"
                  placeholderTextColor={theme.text.muted}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  value={r.courseName}
                  onChangeText={(v) => updateCourseName(i, v)}
                />
                <TouchableOpacity
                  style={s.editHolesBtn}
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
                  <Feather name="settings" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
                  <Text style={s.editHolesBtnText}>
                    Configure Holes  {'·'}  Par {totalPar}
                  </Text>
                  <Feather name="chevron-right" size={16} color={theme.accent.primary} style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              </>
            ) : null}
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

  const renderScoringStep = () => (
    <>
      <Text style={s.stepOverline}>SCORING</Text>
      <Text style={s.stepPrompt}>How do you keep score?</Text>
      <Text style={s.stepSubtitle}>Pick a format. You can change it later.</Text>
      <ScoringModePicker
        value={settings.scoringMode}
        onChange={(mode) => setSettings((prev) => ({ ...prev, scoringMode: mode }))}
        playerCount={players.length}
        settings={settings}
        onSettingsChange={setSettings}
      />
    </>
  );

  const renderReviewStep = () => {
    const hasScoringStep = steps.includes('scoring');
    const scoringLabel = getScoringMode(settings.scoringMode)?.label ?? 'Solo play';
    const playerSummary = players.length === 1
      ? `${players[0].name} · HCP ${players[0].handicap}`
      : `${players.length} golfers`;
    const courseSummary = isGame
      ? (rounds[0]?.courseName || 'No course set')
      : `${rounds.length} round${rounds.length === 1 ? '' : 's'}`;
    return (
      <>
        {/* Green hero recap */}
        <View style={s.reviewHero}>
          <Text style={s.reviewHeroOverline}>REVIEW & CONFIRM</Text>
          <TextInput
            style={s.reviewNameInput}
            value={tournamentName}
            onChangeText={(v) => { setTournamentName(v); setNameTouched(true); }}
            placeholder={isGame ? 'Game name' : 'Tournament name'}
            placeholderTextColor="rgba(255,255,255,0.5)"
            selectionColor="#ffffff"
          />
          <View style={s.reviewChipRow}>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>
                {players.length} player{players.length === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>{scoringLabel}</Text>
            </View>
          </View>
        </View>

        <Text style={s.stepOverline}>TAP TO EDIT</Text>
        <View style={s.reviewList}>
          <TouchableOpacity
            style={[s.reviewRow, s.reviewRowDivider]}
            onPress={() => goToStep('players')}
          >
            <Feather name="users" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>Players</Text>
              <Text style={s.reviewRowSub}>{playerSummary}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.reviewRow, s.reviewRowDivider]}
            onPress={() => goToStep(isGame ? 'course' : 'rounds')}
          >
            <Feather name="map-pin" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>{isGame ? 'Course' : 'Rounds'}</Text>
              <Text style={s.reviewRowSub}>{courseSummary}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.reviewRow}
            onPress={() => goToStep('scoring')}
            disabled={!hasScoringStep}
          >
            <Feather name="target" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>Scoring</Text>
              <Text style={s.reviewRowSub}>{scoringLabel}</Text>
            </View>
            {hasScoringStep && (
              <Feather name="chevron-right" size={18} color={theme.accent.primary} />
            )}
          </TouchableOpacity>
        </View>

        {!canStart && (
          <Text style={s.errorText}>
            {players.length < 1
              ? 'Add at least 1 player to continue.'
              : 'Pick a course for every round to continue.'}
          </Text>
        )}
      </>
    );
  };

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <WizardProgress step={step} totalSteps={steps.length} onBack={handleBack} />

      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {stepKey === 'players' && renderPlayersStep()}
        {(stepKey === 'course' || stepKey === 'rounds') && renderCourseStep()}
        {stepKey === 'scoring' && renderScoringStep()}
        {stepKey === 'review' && renderReviewStep()}
      </ScrollView>

      <WizardNav
        isFirstStep={step === 0}
        isLastStep={isLastStep}
        nextEnabled={nextEnabled}
        nextLabel={nextLabel}
        onBack={handleBack}
        onNext={handleNext}
      />
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.bg.primary,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 20,
      paddingBottom: 40,
    },

    /* Step heading */
    stepOverline: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 11,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    stepPrompt: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 26,
      color: theme.text.primary,
      letterSpacing: -0.3,
    },
    stepSubtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 13,
      marginTop: 6,
      marginBottom: 18,
    },

    /* Input */
    input: {
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      color: theme.text.primary,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 14,
      marginBottom: 10,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-Medium',
    },

    /* Player Cards */
    playerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      marginBottom: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    playerInfo: {
      flex: 1,
    },
    playerName: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 16,
    },
    playerHcp: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 3,
    },
    removeBtn: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: theme.bg.secondary,
      borderWidth: 1,
      borderColor: theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* Pick / Dashed Buttons */
    pickBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.accent.primary + '40',
      borderStyle: 'dashed',
      backgroundColor: theme.accent.light,
      padding: 14,
      marginBottom: 8,
    },
    pickBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 14,
    },

    /* Rounds */
    courseBlock: {
      marginBottom: 12,
    },
    roundHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    roundLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 13,
      letterSpacing: 0.5,
    },
    removeRoundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    removeRoundText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.destructive,
      fontSize: 13,
      marginLeft: 4,
    },

    /* Add Round */
    addRoundBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderStyle: 'dashed',
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
      padding: 14,
      marginTop: 4,
    },
    addRoundBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 14,
    },

    /* Edit Holes */
    editHolesBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.accent.light,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.accent.primary + '40',
      padding: 12,
      marginBottom: 4,
    },
    editHolesBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.accent.primary,
      fontSize: 14,
    },

    /* Empty / error states */
    emptyHint: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.bg.secondary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderStyle: 'dashed',
      padding: 14,
      marginBottom: 8,
    },
    emptyHintText: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
      fontSize: 13,
    },
    errorText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.destructive,
      fontSize: 12,
      marginBottom: 8,
      marginTop: 8,
    },

    /* Review hero */
    reviewHero: {
      backgroundColor: HERO_GREEN,
      borderRadius: 20,
      padding: 20,
      marginBottom: 20,
    },
    reviewHeroOverline: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: 'rgba(255,255,255,0.55)',
      fontSize: 10,
      letterSpacing: 1.6,
    },
    reviewNameInput: {
      fontFamily: 'PlayfairDisplay-Bold',
      color: '#ffffff',
      fontSize: 24,
      letterSpacing: -0.3,
      marginTop: 6,
      paddingVertical: 4,
    },
    reviewChipRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    reviewChip: {
      backgroundColor: 'rgba(255,255,255,0.14)',
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    reviewChipText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: '#ffffff',
      fontSize: 11,
    },

    /* Review tap-to-edit list */
    reviewList: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      overflow: 'hidden',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    reviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
    },
    reviewRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border.subtle,
    },
    reviewRowIcon: {
      marginRight: 12,
    },
    reviewRowTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 14,
    },
    reviewRowSub: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 2,
    },
  });
}
```

- [ ] **Step 2: Run the full Jest suite**

Run: `npx jest`
Expected: PASS — all suites green, including `setupWizard.test.js` from Task 1.
No test imports `SetupScreen` directly, so the count is unchanged from Task 3.

- [ ] **Step 3: Verify the web bundle builds**

Run: `npx expo export --platform web`
Expected: completes without bundler/module-resolution errors (confirms the new
imports — `setupWizard`, `WizardProgress`, `WizardNav`, `getScoringMode` — all
resolve and the JSX is valid).

- [ ] **Step 4: Manual verification**

Start the app (`npm run web`) and walk both flows:
- New Game: Step 1 of 3/4 shows "Who's playing?"; Next is disabled until a
  player is added; add a player → Next enabled. Step 2 "Where are you playing?"
  → Next disabled until a course is picked. With 2+ players a Scoring step
  appears; with 1 player it is skipped. Final Review step shows the green hero
  with the editable name, summary chips, and three tap-to-edit rows; tapping a
  row jumps back to that step. "Start Game" creates the game.
- New Tournament: same, but step 2 is "Rounds" and supports Add Round; the
  Review "Rounds" row shows the round count.
- Back on step 1 exits the screen. Removing players down to 1 while on a later
  step does not crash (step index clamps).

- [ ] **Step 5: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "$(cat <<'EOF'
feat: stepped wizard for New Game/Tournament setup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Stepped flow + dynamic step list → Task 1 (`wizardSteps`) + Task 4 (render switch).
- Scoring step only for 2+ players → Task 1 (`wizardSteps` omits `'scoring'`).
- `WizardProgress` / `WizardNav` → Tasks 2 & 3.
- `setupWizard.js` pure helpers → Task 1.
- Review step (Green Hero Recap) with editable name + tap-to-edit rows → Task 4 `renderReviewStep`.
- Next gating via `isStepValid` → Task 1 + Task 4 (`nextEnabled`).
- Step clamping on roster shrink → Task 4 (`useEffect` on `steps.length`).
- Back on step 0 exits → Task 4 (`handleBack`).
- Auto-naming preserved → Task 4 (`buildGameName` + `nameTouched` carried over; name field on Review hero sets `nameTouched`).
- Navigation round-trips preserved → Task 4 (`useFocusEffect` unchanged).
- Unit tests for helpers → Task 1.

**Placeholder scan:** No TBD/TODO; all steps contain full code or exact commands.

**Type consistency:** `wizardSteps`/`isStepValid` signatures match between Task 1 definition and Task 4 usage. Step keys (`players`, `course`, `rounds`, `scoring`, `review`) are consistent across `wizardSteps`, `isStepValid`, the render switch, and `goToStep`. `WizardProgress` props (`step`, `totalSteps`, `onBack`) and `WizardNav` props (`isFirstStep`, `isLastStep`, `nextEnabled`, `nextLabel`, `onBack`, `onNext`) match their definitions in Tasks 2/3 and call sites in Task 4.
