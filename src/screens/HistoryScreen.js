import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
  Alert, Modal, Pressable,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import HistoryRow from '../components/HistoryRow';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import {
  loadAllTournamentsWithFallback, isTournamentFinished,
  subscribeTournamentChanges, deleteTournament, tournamentNounCapitalized,
} from '../store/tournamentStore';
import { loadProfile, computePersonalStats } from '../store/profileStore';
import { buildHistorySections } from '../store/historyModel';
import { semantic } from '../theme/tokens';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'tournament', label: 'Tournaments' },
  { key: 'game', label: 'Games' },
];

// History tab: a condensed record strip, filter chips, and the archive of
// finished games and tournaments as one month-grouped timeline.
export default function HistoryScreen({ navigation }) {
  const { theme } = useTheme();
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const s = useMemo(() => makeStyles(theme, gold), [theme, gold]);

  const [finished, setFinished] = useState([]);
  const [identity, setIdentity] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
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
      setFinished(list.filter((t) => isTournamentFinished(t)));
      try {
        const profile = await loadProfile();
        if (profile?.userId || profile?.displayName) {
          const id = { userId: profile?.userId, displayName: profile?.displayName };
          setIdentity(id);
          setStats(await computePersonalStats(id));
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
      title: `Delete ${tournamentNounCapitalized(t)}`,
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

  const filtered = useMemo(() => (
    filter === 'all'
      ? finished
      : finished.filter((t) => (filter === 'game' ? t.kind === 'game' : t.kind !== 'game'))
  ), [finished, filter]);

  const sections = useMemo(
    () => buildHistorySections(filtered, identity),
    [filtered, identity],
  );
  const byId = useMemo(
    () => Object.fromEntries(finished.map((t) => [t.id, t])),
    [finished],
  );

  const recordCells = stats ? [
    { label: 'Rounds', value: String(stats.roundsPlayed) },
    { label: 'Wins', value: String(stats.wins), gold: true },
    { label: 'Avg pts', value: stats.roundsPlayed > 0 ? stats.avgPointsPerRound.toFixed(1) : '—' },
    { label: 'Best', value: stats.bestRound ? String(stats.bestRound.points) : '—' },
  ] : [];

  let rowIndex = -1;

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
            <PressableScale
              style={s.recordStrip}
              activeScale={0.98}
              onPress={() => navigation.navigate('MyStats')}
              accessibilityRole="button"
              accessibilityLabel="Your record. Opens My Stats."
            >
              {recordCells.map((c, i) => (
                <React.Fragment key={c.label}>
                  {i > 0 && <View style={s.recordDivider} />}
                  <View style={s.recordCell}>
                    <Text style={[s.recordValue, c.gold && s.recordValueGold]}>{c.value}</Text>
                    <Text style={s.recordLabel}>{c.label}</Text>
                  </View>
                </React.Fragment>
              ))}
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </PressableScale>
          )}

          <View style={s.chips}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[s.chip, filter === f.key && s.chipOn]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f.key }}
              >
                <Text style={[s.chipText, filter === f.key && s.chipTextOn]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {sections.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="clock" size={44} color={theme.text.muted} />
              <Text style={s.emptyTitle}>No history yet</Text>
              <Text style={s.emptySub}>
                {finished.length === 0
                  ? 'Finished games and tournaments will be archived here.'
                  : 'Nothing in this filter yet.'}
              </Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.key}>
                <Text style={s.sectionLabel}>{section.label.toUpperCase()}</Text>
                {section.items.map((model) => {
                  rowIndex += 1;
                  const t = byId[model.id];
                  return (
                    <Reveal
                      key={model.id}
                      delay={Math.min(rowIndex * 30, 300)}
                      dy={8}
                      duration={250}
                      style={s.rowWrap}
                    >
                      <HistoryRow
                        model={model}
                        onPress={() => openTournament(model.id)}
                        onLongPress={model.isOwner && t ? () => confirmDelete(t) : undefined}
                      />
                    </Reveal>
                  );
                })}
              </View>
            ))
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

function makeStyles(theme, gold) {
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
    recordStrip: {
      marginTop: 6, marginBottom: 4, paddingVertical: 13, paddingHorizontal: 16,
      backgroundColor: theme.bg.card, borderRadius: 16,
      borderWidth: 1, borderColor: theme.border.default,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: 8,
      ...(theme.isDark ? {} : theme.shadow.card),
    },
    recordCell: { alignItems: 'center', flex: 1 },
    recordValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 19, color: theme.text.primary },
    recordValueGold: { color: gold },
    recordLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 0.8,
      color: theme.text.muted, marginTop: 2, textTransform: 'uppercase',
    },
    recordDivider: { width: 1, height: 26, backgroundColor: theme.border.default },
    chips: { flexDirection: 'row', gap: 8, paddingTop: 14, paddingBottom: 2 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
      borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.bg.card,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.secondary,
    },
    chipTextOn: { color: theme.text.inverse },
    rowWrap: { marginBottom: 10 },
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
