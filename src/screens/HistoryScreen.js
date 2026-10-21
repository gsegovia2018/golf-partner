import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, Modal, Pressable,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import HistoryRow, { HistoryRowSkeleton } from '../components/HistoryRow';
import { Skeleton, SkeletonRegion } from '../components/ui/Skeleton';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import SwipeToDelete from '../components/ui/SwipeToDelete';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  loadAllTournamentsWithFallback, loadCachedTournamentsList, isTournamentFinished,
  subscribeTournamentChanges, deleteTournament,
} from '../store/tournamentStore';
import { loadProfile, loadCachedProfile, computePersonalStats } from '../store/profileStore';
import { buildHistorySections } from '../store/historyModel';
import { semantic } from '../theme/tokens';
import { useT, formatNumber } from '../i18n';

// The era a net points record belongs to. Stableford points are net of the
// handicap the round was played off, so a career best is not comparable with
// a round played off a different one — the label is what makes that legible.
// Prefers the handicap INDEX (the number golfers think in) where the round
// carries a snapshot of it; older rounds have none and fall back to the
// playing handicap, labelled "shots" so it is never misread as an index.
// Mirrors the same helper in CareerMilestonesCard — kept local, like this
// screen's other small formatters, rather than shared for four lines.
function handicapEra({ index, handicap }, t) {
  if (index != null) return t('home.history.eraIndex', { index: formatNumber(index) });
  if (handicap != null) return t('home.history.eraShots', { handicap: formatNumber(handicap) });
  return null;
}

const FILTERS = [
  { key: 'all', labelKey: 'home.history.filterAll' },
  { key: 'tournament', labelKey: 'home.history.filterTournaments' },
  { key: 'game', labelKey: 'home.history.filterGames' },
];

