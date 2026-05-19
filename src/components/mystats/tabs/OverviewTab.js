import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import StatTile from '../StatTile';
import TrendLineChart from '../TrendLineChart';

// Verdict text from the points/round form direction.
function verdict(form) {
  if (!form.hasHistory) return 'Not enough history';
  const d = form.metrics[0].direction;
  if (d === 'up') return '▲ Improving';
  if (d === 'down') return '▼ Declining';
  return 'Holding steady';
}

export default function OverviewTab({ stats, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const { metrics, form, ranking, formSeries } = stats;
  const pointsDelta = form.hasHistory ? form.metrics[0].delta : null;

  return (
    <View style={s.wrap}>
      {/* ── Recent Form hero ── */}
      <SectionCard title="Recent Form" tone="hero" infoKey="recentForm" onInfo={onInfo}>
        <Text style={s.verdict}>{verdict(form)}</Text>
        {pointsDelta != null ? (
          <Text style={s.verdictSub}>
            {`${pointsDelta > 0 ? '+' : ''}${pointsDelta} pts / round vs your earlier rounds`}
          </Text>
        ) : (
          <Text style={s.verdictSub}>Play more rounds to see a trend.</Text>
        )}
        <TrendLineChart series={formSeries.metrics.avgPoints} color={theme.text.inverse} labelColor={theme.text.inverse} />
        <View style={s.tiles}>
          <StatTile surface="hero" value={`${metrics.rounds}`} caption="ROUNDS COUNTED" />
          <StatTile surface="hero" value={`${metrics.avgPoints}`} caption="AVG PTS / ROUND" />
          <StatTile surface="hero" value={`${metrics.bestRoundPoints}`} caption="BEST ROUND" />
        </View>
      </SectionCard>

      {/* ── Strengths & Pain Points ── */}
      <SectionCard title="Strengths & Pain Points" infoKey="strengths" onInfo={onInfo}>
        {ranking.baseline == null ? (
          <Text style={s.note}>Not enough data yet.</Text>
        ) : (
          <>
            <Text style={[s.group, { color: theme.accent.primary }]}>WHAT'S WORKING</Text>
            {ranking.strengths.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
            {ranking.strengths.map((c) => (
              <InsightRow key={c.label} cell={c} kind="good" s={s} theme={theme} />
            ))}
            <Text style={[s.group, { color: theme.destructive }]}>WHERE YOU LOSE POINTS</Text>
            {ranking.weaknesses.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
            {ranking.weaknesses.map((c) => (
              <InsightRow key={c.label} cell={c} kind="bad" s={s} theme={theme} />
            ))}
            <Text style={s.note}>{`Measured against your ${ranking.baseline} pts/hole average.`}</Text>
          </>
        )}
      </SectionCard>
    </View>
  );
}

function InsightRow({ cell, kind, s, theme }) {
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.insightRow}>
      <Feather name={kind === 'good' ? 'trending-up' : 'trending-down'} size={16} color={color} />
      <View style={s.insightText}>
        <Text style={s.insightName}>{cell.label}</Text>
        <Text style={s.insightSub}>{`${cell.avgPoints} pts / hole`}</Text>
      </View>
      <Text style={[s.insightDelta, { color }]}>
        {cell.deviation > 0 ? `+${cell.deviation}` : `${cell.deviation}`}
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    verdict: { ...theme.typography.title, color: theme.text.inverse, fontWeight: '800' },
    verdictSub: { ...theme.typography.caption, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
    tiles: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    group: { ...theme.typography.overline, fontWeight: '800', marginTop: theme.spacing.sm },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', marginTop: theme.spacing.xs },
    insightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    insightText: { flex: 1 },
    insightName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '600' },
    insightSub: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    insightDelta: { ...theme.typography.caption, fontWeight: '800' },
  });
}
