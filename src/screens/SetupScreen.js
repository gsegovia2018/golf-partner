import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { createTournament, saveTournament, randomPairs, DEFAULT_SETTINGS } from '../store/tournamentStore';
import { defaultHoles, fetchCourses, fetchPlayers } from '../store/libraryStore';
import { consumePendingPlayers, consumePendingCourses } from '../lib/selectionBridge';
import { useTheme } from '../theme/ThemeContext';

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
  const [rounds, setRounds] = useState([{ courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });

  const bestBallAllowed = !isGame || players.length === 4;
  const matchPlayAllowed = players.length === 2;

  useEffect(() => {
    if (!bestBallAllowed && settings.scoringMode === 'bestball') {
      setSettings((prev) => ({ ...prev, scoringMode: 'stableford' }));
    }
    if (!matchPlayAllowed && settings.scoringMode === 'matchplay') {
      setSettings((prev) => ({ ...prev, scoringMode: 'stableford' }));
    }
  }, [bestBallAllowed, matchPlayAllowed, settings.scoringMode]);

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
            next.push({ id: p.id, name: p.name, handicap: p.handicap });
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
              playerHandicaps: null,
            };
            if (idx < next.length) {
              next[idx] = { ...next[idx], ...roundData };
            } else {
              next.push({ ...roundData });
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

  const handleHolesSaved = useCallback((roundIndex, holes, slope, playerHandicaps, manualHandicaps) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes, slope, playerHandicaps,
        manualHandicaps: { ...(manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);

  function removePlayer(id) {
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
    setRounds((prev) => [...prev, { courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null, manualHandicaps: {} }]);
  }

  function removeRound(index) {
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleStart() {
    if (players.length < 1) {
      Alert.alert('Missing info', 'Select at least 1 player.');
      return;
    }
    if (rounds.some((r) => !r.courseName.trim())) {
      Alert.alert('Missing info', 'All course names are required.');
      return;
    }

    // Match play uses solo-pairs ([[p1], [p2]]) so the best-ball math treats
    // each player as their own "pair" and compares 1-vs-1 per hole.
    const isMatchPlay = settings.scoringMode === 'matchplay';
    const buildPairs = () => {
      if (isMatchPlay && players.length === 2) return [[players[0]], [players[1]]];
      return randomPairs(players);
    };

    const builtRounds = rounds.map((r, i) => {
      const playerHandicaps = r.playerHandicaps
        ?? Object.fromEntries(players.map((p) => [p.id, p.handicap]));
      return {
        id: `r${i}`,
        courseId: r.courseId ?? null,
        courseName: r.courseName.trim(),
        holes: r.holes,
        slope: r.slope ?? null,
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
      navigation.replace('Home');
    } catch (err) {
      const msg = err?.message ?? 'Could not create tournament';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isGame ? 'New Game' : 'New Tournament'}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.scrollView} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* Tournament Name */}
      <View>
        <Text style={s.label}>{isGame ? 'Game Name' : 'Tournament Name'}</Text>
        <TextInput
          style={s.input}
          value={tournamentName}
          onChangeText={(v) => { setTournamentName(v); setNameTouched(true); }}
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
        />
      </View>

      {/* Players */}
      <View>
        <Text style={s.sectionTitle}>Players ({players.length}/4 max)</Text>
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
      </View>

      {/* Rounds */}
      <View>
        <Text style={s.sectionTitle}>{isGame ? 'Course' : 'Rounds'}</Text>
        {rounds.map((r, i) => {
          const totalPar = r.holes.reduce((sum, h) => sum + h.par, 0);
          return (
            <View key={i} style={s.courseBlock}>
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
              {r.courseName ? (
                <>
                  <TextInput
                    style={s.input}
                    placeholder="Override course name"
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
                        initialPlayerHandicaps: r.playerHandicaps,
                        initialManualHandicaps: r.manualHandicaps ?? {},
                        courseId: r.courseId ?? null,
                      })
                    }
                  >
                    <Feather name="settings" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
                    <Text style={s.editHolesBtnText}>
                      Configure Holes  {'\u00B7'}  Par {totalPar}
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
      </View>

      {/* Scoring */}
      {players.length >= 2 && (
        <View>
          <Text style={s.sectionTitle}>Scoring</Text>
          <View style={s.modeRow}>
            {(() => {
              // Mode options depend on player count: 2 players get Stableford +
              // Match Play; 3 players get only Stableford; 4 players get
              // Stableford + Best Ball.
              const availableModes = matchPlayAllowed
                ? ['stableford', 'matchplay']
                : ['stableford', 'bestball'];
              return availableModes.map((mode) => {
                const disabled = mode === 'bestball' && !bestBallAllowed;
                const label = mode === 'stableford' ? 'Individual Stableford'
                  : mode === 'matchplay' ? 'Match Play'
                  : 'Best Ball / Worst Ball';
                return (
                  <TouchableOpacity
                    key={mode}
                    style={[s.modeBtn, settings.scoringMode === mode && s.modeBtnActive, disabled && { opacity: 0.5 }]}
                    onPress={() => { if (!disabled) setSettings((prev) => ({ ...prev, scoringMode: mode })); }}
                    activeOpacity={disabled ? 1 : 0.7}
                  >
                    <Text style={[s.modeBtnText, settings.scoringMode === mode && s.modeBtnTextActive]}>
                      {label}
                    </Text>
                    {disabled && (
                      <Text style={[s.modeBtnText, { fontSize: 11, marginTop: 4, color: theme.text.muted }]}>
                        Requires 4 players
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              });
            })()}
          </View>
          {settings.scoringMode === 'bestball' && (
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
                  onChangeText={(v) => setSettings((prev) => ({ ...prev, bestBallValue: v }))}
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
                  onChangeText={(v) => setSettings((prev) => ({ ...prev, worstBallValue: v }))}
                />
                <Text style={s.valueSuffix}>pts / hole</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Start Button */}
      <View>
        <TouchableOpacity style={s.primaryBtn} onPress={handleStart}>
          <Feather name="play" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
          <Text style={s.primaryBtnText}>{isGame ? 'Start Game' : 'Start Tournament'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </SafeAreaView>
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
      paddingBottom: 100,
    },

    /* Header */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 18,
      color: theme.text.primary,
      letterSpacing: -0.3,
    },

    /* Labels & Sections */
    label: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      marginBottom: 8,
      fontSize: 13,
      letterSpacing: 0.3,
    },
    sectionTitle: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 11,
      marginTop: 24,
      marginBottom: 12,
      letterSpacing: 1.8,
      textTransform: 'uppercase',
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
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.secondary,
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
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.light,
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
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.light,
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

    /* Scoring Mode Tabs */
    modeRow: {
      gap: 8,
    },
    modeBtn: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 14,
      alignItems: 'center',
      marginBottom: 6,
    },
    modeBtnActive: {
      backgroundColor: theme.accent.primary,
      borderColor: theme.accent.primary,
    },
    modeBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      fontSize: 14,
    },
    modeBtnTextActive: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.inverse,
    },

    /* Value Inputs (Best/Worst ball) */
    valueRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 10,
    },
    valueBlock: {
      flex: 1,
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      padding: 16,
      alignItems: 'center',
      gap: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    valueLabel: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.accent.primary,
      fontSize: 12,
      letterSpacing: 0.5,
    },
    valueInput: {
      backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.secondary,
      color: theme.text.primary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border.default,
      width: 56,
      textAlign: 'center',
      fontSize: 22,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      padding: 8,
    },
    valueSuffix: {
      fontFamily: 'PlusJakartaSans-Regular',
      color: theme.text.muted,
      fontSize: 11,
    },

    /* Primary Button */
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
      borderRadius: 14,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
      padding: 18,
      marginTop: 24,
      ...(theme.isDark ? {} : theme.shadow.accent),
    },
    primaryBtnText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.isDark ? theme.accent.primary : theme.text.inverse,
      fontSize: 16,
    },
  });
}
