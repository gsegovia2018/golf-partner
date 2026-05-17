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

  const fb = stats.frontBack;
  const fbHoles = fb ? fb.rounds.length * 9 : 0;

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {Header}
      <ScrollView contentContainerStyle={s.scroll}>
        <Snapshot stats={stats} metric={metric} onToggleMetric={setMetric} s={s} theme={theme} />
        <FormSection form={stats.form} history={stats.history} n={n} onChangeN={setN} s={s} theme={theme} />
        <StrengthsSection ranking={stats.ranking} s={s} theme={theme} />
        <BreakdownSection title="Par type" rows={[
          ['Par 3s', stats.parType.par3.avgPoints, stats.parType.par3.holes],
          ['Par 4s', stats.parType.par4.avgPoints, stats.parType.par4.holes],
          ['Par 5s', stats.parType.par5.avgPoints, stats.parType.par5.holes],
        ]} s={s} />
        <BreakdownSection title="Hole difficulty" rows={[
          ['Hard (SI 1-6)', stats.difficulty.hard.avgPoints, stats.difficulty.hard.holes],
          ['Mid (SI 7-12)', stats.difficulty.mid.avgPoints, stats.difficulty.mid.holes],
          ['Easy (SI 13-18)', stats.difficulty.easy.avgPoints, stats.difficulty.easy.holes],
        ]} s={s} />
        <BreakdownSection title="Round shape" rows={[
          ['Front nine', fb ? fb.frontAvg : 0, fbHoles],
          ['Back nine', fb ? fb.backAvg : 0, fbHoles],
          ['Opening 3', stats.warmupClosing.warmup.avgPoints, stats.warmupClosing.warmup.holes],
          ['Closing 3', stats.warmupClosing.closing.avgPoints, stats.warmupClosing.closing.holes],
        ]} s={s} />
        <DistributionSection dist={stats.distribution} s={s} />
        {(stats.bounceBack || stats.scrambling) ? (
          <BreakdownSection title="Recovery" rows={[
            ['Bounce-back rate %', stats.bounceBack ? stats.bounceBack.rate : 0, stats.bounceBack ? stats.bounceBack.opportunities : 0],
            ['Scrambling %', stats.scrambling ? stats.scrambling.pct : 0, stats.scrambling ? stats.scrambling.missedGir : 0],
          ]} s={s} />
        ) : null}
        {stats.teeShot.hasData ? (
          <BreakdownSection title="Tee shot impact" rows={[
            ['Fairway found', stats.teeShot.fairway.avgPoints, stats.teeShot.fairway.holes],
            ['Fairway missed', stats.teeShot.missed.avgPoints, stats.teeShot.missed.holes],
            ['Miss left', stats.teeShot.byDirection.left.avgPoints, stats.teeShot.byDirection.left.holes],
            ['Miss right', stats.teeShot.byDirection.right.avgPoints, stats.teeShot.byDirection.right.holes],
            ['Miss short', stats.teeShot.byDirection.short.avgPoints, stats.teeShot.byDirection.short.holes],
            ['After tee penalty', stats.teeShot.teePenalty.avgPoints, stats.teeShot.teePenalty.holes],
            ['Penalty drag (pts lost)', stats.teeShot.penaltyDrag, stats.teeShot.teePenalty.holes],
          ]} s={s} />
        ) : null}
        {stats.shots.hasData ? (
          <BreakdownSection title="Putting & driving" rows={[
            ['Putts / round', stats.shots.putts.perRound, stats.shots.putts.holes],
            ['1-putts', stats.shots.putts.onePutts, stats.shots.putts.holes],
            ['3-putts+', stats.shots.putts.threePuttPlus, stats.shots.putts.holes],
            ['Fairways hit %', stats.shots.drives.fairwayPct, stats.shots.drives.recorded],
            ['Greens in reg %', stats.shots.gir.pct, stats.shots.gir.eligible],
            ['Penalties / round', stats.shots.penalties.total, stats.shots.roundsWithData],
          ]} s={s} />
        ) : null}
        {!stats.teeShot.hasData && !stats.shots.hasData ? (
          <View style={s.card}>
            <Text style={s.note}>
              Log putts and drives during a round to unlock tee-shot, putting and
              driving stats.
            </Text>
          </View>
        ) : null}
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

