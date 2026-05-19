import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';
import { buildRoundReportCard } from '../store/roundReportCard';
import RoundReportCard from '../components/RoundReportCard';
import MyStatsRoundSelector from '../components/MyStatsRoundSelector';
import StatDetailSheet from '../components/StatDetailSheet';
import OverviewTab from '../components/mystats/tabs/OverviewTab';
import FormTab from '../components/mystats/tabs/FormTab';
import BreakdownTab from '../components/mystats/tabs/BreakdownTab';
import ShotsTab from '../components/mystats/tabs/ShotsTab';
import { statExplainers } from '../components/mystats/statExplainers';

const SELECTION_PREFIX = '@mystats_round_selection:';

const ALL_TABS = [
  { key: 'reportCard', label: 'Report Card' },
  { key: 'overview',  label: 'Overview' },
  { key: 'form',      label: 'Form' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'shots',     label: 'Shots' },
];

export default function MyStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [myRounds, setMyRounds] = useState(null);   // null = loading
  const [error, setError] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [n, setN] = useState(5);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [tab, setTab] = useState(route?.params?.tab ?? 'reportCard');
  const [reportRoundKey, setReportRoundKey] = useState(route?.params?.roundKey ?? null);
  const [infoKey, setInfoKey] = useState(null);

  const storageKey = user?.id ? `${SELECTION_PREFIX}${user.id}` : null;

  // Load all tournaments → collect this user's rounds. Restore stored overrides.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        // The profile display name lets collectMyRounds recognise unlinked
        // (guest) player slots — e.g. solo games never claimed to an account.
        const [{ list }, profile] = await Promise.all([
          loadAllTournamentsWithFallback(),
          loadProfile().catch(() => null),
        ]);
        const rounds = collectMyRounds(list, user?.id, profile?.displayName);
        let stored = {};
        if (storageKey) {
          try {
            const raw = await AsyncStorage.getItem(storageKey);
            if (raw) stored = JSON.parse(raw) || {};
          } catch (_) { /* ignore corrupt storage */ }
        }
        // Drop overrides whose round no longer exists.
        const liveKeys = new Set(rounds.map((r) => r.key));
        const clean = {};
        Object.keys(stored).forEach((k) => {
          if (liveKeys.has(k)) clean[k] = stored[k];
        });
        if (!cancelled) {
          setMyRounds(rounds);
          setOverrides(clean);
        }
      } catch (e) {
        console.warn('MyStatsScreen: failed to load tournaments', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, storageKey, loadNonce]);

  // Default the Report Card to the most recent round once rounds are loaded.
  // collectMyRounds returns rounds chronologically (oldest first), so the
  // last entry is the most recent.
  useEffect(() => {
    if (!myRounds || myRounds.length === 0) return;
    setReportRoundKey((prev) => {
      if (prev && myRounds.some((r) => r.key === prev)) return prev;
      return myRounds[myRounds.length - 1].key;
    });
  }, [myRounds]);

  const persistOverrides = useCallback((next) => {
    setOverrides(next);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
    }
  }, [storageKey]);

  const onInfo = useCallback((key) => setInfoKey(key), []);

  const selected = useMemo(
    () => (myRounds ? resolveSelection(myRounds, overrides) : []),
    [myRounds, overrides],
  );
  const stats = useMemo(
    () => (selected.length ? computeMyStats(selected, { n }) : null),
    [selected, n],
  );

  const reportCard = useMemo(
    () => (myRounds && reportRoundKey
      ? buildRoundReportCard(myRounds, reportRoundKey)
      : null),
    [myRounds, reportRoundKey],
  );

  const Header = (
    <View style={s.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
        <Feather name="chevron-left" size={22} color={theme.accent.primary} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>My Stats</Text>
      <TouchableOpacity
        onPress={() => setSelectorOpen(true)}
        style={s.roundsBtn}
        disabled={!myRounds}
      >
        <Feather name="sliders" size={14} color={theme.accent.primary} />
        <Text style={s.roundsBtnText}>
          {myRounds ? `${selected.length} of ${myRounds.length}` : '—'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const TabBar = (
    <View style={s.tabBar}>
      {ALL_TABS.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[s.tab, tab === t.key && s.tabActive]}
          onPress={() => setTab(t.key)}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === t.key }}
          accessibilityLabel={t.label}
        >
          <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // ── Loading ──
  if (myRounds === null && !error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="wifi-off" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Couldn't load your stats.</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setMyRounds(null); setError(false); setLoadNonce((v) => v + 1); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  // ── Empty: no rounds at all ──
  if (myRounds.length === 0) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="bar-chart-2" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Play and score a round to see your stats.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const Selector = (
    <MyStatsRoundSelector
      visible={selectorOpen}
      myRounds={myRounds}
      overrides={overrides}
      onChange={persistOverrides}
      onClose={() => setSelectorOpen(false)}
    />
  );

  // ── Empty: every round deselected ──
  if (selected.length === 0 && tab !== 'reportCard') {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="filter" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds selected.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => setSelectorOpen(true)}>
            <Text style={s.retryText}>Choose rounds</Text>
          </TouchableOpacity>
        </View>
        {Selector}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      {TabBar}
      <ScrollView contentContainerStyle={s.scroll}>
        {tab === 'reportCard' && (
          <RoundReportCard
            card={reportCard}
            rounds={myRounds}
            selectedKey={reportRoundKey}
            onSelect={setReportRoundKey}
          />
        )}
        {tab === 'overview' && <OverviewTab stats={stats} onInfo={onInfo} />}
        {tab === 'form' && <FormTab stats={stats} n={n} onChangeN={setN} onInfo={onInfo} />}
        {tab === 'breakdown' && <BreakdownTab stats={stats} onInfo={onInfo} />}
        {tab === 'shots' && <ShotsTab stats={stats} onInfo={onInfo} />}
      </ScrollView>
      <StatDetailSheet
        visible={!!infoKey}
        onClose={() => setInfoKey(null)}
        title={infoKey ? statExplainers[infoKey]?.title : ''}
        subtitle={infoKey ? statExplainers[infoKey]?.subtitle : ''}
        explainer={infoKey ? statExplainers[infoKey]?.explainer : ''}
        rows={[]}
        shareable={false}
      />
      {Selector}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    backBtn: { padding: theme.spacing.xs },
    headerTitle: { ...theme.typography.heading, color: theme.text.primary, flex: 1, marginLeft: theme.spacing.sm },
    roundsBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: theme.spacing.md, paddingVertical: 6,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.light,
    },
    roundsBtnText: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    tabBar: {
      flexDirection: 'row', gap: 6,
      paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm,
    },
    tab: {
      paddingVertical: 6, paddingHorizontal: 14,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    tabActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    tabText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tabTextActive: { color: theme.text.inverse },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  });
}
