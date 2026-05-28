import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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

export default function OverviewTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
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

      <ActionPlanCard actionPlan={stats.actionPlan} s={s} theme={theme} />

      {/* ── Strokes Gained snapshot ── */}
      {stats?.strokesGained?.total != null && (
        <SectionCard
          title={
            (targetHandicap == null || targetHandicap === 0)
              ? 'Strokes Gained vs scratch'
              : `Strokes Gained vs handicap ${targetHandicap}`
          }
          infoKey="strokesGained"
          onInfo={onInfo}
          right={
            onChangeTarget && (
              <TouchableOpacity onPress={onChangeTarget} hitSlop={8}>
                <Feather name="edit-2" size={14} color={theme.text.secondary} />
              </TouchableOpacity>
            )
          }
        >
          <Text
            style={[
              s.sgValue,
              { color: stats.strokesGained.total >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor') },
            ]}
          >
            {stats.strokesGained.total >= 0 ? '+' : ''}
            {stats.strokesGained.total.toFixed(2)}
          </Text>
          <Text style={s.sgSubtle}>
            per round {(targetHandicap == null || targetHandicap === 0) ? 'vs scratch' : `vs hcp ${targetHandicap}`}
          </Text>
        </SectionCard>
      )}

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

function ActionPlanCard({ actionPlan, s, theme }) {
  if (!actionPlan || (!actionPlan.keep && !actionPlan.improve && !actionPlan.practice)) return null;
  return (
    <SectionCard title="Action Plan">
      {actionPlan.keep ? (
        <ActionPlanRow eyebrow="KEEP DOING" item={actionPlan.keep} icon="check-circle" color={theme.accent.primary} s={s} />
      ) : null}
      {actionPlan.improve ? (
        <ActionPlanRow eyebrow="BIGGEST LEAK" item={actionPlan.improve} icon="alert-triangle" color={theme.destructive} s={s} />
      ) : null}
      {actionPlan.practice ? (
        <ActionPlanRow eyebrow="PRACTICE FIRST" item={actionPlan.practice} icon="target" color={theme.scoreColor('neutral')} s={s} />
      ) : null}
    </SectionCard>
  );
}

function formatActionScore(item) {
  const sign = item.score > 0 ? '+' : '';
  return `${sign}${item.score} ${item.unit} · ${item.sample} samples`;
}

function ActionPlanRow({ eyebrow, item, icon, color, s }) {
  return (
    <View style={s.actionRow}>
      <Feather name={icon} size={17} color={color} />
      <View style={s.actionText}>
        <Text style={[s.actionEyebrow, { color }]}>{eyebrow}</Text>
        <Text style={s.actionLabel}>{item.label}</Text>
        <Text style={s.actionSub}>{`${item.area} · ${formatActionScore(item)}`}</Text>
      </View>
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
    actionRow: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start', paddingVertical: 7 },
    actionText: { flex: 1 },
    actionEyebrow: { ...theme.typography.tiny, fontWeight: '800' },
    actionLabel: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700', marginTop: 1 },
    actionSub: { ...theme.typography.caption, color: theme.text.muted, marginTop: 1 },
    insightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    insightText: { flex: 1 },
    insightName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '600' },
    insightSub: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    insightDelta: { ...theme.typography.caption, fontWeight: '800' },
    sgValue: { ...theme.typography.title, fontWeight: '800' },
    sgSubtle: { ...theme.typography.caption, color: theme.text.muted, marginTop: theme.spacing.xs },
  });
}
