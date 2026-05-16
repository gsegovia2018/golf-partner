import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { useTheme } from '../theme/ThemeContext';
import {
  loadAllTournamentsWithFallback, isTournamentFinished,
  setActiveTournament, deleteTournament, subscribeTournamentChanges,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';

export default function FinishedScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [finished, setFinished] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { list } = await loadAllTournamentsWithFallback();
    // Sort newest-finished first. `finishedAt` is an ms epoch (or ISO string);
    // fall back to id when a tournament became finished implicitly (every
    // round complete) and so has no explicit finishedAt timestamp.
    const finishedAtValue = (t) => {
      const v = t.finishedAt;
      if (v == null) return 0;
      const n = typeof v === 'number' ? v : Date.parse(v);
      return Number.isFinite(n) ? n : 0;
    };
    setFinished(
      list
        .filter((t) => isTournamentFinished(t))
        .sort((a, b) => {
          const diff = finishedAtValue(b) - finishedAtValue(a);
          if (diff !== 0) return diff;
          return b.id - a.id;
        }),
    );
    setLoading(false);
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

  async function reopen(t) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Reopen "${t.name}"? It will move back to your active list.`)
      : await new Promise((resolve) => Alert.alert(
          'Reopen',
          `Reopen "${t.name}"? It will move back to your active list.`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Reopen', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await mutate(t, { type: 'tournament.setFinished', finishedAt: null });
      await reload();
    } catch (err) {
      const msg = err?.message ?? 'Could not reopen';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  async function confirmDelete(t) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Delete "${t.name}"? This cannot be undone.`)
      : await new Promise((resolve) => Alert.alert(
          'Delete', `Delete "${t.name}"? This cannot be undone.`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Delete', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await deleteTournament(t.id);
      await reload();
    } catch (err) {
      const msg = err?.message ?? 'Could not delete';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    }
  }

  const renderCard = (t) => {
    const players = t.players ?? [];
    const rounds = t.rounds ?? [];
    const isGameKind = t.kind === 'game';
    const courseName = isGameKind ? (rounds[0]?.courseName ?? '') : null;
    const metaText = players.length > 0
      ? players.map((p) => p.name.split(' ')[0]).join(' · ')
      : '';
    return (
      <View key={t.id} style={s.cardWrapper}>
        <TouchableOpacity
          style={s.card}
          onPress={() => openTournament(t.id)}
          activeOpacity={0.7}
        >
          <View style={s.cardLeft}>
            <View style={s.cardHeader}>
              <Text style={s.cardName}>{t.name}</Text>
              <View style={s.statusBadge}>
                <Text style={s.statusBadgeText}>Finished</Text>
              </View>
            </View>
            {metaText ? <Text style={s.cardMeta}>{metaText}</Text> : null}
            {rounds.length > 0 && (
              <Text style={s.cardRound}>
                {isGameKind ? (courseName || 'Single round') : `${rounds.length} rounds`}
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
        <View style={s.cardActions}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => reopen(t)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="rotate-ccw" size={14} color={theme.accent.primary} />
          </TouchableOpacity>
          {t._role === 'owner' && (
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => confirmDelete(t)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="trash-2" size={14} color={theme.destructive} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const games = finished.filter((t) => t.kind === 'game');
  const tournaments = finished.filter((t) => t.kind !== 'game');

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Finished</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {!loading && finished.length === 0 && (
          <View style={s.emptyState}>
            <Feather name="archive" size={48} color={theme.text.muted} />
            <Text style={s.emptyTitle}>Nothing finished yet</Text>
            <Text style={s.emptySubtitle}>Completed games and tournaments will show up here.</Text>
          </View>
        )}
        {games.length > 0 && (
          <>
            <Text style={s.sectionLabel}>GAMES</Text>
            {games.map(renderCard)}
          </>
        )}
        {tournaments.length > 0 && (
          <>
            <Text style={s.sectionLabel}>TOURNAMENTS</Text>
            {tournaments.map(renderCard)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 10,
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary,
    },
    scroll: { flex: 1 },
    content: { padding: 20, paddingBottom: 100 },
    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted, fontSize: 10, letterSpacing: 1.5,
      marginBottom: 12, marginTop: 20, textTransform: 'uppercase',
    },
    cardWrapper: { position: 'relative', marginBottom: 10 },
    card: {
      backgroundColor: theme.bg.card,
      borderRadius: 20, borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
      padding: 16, flexDirection: 'row', alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardLeft: { flex: 1 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    cardName: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 16 },
    cardMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginBottom: 2 },
    cardRound: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11 },
    statusBadge: {
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
      backgroundColor: theme.bg.secondary,
    },
    statusBadgeText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 9, letterSpacing: 0.5,
      color: theme.text.muted, textTransform: 'uppercase',
    },
    cardActions: {
      position: 'absolute', right: 14, bottom: -8, flexDirection: 'row', gap: 6,
    },
    actionBtn: {
      width: 30, height: 30, borderRadius: 10,
      backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    emptyState: { alignItems: 'center', paddingVertical: 80, gap: 12 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    emptySubtitle: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 40,
    },
  });
}
