import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import PressableScale from '../../ui/PressableScale';
import SectionCard from '../SectionCard';
import FormHero from '../FormHero';
import SparklineRow from '../SparklineRow';
import ScoreMixColumns from '../ScoreMixColumns';

// vs-par values print with an explicit sign.
const fmtVsPar = (v) => (v > 0 ? `+${v}` : `${v}`);
const fmtPct = (v) => `${v}%`;
const fmtNum = (v) => `${v}`;
// Shot metrics are null for an untracked slice — print a dash, not "null%".
const orDash = (fmt) => (v) => (v == null ? '—' : fmt(v));

// Per-metric formatting + explainer key + chart colour token for the
// Instruments rows, keyed by FORM_METRICS key. avgPoints lives in the hero.
// `drop` connects the sparkline over null rounds (round-total metrics);
// shot metrics keep their gaps — a gap there means "not tracked that round".
const META = {
  avgVsPar:           { colorToken: 'gold',   format: fmtVsPar, info: 'strokesVsPar', drop: true },
  fairwayPct:         { colorToken: 'accent', format: fmtPct,   info: 'fairwaysHit' },
  girPct:             { colorToken: 'accent', format: fmtPct,   info: 'greensInReg' },
  puttsPerRound:      { colorToken: 'red',    format: fmtNum,   info: 'putts' },
  threePuttsPerRound: { colorToken: 'red',    format: fmtNum,   info: 'threePutts' },
};

// Form tab: exactly three cards — the current-form hero, the Instruments
// panel of metric sparklines, and the Score mix damage report (latest-round
// damage headline, five-band per-round columns, steady-holes trend).
export default function FormTab({ stats, n, onChangeN, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // Accordion for the Instruments rows: at most one row shows its full
  // per-round chart at a time; tapping the open row again collapses it.
  const [expandedKey, setExpandedKey] = useState(null);
  const { form, formSeries } = stats;
  const GOLD = '#caa53d';
  const colorFor = (token) => (token === 'gold' ? GOLD : token === 'red' ? theme.destructive : theme.accent.primary);

  const periodChips = (
    <View style={s.chips}>
      {[3, 5, 10].map((opt) => (
        <PressableScale
          key={opt}
          onPress={() => onChangeN(opt)}
          style={[s.chip, n === opt && s.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: n === opt }}
        >
          <Text style={[s.chipText, n === opt && s.chipTextOn]}>{`Last ${opt}`}</Text>
        </PressableScale>
      ))}
    </View>
  );

  const instrumentMetrics = form.metrics.filter((m) => META[m.key] && !(m.shot && !formSeries.hasShotData));

  return (
    <View style={s.wrap}>
      <FormHero form={form} formSeries={formSeries} metrics={stats.metrics} n={n} onInfo={onInfo} />

      <SectionCard title="Instruments" infoKey="recentVsHistory" onInfo={onInfo} right={periodChips}>
        {!form.hasHistory && (
          <Text style={s.note}>{`Not enough history yet — select more than ${n} rounds to compare.`}</Text>
        )}
        {instrumentMetrics.map((m, i) => {
          const meta = META[m.key];
          return (
            <SparklineRow
              key={m.key}
              metric={m}
              series={formSeries.metrics[m.key]}
              color={colorFor(meta.colorToken)}
              formatValue={orDash(meta.format)}
              infoKey={meta.info}
              onInfo={onInfo}
              index={i}
              dropGaps={Boolean(meta.drop)}
              expanded={expandedKey === m.key}
              onToggle={() => setExpandedKey((k) => (k === m.key ? null : m.key))}
            />
          );
        })}
        {!formSeries.hasShotData && (
          <Text style={s.note}>Log putts and drives during a round to unlock fairway, green and putting trends.</Text>
        )}
      </SectionCard>

      <SectionCard title="Score mix" infoKey="scoreMix" onInfo={onInfo}>
        <ScoreMixColumns
          rounds={formSeries.scoreMix}
          damage={formSeries.damage}
          steadyPct={formSeries.steadyPct}
          onInfo={onInfo}
        />
      </SectionCard>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    chips: { flexDirection: 'row', gap: 4 },
    chip: {
      paddingHorizontal: theme.spacing.sm, paddingVertical: 4,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.card,
      borderWidth: 1, borderColor: theme.border.default,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    chipTextOn: { color: theme.text.inverse },
  });
}
