import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import ScreenContainer from '../components/ScreenContainer';
import WizardProgress from '../components/setup/WizardProgress';
import WizardNav from '../components/setup/WizardNav';
import { wizardSteps, isStepValid } from './setupWizard';
import { useTheme } from '../theme/ThemeContext';
import { defaultHoles } from '../store/libraryStore';
import { consumePendingCourses } from '../lib/selectionBridge';
import { applyCoursePick, applyLayoutChoice } from '../lib/roundCourse';
import RoundLayoutSelect from '../components/RoundLayoutSelect';
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
function newRoundId() { return `official-r${Date.now()}-${_roundIdSeq++}`; }

// Stable id for a roster entry so React keys survive add / remove.
let _rosterIdSeq = 0;
function newRosterId() { return `roster-${Date.now()}-${_rosterIdSeq++}`; }

function showError(message) {
  const msg = message || 'Something went wrong';
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert('Error', msg);
}

// Project a wizard round down to just the course data an official round needs.
// The wizard round object also carries a transient client id, which must not
// leak into tournament_rounds.course.
function officialCourseFor(round) {
  return {
    name: round?.courseName ?? '',
    holes: round?.holes ?? [],
    slope: round?.slope ?? null,
    courseRating: round?.courseRating ?? null,
  };
}