// History tab: a condensed record strip, filter chips, and the archive of
// finished games and tournaments as one month-grouped timeline.
export default function HistoryScreen({ navigation }) {
  const { theme } = useTheme();
  const t = useT();
  const { user } = useAuth() ?? {};
  const userId = user?.id ?? null;
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const s = useMemo(() => makeStyles(theme, gold), [theme, gold]);

  const [finished, setFinished] = useState([]);
  const [identity, setIdentity] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  // Nothing on the device and the network unreachable: an error with Retry,
  // never "No history yet", which would claim the archive is empty.
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);
  const confirm = useCallback(({ title, message, confirmLabel = t('home.history.confirm'), destructive = false }) => (
    new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ title, message, confirmLabel, destructive });
    })
  ), [t]);
  const resolveConfirm = useCallback((result) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(result);
  }, []);

  // The archive and the record strip both come from one list. Stats are
  // computed from the list in hand, never a second fetch of it.
  const applyList = useCallback(async (list, profile) => {
    setFinished(list.filter((t) => isTournamentFinished(t)));
    if (!profile?.userId && !profile?.displayName) return;
    const id = { userId: profile?.userId, displayName: profile?.displayName };
    setIdentity(id);
    try {
      setStats(await computePersonalStats(id, list));
    } catch { /* stats are best-effort */ }
  }, []);

  const paintedRef = useRef(false);
  const reload = useCallback(async () => {
    try {
      // First open paints what the device already has (one disk read each)
      // while the remote list and profile load, then they replace it.
      const remote = Promise.all([
        loadAllTournamentsWithFallback(),
        loadProfile().catch(() => null),
      ]);
      let cachedProfile = null;
      if (!paintedRef.current) {
        const [cachedList, profile] = await Promise.all([
          loadCachedTournamentsList({ listedOnly: true }).catch(() => []),
          loadCachedProfile(userId),
        ]);
        cachedProfile = profile;
        if (cachedList.some((t) => isTournamentFinished(t))) {
          await applyList(cachedList, cachedProfile);
          paintedRef.current = true;
          setLoading(false);
        }
      }
      const [{ list, stale }, profile] = await remote;
      await applyList(list, profile ?? cachedProfile);
      setFailed(!!stale && list.length === 0);
    } finally {
      paintedRef.current = true;
      setLoading(false);
    }
  }, [applyList, userId]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    reload();
    const unsub = subscribeTournamentChanges(() => { if (!cancelled) reload(); });
    return () => { cancelled = true; unsub(); };
  }, [reload]));

  function openTournament(id) {
    navigation.navigate('Tournament', { tournamentId: id, viewMode: 'tournament' });
  }

  async function confirmDelete(tournament) {
    const confirmed = await confirm({
      title: t(tournament?.kind === 'game' ? 'home.history.deleteGameTitle' : 'home.history.deleteTournamentTitle'),
      message: t('home.history.deleteMessage', { name: tournament.name }),
      confirmLabel: t('home.history.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteTournament(tournament.id);
      await reload();
    } catch (err) {
      const msg = err?.message ?? t('home.history.deleteError');
      Alert.alert(t('home.history.errorTitle'), msg);
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
    { label: t('home.history.rounds'), value: String(stats.roundsPlayed) },
    { label: t('home.history.wins'), value: String(stats.wins), gold: true },
    // Averaged over full rounds only, so it is those — not every round played
    // — that decide whether there is an average to show at all.
    { label: t('home.history.avgPts'), value: stats.fullRounds > 0 ? formatNumber(stats.avgPointsPerRound, { decimals: 1 }) : '—' },
    {
      label: t('home.history.best'),
      value: stats.bestRound ? String(stats.bestRound.points) : '—',
      note: stats.bestRound ? handicapEra(stats.bestRound, t) : null,
    },
  ] : [];

  let rowIndex = -1;

  return (
    <ScreenContainer style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>{t('home.history.title')}</Text>
      </View>

      {loading ? (
        <HistorySkeleton s={s} t={t} theme={theme} filter={filter} onFilter={setFilter} />
      ) : failed ? (
        <View style={s.emptyState}>
          <Feather name="cloud-off" size={44} color={theme.text.muted} />
          <Text style={s.emptyTitle}>{t('home.history.loadErrorTitle')}</Text>
          <Text style={s.emptySub}>{t('common.checkConnection')}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setFailed(false); setLoading(true); reload(); }}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Feather name="refresh-cw" size={14} color={theme.text.inverse} />
            <Text style={s.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {stats && stats.roundsPlayed > 0 && (
            <PressableScale
              style={s.recordStrip}
              activeScale={0.98}
              onPress={() => navigation.navigate('MyStats')}
              accessibilityRole="button"
              accessibilityLabel={t('home.history.recordA11y')}
            >
              {recordCells.map((c, i) => (
                <React.Fragment key={c.label}>
                  {i > 0 && <View style={s.recordDivider} />}
                  <View style={s.recordCell}>
                    <Text style={[s.recordValue, c.gold && s.recordValueGold]}>{c.value}</Text>
                    <Text style={s.recordLabel}>{c.label}</Text>
                    {c.note ? <Text style={s.recordNote}>{c.note}</Text> : null}
                  </View>
                </React.Fragment>
              ))}
              <Feather name="chevron-right" size={16} color={theme.text.muted} />
            </PressableScale>
          )}

          <FilterChips s={s} t={t} filter={filter} onFilter={setFilter} />

          {sections.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="clock" size={44} color={theme.text.muted} />
              <Text style={s.emptyTitle}>{t('home.history.emptyTitle')}</Text>
              <Text style={s.emptySub}>
                {finished.length === 0
                  ? t('home.history.emptyAll')
                  : t('home.history.emptyFilter')}
              </Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.key}>
                <Text style={s.sectionLabel}>{section.label.toUpperCase()}</Text>
                {section.items.map((model) => {
                  rowIndex += 1;
                  const item = byId[model.id];
                  return (
                    <Reveal
                      key={model.id}
                      delay={Math.min(rowIndex * 30, 300)}
                      dy={8}
                      duration={250}
                      style={s.rowWrap}
                    >
                      <SwipeToDelete
                        enabled={!!(model.isOwner && item)}
                        onDelete={() => confirmDelete(item)}
                        accessibilityLabel={t('home.history.deleteA11y', { title: model.title })}
                      >
                        <HistoryRow
                          model={model}
                          onPress={() => openTournament(model.id)}
                          onLongPress={model.isOwner && item ? () => confirmDelete(item) : undefined}
                        />
                      </SwipeToDelete>
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
  const t = useT();
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
              <Text style={s.confirmBtnCancelText}>{t('home.history.cancel')}</Text>
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
                {state?.confirmLabel ?? t('home.history.confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterChips({ s, t, filter, onFilter }) {
  return (
    <View style={s.chips}>
      {FILTERS.map((f) => (
        <TouchableOpacity
          key={f.key}
          style={[s.chip, filter === f.key && s.chipOn]}
          onPress={() => onFilter(f.key)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === f.key }}
        >
          <Text style={[s.chipText, filter === f.key && s.chipTextOn]}>{t(f.labelKey)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// First open with nothing on the device: the real record labels and filters,
// boxes where the numbers and rows will land (DESIGN.md "Loading states").
const RECORD_LABEL_KEYS = ['home.history.rounds', 'home.history.wins', 'home.history.avgPts', 'home.history.best'];
const SKELETON_TITLE_WIDTHS = ['70%', '52%', '84%', '64%'];

function HistorySkeleton({ s, t, theme, filter, onFilter }) {
  return (
    <SkeletonRegion style={s.content} testID="history-skeleton">
      <View style={s.recordStrip}>
        {RECORD_LABEL_KEYS.map((key, i) => (
          <React.Fragment key={key}>
            {i > 0 && <View style={s.recordDivider} />}
            <View style={s.recordCell}>
              <Skeleton width={26} height={19} style={s.recordValueSkeleton} />
              <Text style={s.recordLabel}>{t(key)}</Text>
            </View>
          </React.Fragment>
        ))}
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </View>
      <FilterChips s={s} t={t} filter={filter} onFilter={onFilter} />
      <Skeleton width={86} height={8} radius={3} style={s.sectionLabelSkeleton} />
      {SKELETON_TITLE_WIDTHS.map((w) => (
        <View key={w} style={s.rowWrap}><HistoryRowSkeleton titleWidth={w} /></View>
      ))}
    </SkeletonRegion>
  );
}

function makeStyles(theme, gold) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
    headerTitle: {
      fontFamily: 'PlayfairDisplay-Black', fontSize: 26, color: theme.text.primary,
    },
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
    recordValueSkeleton: { marginVertical: 3 },
    sectionLabelSkeleton: { marginTop: 20, marginBottom: 14 },
    recordLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5, letterSpacing: 0.8,
      color: theme.text.muted, marginTop: 2, textTransform: 'uppercase',
    },
    recordNote: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 8.5,
      color: theme.text.muted, marginTop: 1,
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
    retryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
      backgroundColor: theme.accent.primary, borderRadius: 12,
      paddingHorizontal: 18, paddingVertical: 12,
    },
    retryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.inverse },
    emptyState: { alignItems: 'center', paddingVertical: 80, gap: 12 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
    emptySub: {
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
      textAlign: 'center', paddingHorizontal: 40,
    },
    confirmBackdrop: {
      flex: 1, backgroundColor: semantic.scrim,
      alignItems: 'center', justifyContent: 'center', padding: 32,
    },
    confirmCard: {
      width: '100%', maxWidth: 360,
      // Opaque in dark: the dark bg.card tint is see-through over the scrim.
      backgroundColor: theme.isDark ? theme.bg.primary : theme.bg.card,
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
    confirmBtnDestructiveText: { color: theme.isDark ? theme.text.inverse : '#ffffff' },
  });
}
