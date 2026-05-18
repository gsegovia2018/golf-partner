import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform, Switch,
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
import { createOfficialTournament, addRosterPlayer, createRound } from '../store/officialAdmin';

// Official tournament round formats — distinct value set from ScoringModePicker.
const OFFICIAL_FORMATS = [
  { value: 'gross_net', label: 'Stroke play (gross & net)' },
  { value: 'stableford', label: 'Stableford' },
  { value: 'pairs', label: 'Pairs (Best Ball / Sindicato)' },
  { value: 'match', label: 'Match play' },
];

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

// Project a wizard round down to just the course data an official round needs.
// The casual round object also carries a transient client id and casual
// scoring fields, which must not leak into tournament_rounds.course.
function officialCourseFor(round) {
  return {
    name: round?.courseName ?? '',
    holes: round?.holes ?? [],
    slope: round?.slope ?? null,
    courseRating: round?.courseRating ?? null,
  };
}

// Stable id for a roster entry so React keys survive add / remove.
let _rosterIdSeq = 0;
function newRosterId() { return `roster-${Date.now()}-${_rosterIdSeq++}`; }

export default function SetupScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const routeKind = route?.params?.kind;
  // The game flow stays game; everything else is the tournament flow. Official
  // is no longer a route kind — it is an in-wizard toggle on step 1. The legacy
  // kind:'official' route param simply pre-toggles it for backward compat.
  const baseKind = routeKind === 'game' ? 'game' : 'tournament';
  const [official, setOfficial] = useState(routeKind === 'official');
  const isOfficial = baseKind === 'tournament' && official;
  const kind = isOfficial ? 'official' : baseKind;
  const isGame = kind === 'game';

  const [tournamentName, setTournamentName] = useState(() =>
    isGame ? buildGameName('') : 'Weekend Golf',
  );
  const [nameTouched, setNameTouched] = useState(false);
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([{ id: newRoundId(), courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [rawStep, setStep] = useState(0);

  // Official-mode-only state. roster: [{ id, displayName, handicap }].
  const [roster, setRoster] = useState([]);
  const [officialFormat, setOfficialFormat] = useState('stableford');
  const [rosterName, setRosterName] = useState('');
  const [rosterHcp, setRosterHcp] = useState('');
  const [busy, setBusy] = useState(false);

  // The active step list depends on kind + roster size (Scoring only exists
  // for 2+ players). When the roster shrinks the Scoring step away the array
  // gets shorter, so the active index is clamped synchronously here — not via
  // an effect, which would leave a one-render window where the index points
  // past the array and stepKey wrongly resolves to 'review'. stepKey is the
  // key of the currently displayed step.
  const steps = useMemo(() => wizardSteps(kind, players.length), [kind, players.length]);
  const step = Math.max(0, Math.min(rawStep, steps.length - 1));
  const stepKey = steps[step];

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
  // Official rounds, like casual tournament rounds, require a course per
  // round — the shared rounds-step gate (isStepValid) enforces that before
  // Review is reachable. canStart here only adds the official-specific
  // requirement of a non-empty roster; the course check already happened.
  const canStart = isOfficial
    ? roster.length > 0
    : (players.length >= 1 && !missingCourseName);

  async function handleStart() {
    if (isOfficial) {
      if (busy) return;
      setBusy(true);
      let tournamentId = null;
      try {
        tournamentId = await createOfficialTournament({
          name: tournamentName.trim() || 'Weekend Golf',
        });
        for (const entry of roster) {
          await addRosterPlayer(tournamentId, {
            displayName: entry.displayName,
            handicap: entry.handicap,
          });
        }
        for (let i = 0; i < rounds.length; i++) {
          await createRound(tournamentId, {
            roundIndex: i,
            course: officialCourseFor(rounds[i]),
            format: officialFormat,
          });
        }
        navigation.navigate('OfficialSetup', { tournamentId });
      } catch (err) {
        if (tournamentId) {
          // The tournament row exists but roster/rounds setup did not fully
          // finish. Send the admin to the management screen to complete it —
          // never leave them on Review where a retry would create a duplicate
          // tournament.
          const msg = 'Tournament created, but some setup did not finish. You can complete the roster and rounds on the next screen.';
          if (Platform.OS === 'web') window.alert(msg);
          else Alert.alert('Setup incomplete', msg);
          navigation.navigate('OfficialSetup', { tournamentId });
        } else {
          const msg = "Couldn't create the tournament. Please try again.";
          if (Platform.OS === 'web') window.alert(msg);
          else Alert.alert('Error', msg);
        }
      } finally {
        setBusy(false);
      }
      return;
    }

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
  const nextEnabled = isStepValid(stepKey, { players, rounds, roster })
    && (!isLastStep || canStart)
    && !busy;
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
    // For a solo game there is no scoring choice — show a neutral label
    // rather than whatever mode happens to be left in settings.
    // Official tournaments use their own format step instead of scoring.
    const scoringLabel = isOfficial
      ? (OFFICIAL_FORMATS.find((f) => f.value === officialFormat)?.label ?? 'Stableford')
      : hasScoringStep
        ? (getScoringMode(settings.scoringMode)?.label ?? 'Solo play')
        : 'Solo play';
    const rosterCount = isOfficial ? roster.length : players.length;
    const playerSummary = isOfficial
      ? `${roster.length} golfer${roster.length === 1 ? '' : 's'}`
      : players.length === 1
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
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor="#ffffff"
          />
          <View style={s.reviewChipRow}>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>
                {rosterCount} player{rosterCount === 1 ? '' : 's'}
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
            onPress={() => goToStep(isOfficial ? 'roster' : 'players')}
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
            onPress={() => goToStep(isOfficial ? 'format' : 'scoring')}
            disabled={!hasScoringStep && !isOfficial}
          >
            <Feather name="target" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>{isOfficial ? 'Format' : 'Scoring'}</Text>
              <Text style={s.reviewRowSub}>{scoringLabel}</Text>
            </View>
            {(hasScoringStep || isOfficial) && (
              <Feather name="chevron-right" size={18} color={theme.accent.primary} />
            )}
          </TouchableOpacity>
        </View>

        {!canStart && (
          <Text style={s.errorText}>
            {isOfficial
              ? 'Add at least 1 player to continue.'
              : players.length < 1
                ? 'Add at least 1 player to continue.'
                : 'Pick a course for every round to continue.'}
          </Text>
        )}
      </>
    );
  };

  const handleAddRosterEntry = () => {
    const name = rosterName.trim();
    if (!name) return;
    setRoster((prev) => [...prev, { id: newRosterId(), displayName: name, handicap: Number(rosterHcp) || 0 }]);
    setRosterName('');
    setRosterHcp('');
  };

  const renderRosterStep = () => (
    <>
      <Text style={s.stepOverline}>ROSTER</Text>
      <Text style={s.stepPrompt}>Who's competing?</Text>
      <Text style={s.stepSubtitle}>Add every player in the official tournament.</Text>
      {roster.length === 0 && (
        <View style={s.emptyHint}>
          <Feather name="users" size={16} color={theme.text.muted} style={{ marginRight: 8 }} />
          <Text style={s.emptyHintText}>Add at least 1 player to continue.</Text>
        </View>
      )}
      {roster.map((entry, i) => (
        <View key={entry.id ?? `roster-${i}`} style={s.playerCard}>
          <View style={s.playerInfo}>
            <Text style={s.playerName}>{entry.displayName}</Text>
            <Text style={s.playerHcp}>HCP {entry.handicap}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setRoster((prev) => prev.filter((_, idx) => idx !== i))}
            style={s.removeBtn}
          >
            <Feather name="x" size={16} color={theme.destructive} />
          </TouchableOpacity>
        </View>
      ))}
      <View style={s.rosterAddForm}>
        <TextInput
          style={[s.input, s.rosterNameInput]}
          placeholder="Player name"
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          value={rosterName}
          onChangeText={setRosterName}
        />
        <TextInput
          style={[s.input, s.rosterHcpInput]}
          placeholder="HCP"
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          keyboardType="numeric"
          value={rosterHcp}
          onChangeText={setRosterHcp}
        />
      </View>
      <TouchableOpacity style={s.pickBtn} onPress={handleAddRosterEntry}>
        <Feather name="plus" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
        <Text style={s.pickBtnText}>Add Player</Text>
      </TouchableOpacity>
    </>
  );

  const renderFormatStep = () => (
    <>
      <Text style={s.stepOverline}>FORMAT</Text>
      <Text style={s.stepPrompt}>How is it scored?</Text>
      <Text style={s.stepSubtitle}>Pick the official scoring format.</Text>
      {OFFICIAL_FORMATS.map((opt) => {
        const selected = officialFormat === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[s.formatRow, selected && s.formatRowSelected]}
            onPress={() => setOfficialFormat(opt.value)}
          >
            <Text style={[s.formatRowText, selected && s.formatRowTextSelected]}>
              {opt.label}
            </Text>
            {selected && <Feather name="check" size={18} color={theme.accent.primary} />}
          </TouchableOpacity>
        );
      })}
    </>
  );

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <WizardProgress step={step} totalSteps={steps.length} onBack={handleBack} />

      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && baseKind === 'tournament' && (
          <View style={s.officialToggleCard}>
            <View style={s.officialToggleRow}>
              <Text style={s.officialToggleLabel}>Official tournament</Text>
              <Switch
                value={official}
                onValueChange={setOfficial}
                trackColor={{ false: theme.border.default, true: theme.accent.primary }}
                thumbColor="#ffffff"
              />
            </View>
            <Text style={s.officialToggleCaption}>
              Players join by invite link; scores are double-entered and verified.
            </Text>
          </View>
        )}
        {stepKey === 'players' && renderPlayersStep()}
        {stepKey === 'roster' && renderRosterStep()}
        {(stepKey === 'course' || stepKey === 'rounds') && renderCourseStep()}
        {stepKey === 'format' && renderFormatStep()}
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

    /* Official tournament toggle (tournament flow, step 1 only) */
    officialToggleCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      marginBottom: 18,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    officialToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    officialToggleLabel: {
      flex: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
      fontSize: 15,
    },
    officialToggleCaption: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      marginTop: 6,
    },

    /* Roster add form (official) */
    rosterAddForm: {
      flexDirection: 'row',
      gap: 8,
    },
    rosterNameInput: {
      flex: 1,
    },
    rosterHcpInput: {
      width: 80,
      textAlign: 'center',
    },

    /* Format option rows (official) */
    formatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.bg.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      marginBottom: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    formatRowSelected: {
      borderColor: theme.accent.primary,
      backgroundColor: theme.accent.light,
    },
    formatRowText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.primary,
      fontSize: 15,
    },
    formatRowTextSelected: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
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
