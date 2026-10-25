import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { useTheme } from '../theme/ThemeContext';
import {
  loadAllTournamentsWithFallback, isTournamentFinished,
  deleteTournament, subscribeTournamentChanges,
} from '../store/tournamentStore';
import { reopenGame } from '../store/reopenGame';
import { useT } from '../i18n';

export default function FinishedScreen({ navigation }) {
  const { theme } = useTheme();
  const t = useT();
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

  function openTournament(id) {
    navigation.navigate('Tournament', { tournamentId: id, viewMode: 'tournament' });
  }

  async function reopen(item) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(t('rounds.finished.reopenConfirm', { name: item.name }))
      : await new Promise((resolve) => Alert.alert(
          t('rounds.finished.reopen'),
          t('rounds.finished.reopenConfirm', { name: item.name }),
          [{ text: t('rounds.finished.cancel'), style: 'cancel', onPress: () => resolve(false) },
           { text: t('rounds.finished.reopen'), onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await reopenGame(item);
      await reload();
    } catch (err) {
      const msg = err?.message ?? t('rounds.finished.reopenError');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(t('rounds.finished.error'), msg);
    }
  }

  async function confirmDelete(item) {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(t('rounds.finished.deleteConfirm', { name: item.name }))
      : await new Promise((resolve) => Alert.alert(
          t('rounds.finished.delete'), t('rounds.finished.deleteConfirm', { name: item.name }),
          [{ text: t('rounds.finished.cancel'), style: 'cancel', onPress: () => resolve(false) },
           { text: t('rounds.finished.delete'), style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    try {
      await deleteTournament(item.id);
      await reload();
    } catch (err) {
      const msg = err?.message ?? t('rounds.finished.deleteError');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(t('rounds.finished.error'), msg);
    }
  }

  const renderCard = (item) => {
    const players = item.players ?? [];
    const rounds = item.rounds ?? [];
    const isGameKind = item.kind === 'game';
    const courseName = isGameKind ? (rounds[0]?.courseName ?? '') : null;
    const metaText = players.length > 0
      ? players.map((p) => p.name.split(' ')[0]).join(' · ')
      : '';
    return (
      <View key={item.id} style={s.cardWrapper}>
        <TouchableOpacity
          style={s.card}
          onPress={() => openTournament(item.id)}
          activeOpacity={0.7}
        >
          <View style={s.cardLeft}>
            <View style={s.cardHeader}>
              <Text style={s.cardName}>{item.name}</Text>
              <View style={s.statusBadge}>
                <Text style={s.statusBadgeText}>{t('rounds.finished.badge')}</Text>
              </View>
            </View>
            {metaText ? <Text style={s.cardMeta}>{metaText}</Text> : null}
            {rounds.length > 0 && (
              <Text style={s.cardRound}>
                {isGameKind ? (courseName || t('rounds.finished.singleRound')) : t('rounds.finished.roundCount', { count: rounds.length })}
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={18} color={theme.text.muted} />
        </TouchableOpacity>
        <View style={s.cardActions}>
          <IconButton
            icon="rotate-ccw"
            onPress={() => reopen(item)}
            accessibilityLabel={t('rounds.finished.reopen')}
          />
          {item._role === 'owner' && (
            <IconButton
              icon="trash-2"
              color={theme.destructive}
              onPress={() => confirmDelete(item)}
              accessibilityLabel={t('rounds.finished.delete')}
            />
          )}
        </View>
      </View>
    );
  };

  const games = finished.filter((t) => t.kind === 'game');
  const tournaments = finished.filter((t) => t.kind !== 'game');

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{t('rounds.finished.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {!loading && finished.length === 0 && (
          <View style={s.emptyState}>
            <Feather name="archive" size={44} color={theme.text.muted} />
            <Text style={s.emptyTitle}>{t('rounds.finished.emptyTitle')}</Text>
            <Text style={s.emptySubtitle}>{t('rounds.finished.emptyBody')}</Text>
          </View>
        )}
        {games.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{t('rounds.finished.games')}</Text>
            {games.map(renderCard)}
          </>
        )}
        {tournaments.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{t('rounds.finished.tournaments')}</Text>
            {tournaments.map(renderCard)}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
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
    emptyState: { alignItems: 'center', paddingVertical: 80, gap: 12 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    emptySubtitle: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 40,
    },
  });
}
