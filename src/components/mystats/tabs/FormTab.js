import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';
import ScoreMixArea from '../ScoreMixArea';
import FormMetricBlock from '../FormMetricBlock';

// vs-par values print with an explicit sign.
const fmtVsPar = (v) => (v > 0 ? `+${v}` : `${v}`);
const fmtPct = (v) => `${v}%`;
const fmtNum = (v) => `${v}`;
// Shot metrics are null for an untracked slice — print a dash, not "null%".
const orDash = (fmt) => (v) => (v == null ? '—' : fmt(v));

// Per-metric formatting + explainer key + chart colour token, keyed by FORM_METRICS key.
const META = {
  avgPoints:          { colorToken: 'accent', format: fmtNum,   info: 'pointsPerRound' },
  avgVsPar:           { colorToken: 'gold',   format: fmtVsPar, info: 'strokesVsPar' },
  fairwayPct:         { colorToken: 'accent', format: fmtPct,   info: 'fairwaysHit' },
  girPct:             { colorToken: 'accent', format: fmtPct,   info: 'greensInReg' },
  puttsPerRound:      { colorToken: 'red',    format: fmtNum,   info: 'putts' },
  threePuttsPerRound: { colorToken: 'red',    format: fmtNum,   info: 'threePutts' },
};

export default function FormTab({ stats, n, onChangeN, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { form, formSeries } = stats;
  const GOLD = '#caa53d';
  const colorFor = (token) => (token === 'gold' ? GOLD : token === 'red' ? theme.destructive : theme.accent.primary);

  const periodChips = (
    <View style={s.chips}>
      {[3, 5, 10].map((opt) => (
        <TouchableOpacity
          key={opt}
          onPress={() => onChangeN(opt)}
          style={[s.chip, n === opt && s.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: n === opt }}
        >
          <Text style={[s.chipText, n === opt && s.chipTextOn]}>{`Last ${opt}`}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={s.wrap}>
      <SectionCard title="Points per round" infoKey="pointsPerRound" onInfo={onInfo}>
        <TrendLineChart
          series={formSeries.metrics.avgPoints}
          color={theme.accent.primary}
          caption="Higher is better · oldest → newest"
        />
      </SectionCard>

      <SectionCard title="Strokes vs par" infoKey="strokesVsPar" onInfo={onInfo}>
        <TrendLineChart
          series={formSeries.metrics.avgVsPar}
          color={GOLD}
          formatValue={fmtVsPar}
          caption="Lower is better · oldest → newest"
        />
      </SectionCard>

      <SectionCard title="Score mix" infoKey="scoreMix" onInfo={onInfo}>
        <Text style={s.caption}>Share of holes per round · birdie+ → bogey+</Text>
        <ScoreMixArea rounds={formSeries.scoreMix} />
      </SectionCard>

      <SectionCard title="Recent vs History" infoKey="recentVsHistory" onInfo={onInfo} right={periodChips}>
        {!form.hasHistory && (
          <Text style={s.note}>{`Not enough history yet — select more than ${n} rounds to compare.`}</Text>
        )}
        {form.metrics.map((m) => {
          const meta = META[m.key];
          // Shot metrics with no logged data have an all-null series — skip them.
          if (m.shot && !formSeries.hasShotData) return null;
          return (
            <FormMetricBlock
              key={m.key}
              metric={m}
              series={formSeries.metrics[m.key]}
              color={colorFor(meta.colorToken)}
              formatValue={orDash(meta.format)}
              infoKey={meta.info}
              onInfo={onInfo}
            />
          );
        })}
        {!formSeries.hasShotData && (
          <Text style={s.note}>Log putts and drives during a round to unlock fairway, green and putting trends.</Text>
        )}
      </SectionCard>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    chips: { flexDirection: 'row', gap: 4 },
    chip: {
      paddingHorizontal: theme.spacing.sm, paddingVertical: 4,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
    },
    chipOn: { backgroundColor: theme.accent.primary },
    chipText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    chipTextOn: { color: theme.text.inverse },
  });
}
