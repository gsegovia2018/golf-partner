import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
  Alert, Modal, Pressable,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import CardGrid from '../components/CardGrid';
import { useResponsive } from '../theme/responsive';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadAllTournamentsWithFallback, isTournamentFinished,
  subscribeTournamentChanges, deleteTournament,
} from '../store/tournamentStore';
import { loadProfile, computePersonalStats } from '../store/profileStore';

// History tab: a snapshot of the user's all-time stats followed by their
// archive of finished games and tournaments.
export default function HistoryScreen({ navigation }) {
  const { theme } = useTheme();
  const { gridColumns } = useResponsive();
  const s = useMemo(() => makeStyles(theme, gridColumns), [theme, gridColumns]);

  const [finished, setFinished] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);
  const confirm = useCallback(({ title, message, confirmLabel = 'Confirm', destructive = false }) => (
    new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ title, message, confirmLabel, destructive });
    })
  ), []);
  const resolveConfirm = useCallback((result) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(result);
  }, []);

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

  function openTournament(id) {
    navigation.navigate('Tournament', { tournamentId: id, viewMode: 'tournament' });
  }

  async function confirmDelete(t) {
    const confirmed = await confirm({
      title: 'Delete Tournament',
      message: `Delete "${t.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteTournament(t.id);
      await reload();
    } catch (err) {
      const msg = err?.message ?? 'Could not delete';
      Alert.alert('Error', msg);
    }
  }

  const renderCard = (t) => {
    const players = t.players ?? [];
    const rounds = t.rounds ?? [];
    const isGameKind = t.kind === 'game';
    const metaText = players.length > 0
      ? players.map((p) => p.name.split(' ')[0]).join(' · ')
      : '';
    return (
      <View key={t.id} style={s.cardWrapper}>
        <TouchableOpacity
          style={[s.card, t._role === 'owner' && s.cardWithDelete]}
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
        {t._role === 'owner' && (
          <TouchableOpacity
            style={s.deleteBtn}
            onPress={() => confirmDelete(t)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${t.name}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="trash-2" size={14} color={theme.destructive} />
          </TouchableOpacity>
        )}
      </View>
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
    <ScreenContainer style={s.container} edges={['top']}>
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
                  <CardGrid>{tournaments.map(renderCard)}</CardGrid>
                </>
              )}
              {games.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>GAMES</Text>
                  <CardGrid>{games.map(renderCard)}</CardGrid>
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
      <ConfirmModal state={confirmState} onResult={resolveConfirm} theme={theme} s={s} />
    </ScreenContainer>
  );
}

function ConfirmModal({ state, onResult, s }) {
  return (
    <Modal statusBarTranslucent hardwareAccelerated
      visible={!!state}
      transparent
      animationType="fade"
      onRequestClose={() => onResult(false)}
    >
      <Pressable style={s.confirmBackdrop} onPress={() => onResult(false)}>
        <Pressable style={s.confirmCard} onPress={() => {}}>
          <Text style={s.confirmTitle}>{state?.title}</Text>
          {!!state?.message && <Text style={s.confirmMessage}>{state.message}</Text>}
          <View style={s.confirmActions}>
            <TouchableOpacity
              style={[s.confirmBtn, s.confirmBtnCancel]}
              onPress={() => onResult(false)}
              activeOpacity={0.8}
            >
              <Text style={s.confirmBtnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmBtn, state?.destructive ? s.confirmBtnDestructive : s.confirmBtnPrimary]}
              onPress={() => onResult(true)}
              activeOpacity={0.8}
            >
              <Text style={[
                s.confirmBtnPrimaryText,
                state?.destructive && s.confirmBtnDestructiveText,
              ]}>
                {state?.confirmLabel ?? 'Confirm'}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(theme, statColumns) {
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
      flexGrow: 1, flexBasis: statColumns >= 3 ? '30%' : '46%',
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
    cardWrapper: { position: 'relative' },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 18,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.glass?.border || theme.border.default : theme.border.default,
      padding: 16, flexDirection: 'row', alignItems: 'center',
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    cardWithDelete: { paddingRight: 56 },
    cardName: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 16 },
    cardMeta: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
      fontSize: 12, marginTop: 4,
    },
    cardRound: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 11, marginTop: 2,
    },
    deleteBtn: {
      position: 'absolute', right: 10, top: 10,
      width: 30, height: 30, borderRadius: 10,
      backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center',
    },
    emptyState: { alignItems: 'center', paddingVertical: 80, gap: 12 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    emptySub: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 40,
    },
    confirmBackdrop: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center', justifyContent: 'center', padding: 32,
    },
    confirmCard: {
      width: '100%', maxWidth: 360,
      backgroundColor: theme.bg.card,
      borderRadius: 20, padding: 22,
      borderWidth: 1, borderColor: theme.border.default,
      ...(theme.isDark ? {} : theme.shadow.elevated),
    },
    confirmTitle: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary,
      marginBottom: 6,
    },
    confirmMessage: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.secondary,
      lineHeight: 20, marginBottom: 20,
    },
    confirmActions: { flexDirection: 'row', gap: 10 },
    confirmBtn: {
      flex: 1, paddingVertical: 12, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
    },
    confirmBtnCancel: {
      backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    confirmBtnCancelText: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary,
    },
    confirmBtnPrimary: {
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
    },
    confirmBtnPrimaryText: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14,
      color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    },
    confirmBtnDestructive: { backgroundColor: theme.destructive },
    confirmBtnDestructiveText: { color: '#ffffff' },
  });
}
