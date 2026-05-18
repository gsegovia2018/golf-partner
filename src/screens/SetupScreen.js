import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image,
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
  const [rounds, setRounds] = useState([{ id: newRoundId(), courseName: '', holes: defaultHoles(), tees: [], playerHandicaps: null, playerTees: null }]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [rawStep, setStep] = useState(0);
  // Which round's course name is being edited inline (null = none).
  const [renamingIndex, setRenamingIndex] = useState(null);

  // The active step list depends on kind + player count (Scoring only exists
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
              // library's in-memory objects.
              holes: course.holes.map((h) => ({ ...h })),
              tees: (course.tees ?? []).map((t) => ({ ...t })),
              playerHandicaps: null,
              playerTees: null,
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

  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes: patch.holes,
        tees: patch.tees,
        playerHandicaps: patch.playerHandicaps,
        playerTees: patch.playerTees,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
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
    setRounds((prev) => [...prev, { id: newRoundId(), courseName: '', holes: defaultHoles(), tees: [], playerHandicaps: null, playerTees: null, manualHandicaps: {} }]);
  }

  async function removeRound(index) {
    const round = rounds[index];
    // Setup-stage rounds carry no entered scores yet, but a course may have
    // been configured — still confirm so a stray tap doesn't wipe holes/tees.
    const hasCourse = !!(round?.courseName || '').trim();
    const ok = await confirmDialog(
      'Remove round',
      hasCourse
        ? `Round ${index + 1} (${round.courseName}) and its hole setup will be removed.`
        : `Remove Round ${index + 1}?`,
    );
    if (!ok) return;
    setRounds((prev) => prev.filter((_, i) => i !== index));
    setRenamingIndex(null);
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
      // holes / tees here, so deriveRoundPlayingHandicap yields the real
      // playing handicap rather than the raw index.
      const playerHandicaps = r.playerHandicaps
        ?? Object.fromEntries(players.map((p) => [p.id, deriveRoundPlayingHandicap(p.handicap, r)]));
      return {
        id: `r${i}`,
        courseId: r.courseId ?? null,
        courseName: r.courseName.trim(),
        holes: r.holes,
        tees: r.tees ?? [],
        playerHandicaps,
        playerTees: r.playerTees ?? null,
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
      // saveTournament marks the new tournament active. A game is a single
      // round — jump straight to its scorecard. A multi-round tournament
      // lands on the Tournament view instead of bouncing back to the Home list.
      if (isGame) navigation.replace('Scorecard', { roundIndex: 0 });
      else navigation.replace('Tournament');
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
                    <Text style={s.courseStatValue}>{r.tees?.length ?? 0}</Text>
                    <Text style={s.courseStatLabel}>TEES</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={s.courseConfigRow}
                  onPress={() =>
                    navigation.navigate('CourseEditor', {
                      roundIndex: i,
                      courseName: r.courseName || `Round ${i + 1}`,
                      initialHoles: r.holes,
                      initialTees: r.tees ?? [],
                      initialPlayerHandicaps: r.playerHandicaps,
                      initialManualHandicaps: r.manualHandicaps ?? {},
                      initialPlayerTees: r.playerTees ?? {},
                      players: players,
                      onSave: handleHolesSaved,
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
    const scoringLabel = hasScoringStep
      ? (getScoringMode(settings.scoringMode)?.label ?? 'Solo play')
      : 'Solo play';
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
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
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

    /* Players slot grid */
    slotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    slotFilled: {
      position: 'relative',
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

    /* Empty / error states */
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