function FormSection({ form, history, n, onChangeN, s, theme }) {
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
          Not enough history yet — select more than {n} rounds to compare.
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
      <Sparkline history={history} s={s} theme={theme} />
    </View>
  );
}

function StrengthsRow({ cell, kind, s, theme }) {
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.insightRow}>
      <Feather
        name={kind === 'good' ? 'trending-up' : 'trending-down'}
        size={16}
        color={color}
      />
      <Text style={s.insightText}>
        {cell.label} — {cell.avgPoints} pts/hole
      </Text>
      <Text style={[s.insightDelta, { color }]}>
        {cell.deviation > 0 ? `+${cell.deviation}` : `${cell.deviation}`}
      </Text>
    </View>
  );
}

function StrengthsSection({ ranking, s, theme }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Strengths & Pain Points</Text>
      {ranking.baseline == null ? (
        <Text style={s.note}>Not enough data yet.</Text>
      ) : (
        <>
          <Text style={s.subhead}>What's working</Text>
          {ranking.strengths.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
          {ranking.strengths.map((c) => (
            <StrengthsRow key={c.label} cell={c} kind="good" s={s} theme={theme} />
          ))}
          <Text style={s.subhead}>Where you're losing points</Text>
          {ranking.weaknesses.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
          {ranking.weaknesses.map((c) => (
            <StrengthsRow key={c.label} cell={c} kind="bad" s={s} theme={theme} />
          ))}
          <Text style={s.note}>Measured against your {ranking.baseline} pts/hole average.</Text>
        </>
      )}
    </View>
  );
}

// rows: array of [label, value, sample]. Rows with sample 0 are dimmed.
function BreakdownSection({ title, rows, s }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {rows.map(([label, value, sample]) => (
        <View key={label} style={s.formRow}>
          <Text style={[s.formLabel, sample === 0 && s.dim]}>{label}</Text>
          <Text style={[s.formRecent, sample === 0 && s.dim]}>{sample === 0 ? '—' : value}</Text>
          <Text style={[s.formHistory, s.dim]}>{sample === 0 ? '' : `${sample} ×`}</Text>
        </View>
      ))}
    </View>
  );
}

function DistributionSection({ dist, s }) {
  const rows = [
    ['Eagles+', dist.eagles], ['Birdies', dist.birdies], ['Pars', dist.pars],
    ['Bogeys', dist.bogeys], ['Doubles', dist.doubles], ['Triple+', dist.worse],
  ];
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Score distribution</Text>
      {rows.map(([label, count]) => (
        <View key={label} style={s.formRow}>
          <Text style={s.formLabel}>{label}</Text>
          <Text style={s.formRecent}>{count}</Text>
          <Text style={[s.formHistory, s.dim]}>
            {dist.total > 0 ? `${Math.round((count / dist.total) * 100)}%` : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

// Chronological points-per-round bar sparkline. Oldest round on the left.
// Renders nothing for fewer than 2 rounds (a one-bar trend says nothing).
function Sparkline({ history, s, theme }) {
  if (!history || history.length < 2) return null;
  const points = history.map((h) => h.points);
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const BAR_AREA = 44;
  return (
    <View style={s.sparkWrap}>
      <Text style={s.sparkCaption}>Points per round · oldest → newest</Text>
      <View style={s.sparkRow}>
        {history.map((h) => (
          <View
            key={h.roundIndex}
            style={[
              s.sparkBar,
              {
                height: Math.max(3, Math.round((h.points / max) * BAR_AREA)),
                backgroundColor: theme.accent.primary,
              },
            ]}
          />
        ))}
      </View>
      <View style={s.sparkScale}>
        <Text style={s.sparkScaleText}>low {min}</Text>
        <Text style={s.sparkScaleText}>high {max}</Text>
      </View>
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
    sparkWrap: { marginTop: theme.spacing.sm, gap: theme.spacing.xs },
    sparkCaption: { ...theme.typography.tiny, color: theme.text.muted },
    sparkRow: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 2,
      height: 56, paddingVertical: theme.spacing.xs,
    },
    sparkBar: { flex: 1, borderRadius: 2, minHeight: 3 },
    sparkScale: { flexDirection: 'row', justifyContent: 'space-between' },
    sparkScaleText: { ...theme.typography.tiny, color: theme.text.muted },
  });
}
