import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadAllTournamentsWithFallback, isTournamentFinished, setActiveTournament,
  subscribeTournamentChanges,
} from '../store/tournamentStore';
import { loadProfile, computePersonalStats } from '../store/profileStore';

// History tab: a snapshot of the user's all-time stats followed by their
// archive of finished games and tournaments.
export default function HistoryScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [finished, setFinished] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { list } = await loadAllTournamentsWithFallback();
      setFinished(
        list.filter((t) => isTournamentFinished(t)).sort((a, b) => b.id - a.id),
      );
      try {
        const profile = await loadProfile();
        if (profile?.userId || profile?.displayName) {
          setStats(await computePersonalStats({
            userId: profile?.userId,
            displayName: profile?.displayName,
          }));
        }
      } catch { /* stats are best-effort */ }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    reload();
    const unsub = subscribeTournamentChanges(() => { if (!cancelled) reload(); });
    return () => { cancelled = true; unsub(); };
  }, [reload]));

  async function openTournament(id) {
    await setActiveTournament(id);
    navigation.navigate('Tournament');
  }

  const renderCard = (t) => {
    const players = t.players ?? [];
    const rounds = t.rounds ?? [];
    const isGameKind = t.kind === 'game';
    const metaText = players.length > 0
      ? players.map((p) => p.name.split(' ')[0]).join(' · ')
      : '';
    return (
      <TouchableOpacity
        key={t.id}
        style={s.card}
        onPress={() => openTournament(t.id)}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.cardName}>{t.name}</Text>
          {metaText ? <Text style={s.cardMeta}>{metaText}</Text> : null}
          <Text style={s.cardRound}>
            {isGameKind
              ? (rounds[0]?.courseName || 'Single round')
              : `${rounds.length} rounds`}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.text.muted} />
      </TouchableOpacity>
    );
  };

  const games = finished.filter((t) => t.kind === 'game');
  const tournaments = finished.filter((t) => t.kind !== 'game');

  const statCells = stats ? [
    { label: 'Tournaments', value: stats.tournamentsPlayed },
    { label: 'Rounds', value: stats.roundsPlayed },
    { label: 'Wins', value: stats.wins },
    {
      label: 'Avg / round',
      value: stats.roundsPlayed > 0 ? stats.avgPointsPerRound.toFixed(1) : '—',
    },
    { label: 'Total pts', value: stats.totalPoints },
    {
      label: 'Best round',
      value: stats.bestRound ? `${stats.bestRound.points}` : '—',
    },
  ] : [];

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>History</Text>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {stats && stats.roundsPlayed > 0 && (
            <>
              <Text style={s.sectionLabel}>YOUR RECORD</Text>
              <View style={s.statsGrid}>
                {statCells.map((c) => (
                  <View key={c.label} style={s.statCell}>
                    <Text style={s.statValue}>{c.value}</Text>
                    <Text style={s.statLabel}>{c.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {finished.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="clock" size={46} color={theme.text.muted} />
              <Text style={s.emptyTitle}>No history yet</Text>
              <Text style={s.emptySub}>
                Finished games and tournaments will be archived here.
              </Text>
            </View>
          ) : (
            <>
              {tournaments.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>TOURNAMENTS</Text>
                  {tournaments.map(renderCard)}
                </>
              )}
              {games.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>GAMES</Text>
                  {games.map(renderCard)}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
    headerTitle: {
      fontFamily: 'PlayfairDisplay-Black', fontSize: 26, color: theme.text.primary,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.5, marginTop: 18, marginBottom: 12, textTransform: 'uppercase',
    },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    statCell: {
      flexGrow: 1, flexBasis: '30%',
      backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    statValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: theme.text.primary },
    statLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.text.muted,
      marginTop: 4, letterSpacing: 0.8, textTransform: 'uppercase',
    },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 18,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
      padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardName: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 16 },
    cardMeta: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
      fontSize: 12, marginTop: 4,
    },
    cardRound: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11, marginTop: 2,
    },
    emptyState: { alignItems: 'center', paddingVertical: 80, gap: 12 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    emptySub: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 40,
    },
  });
}