export default function OfficialCreateScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // Guards async handlers from calling setState after the screen unmounts.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Steps are fixed for the official flow: roster → rounds → format → review.
  const steps = useMemo(() => wizardSteps('official', 0), []);

  const [tournamentName, setTournamentName] = useState('Weekend Golf');
  // roster: [{ id, displayName, handicap }].
  const [roster, setRoster] = useState([]);
  // rounds use the same shape SetupScreen's rounds state uses so the course
  // picker round-trip can be reused verbatim.
  const [rounds, setRounds] = useState([
    { id: newRoundId(), courseName: '', holes: defaultHoles(), slope: null, courseRating: null },
  ]);
  const [officialFormat, setOfficialFormat] = useState('stableford');
  const [rawStep, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Add-player sub-form.
  const [rosterName, setRosterName] = useState('');
  const [rosterHcp, setRosterHcp] = useState('');

  const step = Math.max(0, Math.min(rawStep, steps.length - 1));
  const stepKey = steps[step];

  // Course-selection round-trip: CoursePicker is pushed on top of this screen,
  // so the screen stays mounted and `step` survives. On regaining focus we
  // consume whatever the picker stashed in the selection bridge.
  useFocusEffect(useCallback(() => {
    let cancelled = false;

    const pc = consumePendingCourses();
    if (pc && pc.picks && pc.picks.length > 0) {
      const { startRoundIndex, picks } = pc;
      setRounds((prev) => {
        const next = [...prev];
        picks.forEach((pick, i) => {
          const idx = startRoundIndex + i;
          const base = idx < next.length ? next[idx] : { id: newRoundId() };
          const applied = applyCoursePick(base, pick);
          if (idx < next.length) next[idx] = applied;
          else next.push(applied);
        });
        return next;
      });
    }

    return () => { cancelled = true; };
  }, []));

  // ---- Roster -------------------------------------------------------------

  function handleAddRosterEntry() {
    const name = rosterName.trim();
    if (!name) return;
    setRoster((prev) => [
      ...prev,
      { id: newRosterId(), displayName: name, handicap: Number(rosterHcp) || 0 },
    ]);
    setRosterName('');
    setRosterHcp('');
  }

  function removeRosterEntry(id) {
    setRoster((prev) => prev.filter((r) => r.id !== id));
  }

  // ---- Rounds -------------------------------------------------------------

  function addRound() {
    setRounds((prev) => [
      ...prev,
      { id: newRoundId(), courseName: '', holes: defaultHoles(), slope: null, courseRating: null },
    ]);
  }

  function removeRound(index) {
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  // Resolve a club-picked round to one of the club's layouts.
  const chooseLayout = useCallback((roundIndex, layoutCourse) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = applyLayoutChoice(next[roundIndex], layoutCourse);
      return next;
    });
  }, []);

  // ---- Create -------------------------------------------------------------

  async function handleCreate() {
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
    } catch (e) {
      if (tournamentId) {
        // The tournament row exists but roster/rounds setup did not fully
        // finish. Send the admin to the management screen to complete it —
        // never leave them on Review where a retry creates a duplicate.
        showError('Tournament created, but some setup did not finish. Complete it on the next screen.');
        navigation.navigate('OfficialSetup', { tournamentId });
      } else {
        showError("Couldn't create the tournament. Please try again.");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  // ---- Wizard navigation --------------------------------------------------

  function handleBack() {
    if (step === 0) navigation.goBack();
    else setStep((p) => p - 1);
  }

  function handleNext() {
    if (stepKey === 'review') handleCreate();
    else setStep((p) => Math.min(p + 1, steps.length - 1));
  }

  function goToStep(key) {
    const idx = steps.indexOf(key);
    if (idx >= 0) setStep(idx);
  }

  const isLastStep = stepKey === 'review';
  const canCreate = roster.length > 0
    && rounds.every((r) => (r.courseName || '').trim().length > 0);
  const nextEnabled = isStepValid(stepKey, { roster, rounds })
    && (!isLastStep || canCreate)
    && !busy;
  const nextLabel = isLastStep ? 'Create Tournament' : 'Next';

  // ---- Step bodies --------------------------------------------------------

  const renderRosterStep = () => (
    <>
      <Text style={s.stepOverline}>ROSTER</Text>
      <Text style={s.stepPrompt}>Who's competing?</Text>
      <Text style={s.stepSubtitle}>Add every player in the official tournament.</Text>

      <TextInput
        style={s.input}
        placeholder="Tournament name"
        placeholderTextColor={theme.text.muted}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        value={tournamentName}
        onChangeText={setTournamentName}
      />

      {roster.length === 0 && (
        <View style={s.emptyHint}>
          <Feather name="users" size={16} color={theme.text.muted} style={{ marginRight: 8 }} />
          <Text style={s.emptyHintText}>Add at least 1 player to continue.</Text>
        </View>
      )}
      {roster.map((entry) => (
        <View key={entry.id} style={s.playerCard}>
          <View style={s.playerInfo}>
            <Text style={s.playerName}>{entry.displayName}</Text>
            <Text style={s.playerHcp}>HCP {entry.handicap}</Text>
          </View>
          <TouchableOpacity onPress={() => removeRosterEntry(entry.id)} style={s.removeBtn}>
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

  const renderRoundsStep = () => (
    <>
      <Text style={s.stepOverline}>ROUNDS</Text>
      <Text style={s.stepPrompt}>Where are you playing?</Text>
      <Text style={s.stepSubtitle}>Add each round and pick its course.</Text>
      {rounds.map((r, i) => {
        const missingName = !(r.courseName || '').trim();
        return (
          <View key={r.id ?? `round-${i}`} style={s.courseBlock}>
            <View style={s.roundHeader}>
              <Text style={s.roundLabel}>Round {i + 1}</Text>
              {rounds.length > 1 && (
                <TouchableOpacity onPress={() => removeRound(i)} style={s.removeRoundBtn}>
                  <Feather name="trash-2" size={14} color={theme.destructive} />
                  <Text style={s.removeRoundText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
            {r.club && !(r.courseName || '').trim() ? (
              <View style={s.layoutCard}>
                <RoundLayoutSelect
                  club={r.club}
                  layouts={r.clubLayouts || []}
                  value={r.layoutId ?? null}
                  onChange={(layoutCourse) => chooseLayout(i, layoutCourse)}
                  onChangeClub={() => navigation.navigate('CoursePicker', { roundIndex: i })}
                />
              </View>
            ) : (
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
                  {r.courseName ? `Course: ${r.courseName}` : 'Pick a Club or Course'}
                </Text>
              </TouchableOpacity>
            )}
            {missingName && !r.club && (
              <Text style={s.errorText}>{`Round ${i + 1} needs a course.`}</Text>
            )}
          </View>
        );
      })}
      <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
        <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
        <Text style={s.addRoundBtnText}>Add Round</Text>
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

  const renderReviewStep = () => {
    const formatLabel = OFFICIAL_FORMATS.find((f) => f.value === officialFormat)?.label ?? 'Stableford';
    return (
      <>
        {/* Green hero recap */}
        <View style={s.reviewHero}>
          <Text style={s.reviewHeroOverline}>REVIEW & CONFIRM</Text>
          <TextInput
            style={s.reviewNameInput}
            value={tournamentName}
            onChangeText={setTournamentName}
            placeholder="Tournament name"
            placeholderTextColor="rgba(255,255,255,0.5)"
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor="#ffffff"
          />
          <View style={s.reviewChipRow}>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>
                {roster.length} player{roster.length === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={s.reviewChip}>
              <Text style={s.reviewChipText}>{formatLabel}</Text>
            </View>
          </View>
        </View>

        <Text style={s.stepOverline}>TAP TO EDIT</Text>
        <View style={s.reviewList}>
          <TouchableOpacity
            style={[s.reviewRow, s.reviewRowDivider]}
            onPress={() => goToStep('roster')}
          >
            <Feather name="users" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>Players</Text>
              <Text style={s.reviewRowSub}>
                {roster.length} golfer{roster.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.reviewRow, s.reviewRowDivider]}
            onPress={() => goToStep('rounds')}
          >
            <Feather name="map-pin" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>Rounds</Text>
              <Text style={s.reviewRowSub}>
                {rounds.length} round{rounds.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={s.reviewRow} onPress={() => goToStep('format')}>
            <Feather name="target" size={16} color={theme.accent.primary} style={s.reviewRowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.reviewRowTitle}>Format</Text>
              <Text style={s.reviewRowSub}>{formatLabel}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>

        {!canCreate && (
          <Text style={s.errorText}>
            {roster.length === 0
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
        {stepKey === 'roster' && renderRosterStep()}
        {stepKey === 'rounds' && renderRoundsStep()}
        {stepKey === 'format' && renderFormatStep()}
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

    /* Player cards */
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

    /* Pick / dashed buttons */
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
    layoutCard: {
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderRadius: 14,
      padding: 14,
      marginBottom: 8,
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

    /* Add round */
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

    /* Roster add form */
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

    /* Format option rows */
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
