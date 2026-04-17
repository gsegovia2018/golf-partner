import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert,
} from 'react-native';

import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { createTournament, saveTournament, randomPairs, DEFAULT_SETTINGS } from '../store/tournamentStore';
import { defaultHoles } from '../store/libraryStore';
import { consumePendingPlayers, consumePendingCourses } from '../lib/selectionBridge';
import { useTheme } from '../theme/ThemeContext';

export default function SetupScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [tournamentName, setTournamentName] = useState('Weekend Golf');
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState([{ courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });

  useFocusEffect(useCallback(() => {
    const picked = consumePendingPlayers();
    if (picked && picked.length > 0) {
      setPlayers((prev) => {
        const next = [...prev];
        for (const p of picked) {
          if (next.length >= 4 || next.find((x) => x.id === p.id)) continue;
          next.push({ id: p.id, name: p.name, handicap: p.handicap });
        }
        return next;
      });
    }
    const pc = consumePendingCourses();
    if (pc && pc.courses.length > 0) {
      const { startRoundIndex, courses } = pc;
      setRounds((prev) => {
        const next = [...prev];
        courses.forEach((course, i) => {
          const idx = startRoundIndex + i;
          const roundData = {
            courseId: course.id,
            courseName: course.name,
            holes: course.holes,
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
    }
  }, []));

  const handleHolesSaved = useCallback((roundIndex, holes, slope, playerHandicaps) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = { ...next[roundIndex], holes, slope, playerHandicaps };
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
  }

  function addRound() {
    setRounds((prev) => [...prev, { courseName: '', holes: defaultHoles(), slope: null, playerHandicaps: null }]);
  }

  function removeRound(index) {
    setRounds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleStart() {
    if (players.length !== 4) {
      Alert.alert('Missing info', 'Select exactly 4 players.');
      return;
    }
    if (rounds.some((r) => !r.courseName.trim())) {
      Alert.alert('Missing info', 'All course names are required.');
      return;
    }

    const builtRounds = rounds.map((r, i) => {
      const playerHandicaps = r.playerHandicaps
        ?? Object.fromEntries(players.map((p) => [p.id, p.handicap]));
      return {
        id: `r${i}`,
        courseName: r.courseName.trim(),
        holes: r.holes,
        slope: r.slope ?? null,
        playerHandicaps,
        notes: '',
        pairs: randomPairs(players),
        scores: {},
      };
    });

    const tournament = createTournament({
      name: tournamentName.trim() || 'Weekend Golf',
      players,
      rounds: builtRounds,
      settings: {
        ...settings,
        bestBallValue: parseInt(settings.bestBallValue, 10) || 1,
        worstBallValue: parseInt(settings.worstBallValue, 10) || 1,
      },
    });

    await saveTournament(tournament);
    navigation.replace('Home');
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>New Tournament</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Tournament Name */}
      <View>
        <Text style={s.label}>Tournament Name</Text>
        <TextInput
          style={s.input}
          value={tournamentName}
          onChangeText={setTournamentName}
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
        />
      </View>

      {/* Players */}
      <View>
        <Text style={s.sectionTitle}>Players ({players.length}/4)</Text>
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
        <Text style={s.sectionTitle}>Rounds</Text>
        {rounds.map((r, i) => {
          const totalPar = r.holes.reduce((sum, h) => sum + h.par, 0);
          return (
            <View key={i} style={s.courseBlock}>
              <View style={s.roundHeader}>
                <Text style={s.roundLabel}>Round {i + 1}</Text>
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

        <TouchableOpacity style={s.addRoundBtn} onPress={addRound}>
          <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
          <Text style={s.addRoundBtnText}>Add Round</Text>
        </TouchableOpacity>
      </View>

      {/* Scoring */}
      <View>
        <Text style={s.sectionTitle}>Scoring</Text>
        <View style={s.modeRow}>
          {['stableford', 'bestball'].map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[s.modeBtn, settings.scoringMode === mode && s.modeBtnActive]}
              onPress={() => setSettings((prev) => ({ ...prev, scoringMode: mode }))}
            >
              <Text style={[s.modeBtnText, settings.scoringMode === mode && s.modeBtnTextActive]}>
                {mode === 'stableford' ? 'Individual Stableford' : 'Best Ball / Worst Ball'}
              </Text>
            </TouchableOpacity>
          ))}
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

      {/* Start Button */}
      <View>
        <TouchableOpacity style={s.primaryBtn} onPress={handleStart}>
          <Feather name="play" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} style={{ marginRight: 8 }} />
          <Text style={s.primaryBtnText}>Start Tournament</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bg.primary,
      overflow: 'hidden',
    },
    content: {
      padding: 20,
      paddingTop: 16,
      paddingBottom: 100,
    },

    /* Header */
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 24,
      paddingTop: 4,
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
      fontFamily: 'PlusJakartaSans-Bold',
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
