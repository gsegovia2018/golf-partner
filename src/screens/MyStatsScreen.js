import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';
import MyStatsRoundSelector from '../components/MyStatsRoundSelector';

const SELECTION_PREFIX = '@mystats_round_selection:';

// Format strokes-vs-par with an explicit sign.
function fmtVsPar(v) {
  if (v > 0) return `+${v}`;
  return `${v}`;
}

export default function MyStatsScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [myRounds, setMyRounds] = useState(null);   // null = loading
  const [error, setError] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [metric, setMetric] = useState('points');   // 'points' | 'strokes'
  const [n, setN] = useState(5);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);

  const storageKey = user?.id ? `${SELECTION_PREFIX}${user.id}` : null;

  // Load all tournaments → collect this user's rounds. Restore stored overrides.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        const { list } = await loadAllTournamentsWithFallback();
        const rounds = collectMyRounds(list, user?.id);
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

  const persistOverrides = useCallback((next) => {
    setOverrides(next);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
    }
  }, [storageKey]);

  const selected = useMemo(
    () => (myRounds ? resolveSelection(myRounds, overrides) : []),
    [myRounds, overrides],
  );
  const stats = useMemo(
    () => (selected.length ? computeMyStats(selected, { n }) : null),
    [selected, n],
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

  // ── Loading ──
  if (myRounds === null && !error) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
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
      </SafeAreaView>
    );
  }

  // ── Empty: no rounds at all ──
  if (myRounds.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="bar-chart-2" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Play and score a round to see your stats.</Text>
        </View>
      </SafeAreaView>
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
  if (selected.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="filter" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds selected.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => setSelectorOpen(true)}>
            <Text style={s.retryText}>Choose rounds</Text>
          </TouchableOpacity>
        </View>
        {Selector}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {Header}
      <ScrollView contentContainerStyle={s.scroll}>
        <Snapshot stats={stats} metric={metric} onToggleMetric={setMetric} s={s} theme={theme} />
        <FormSection form={stats.form} n={n} onChangeN={setN} s={s} theme={theme} />
      </ScrollView>
      {Selector}
    </SafeAreaView>
  );
}

function Snapshot({ stats, metric, onToggleMetric, s, theme }) {
  const { metrics } = stats;
  const headline = stats.form.hasHistory ? stats.form.metrics[0].direction : 'flat';
  const arrow = headline === 'up' ? '▲' : headline === 'down' ? '▼' : '—';
  const arrowColor = headline === 'up' ? theme.accent.primary
    : headline === 'down' ? theme.destructive : theme.text.muted;
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>Snapshot</Text>
        <View style={s.metricToggle}>
          {['points', 'strokes'].map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => onToggleMetric(m)}
              style={[s.metricChip, metric === m && s.metricChipOn]}
            >
              <Text style={[s.metricChipText, metric === m && s.metricChipTextOn]}>
                {m === 'points' ? 'Points' : 'Strokes'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={s.statRow}>
        <Stat label="Rounds" value={`${stats.roundCount}`} s={s} />
        <Stat
          label={metric === 'points' ? 'Avg pts / round' : 'Avg vs par'}
          value={metric === 'points' ? `${metrics.avgPoints}` : fmtVsPar(metrics.avgVsPar)}
          s={s}
        />
        <Stat label="Best round" value={`${metrics.bestRoundPoints} pts`} s={s} />
        <Stat label="Form" value={arrow} valueColor={arrowColor} s={s} />
      </View>
    </View>
  );
}

function Stat({ label, value, valueColor, s }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, valueColor && { color: valueColor }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function FormSection({ form, n, onChangeN, s, theme }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>Recent vs History</Text>
        <View style={s.metricToggle}>
          {[3, 5, 10].map((opt) => (
            <TouchableOpacity
              key={opt}
              onPress={() => onChangeN(opt)}
              style={[s.metricChip, n === opt && s.metricChipOn]}
            >
              <Text style={[s.metricChipText, n === opt && s.metricChipTextOn]}>
                {`Last ${opt}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={s.formRow}>
        <Text style={[s.formLabel, s.formHeadCell]}>Metric</Text>
        <Text style={[s.formRecent, s.formHeadCell]}>Recent</Text>
        <Text style={[s.formHistory, s.formHeadCell]}>History</Text>
        <Text style={[s.formDelta, s.formHeadCell]}>Trend</Text>
      </View>
      {!form.hasHistory && (
        <Text style={s.note}>
          Not enough history yet — play more than {n} rounds to compare.
        </Text>
      )}
      {form.metrics.map((m) => {
        const color = m.direction === 'up' ? theme.accent.primary
          : m.direction === 'down' ? theme.destructive : theme.text.muted;
        const sign = m.delta != null && m.delta > 0 ? '+' : '';
        return (
          <View key={m.key} style={s.formRow}>
            <Text style={s.formLabel}>{m.label}</Text>
            <Text style={s.formRecent}>{m.recent}</Text>
            <Text style={s.formHistory}>{form.hasHistory ? m.history : '—'}</Text>
            <Text style={[s.formDelta, { color }]}>
              {m.delta == null ? '—'
                : m.direction === 'up' ? `▲ ${sign}${m.delta}`
                  : m.direction === 'down' ? `▼ ${sign}${m.delta}` : `${m.delta}`}
            </Text>
          </View>
        );
      })}
    </View>
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
    card: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      padding: theme.spacing.lg, gap: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { ...theme.typography.heading, color: theme.text.primary },
    metricToggle: { flexDirection: 'row', gap: 4 },
    metricChip: {
      paddingHorizontal: theme.spacing.sm, paddingVertical: 4,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
    },
    metricChipOn: { backgroundColor: theme.accent.primary },
    metricChipText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    metricChipTextOn: { color: theme.text.inverse },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.spacing.sm },
    stat: { alignItems: 'center', flex: 1 },
    statValue: { ...theme.typography.title, color: theme.text.primary },
    statLabel: { ...theme.typography.tiny, color: theme.text.muted, textAlign: 'center' },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    formRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
    formLabel: { ...theme.typography.body, color: theme.text.primary, flex: 2 },
    formRecent: { ...theme.typography.body, color: theme.text.primary, flex: 1, textAlign: 'right' },
    formHistory: { ...theme.typography.body, color: theme.text.muted, flex: 1, textAlign: 'right' },
    formDelta: { ...theme.typography.caption, fontWeight: '700', flex: 1, textAlign: 'right' },
    formHeadCell: { ...theme.typography.overline, color: theme.text.muted },
    subhead: { ...theme.typography.subhead, color: theme.text.secondary, marginTop: theme.spacing.sm },
    insightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 6 },
    insightText: { ...theme.typography.body, color: theme.text.primary, flex: 1 },
    insightDelta: { ...theme.typography.caption, fontWeight: '700' },
    dim: { color: theme.text.muted },
  });
}
