import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import { useT, formatNumber } from '../../../i18n';
import PressableScale from '../../ui/PressableScale';
import SectionCard from '../SectionCard';
import FormHero from '../FormHero';
import SparklineRow from '../SparklineRow';
import ScoreMixColumns, { DamageHeader } from '../ScoreMixColumns';
import TrendLineChart from '../TrendLineChart';
import { toneColor, toneOfSeries } from '../../../theme/tone';

// vs-par values print with an explicit sign.
const fmtVsPar = (v) => (v > 0 ? `+${formatNumber(v)}` : formatNumber(v));
const fmtPct = (v) => `${formatNumber(v)}%`;
const fmtNum = (v) => formatNumber(v);
// Shot metrics are null for an untracked slice — print a dash, not "null%".
const orDash = (fmt) => (v) => (v == null ? '—' : fmt(v));

// Per-metric formatting + explainer key for the Instruments rows, keyed by
// FORM_METRICS key. Each row's colour is its direction (SparklineRow). avgDifferential lives in the
// hero, so it has no entry here.
// `drop` connects the sparkline over null rounds (round-total metrics);
// shot metrics keep their gaps — a gap there means "not tracked that round".
const META = {
  avgVsPar:           { format: fmtVsPar, info: 'strokesVsPar', drop: true },
  fairwayPct:         { format: fmtPct,   info: 'fairwaysHit' },
  girPct:             { format: fmtPct,   info: 'greensInReg' },
  puttsPerRound:      { format: fmtNum,   info: 'putts' },
  threePuttsPerRound: { format: fmtNum,   info: 'threePutts' },
};

// Form tab: exactly four cards — the current-form hero, the Instruments
// panel of metric sparklines, the Score mix damage report (latest-round
// damage headline in the card header, five-band per-round columns), and the
// Steady holes trend. Mix/damage/steady are GROSS — see computeFormSeries.
// Memoised — see the note in CoachTab.
function FormTab({ stats, n, onChangeN, onInfo }) {
  const t = useT();
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // Accordion for the Instruments rows: at most one row shows its full
  // per-round chart at a time; tapping the open row again collapses it.
  const [expandedKey, setExpandedKey] = useState(null);
  const { form, formSeries } = stats;

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
          <Text style={[s.chipText, n === opt && s.chipTextOn]}>{t('stats.tab.form.last', { n: opt })}</Text>
        </PressableScale>
      ))}
    </View>
  );

  const instrumentMetrics = form.metrics.filter((m) => META[m.key] && !(m.shot && !formSeries.hasShotData));

  return (
    <View style={s.wrap}>
      <FormHero form={form} formSeries={formSeries} metrics={stats.metrics} n={n} onInfo={onInfo} />

      <SectionCard title={t('stats.tab.form.instruments')} infoKey="recentVsHistory" onInfo={onInfo} right={periodChips}>
        {!form.hasHistory && (
          <Text style={s.note}>{t('stats.tab.form.notEnoughHistory', { n })}</Text>
        )}
        {instrumentMetrics.map((m, i) => {
          const meta = META[m.key];
          return (
            <SparklineRow
              key={m.key}
              metric={m}
              series={formSeries.metrics[m.key]}
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
          <Text style={s.note}>{t('stats.tab.form.logShots')}</Text>
        )}
      </SectionCard>

      <SectionCard
        title={t('stats.tab.form.scoreMix')}
        infoKey="scoreMix"
        onInfo={onInfo}
        right={formSeries.scoreMix.length >= 2
          ? <DamageHeader damage={formSeries.damage} onInfo={onInfo} />
          : null}
      >
        <ScoreMixColumns rounds={formSeries.scoreMix} damage={formSeries.damage} />
      </SectionCard>

      <SectionCard title={t('stats.tab.form.steadyHoles')} infoKey="steadyHoles" onInfo={onInfo}>
        <TrendLineChart
          series={formSeries.steadyPct}
          color={toneColor(theme, toneOfSeries(formSeries.steadyPct, { tolerance: 1 }))}
          variant="compact"
          formatValue={(v) => `${formatNumber(v)}%`}
          dropGaps
        />
        <Text style={s.steadyCaption}>{t('stats.tab.form.steadyCaption')}</Text>
      </SectionCard>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    steadyCaption: { ...theme.typography.tiny, color: theme.text.muted },
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

export default React.memo(FormTab);
