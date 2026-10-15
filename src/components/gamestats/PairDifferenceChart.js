// Pair vs pair, hole by hole: the running Stableford gap between the two
// pairs of a team round. Bars above the baseline = pair A ahead. The value
// axis lives in its own gutter so its labels never sit on the bars.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { firstName, num } from './ui';

const H = 140;
const HALF = H / 2;
const GUTTER = 36;

export default function PairDifferenceChart({ data }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const andSep = t('stats.screen.andSep');
  const a = data.pair1.map(firstName).join(andSep);
  const b = data.pair2.map(firstName).join(andSep);
  const max = Math.max(1, data.maxAbs);
  const scale = (HALF - 4) / max;
  const leader = data.finalDelta > 0 ? a : b;

  return (
    <View testID="pair-difference-chart">
      <View style={s.legend}>
        <View style={[s.dot, { backgroundColor: theme.pairA }]} />
        <Text style={s.legendText} numberOfLines={1}>{a}</Text>
        <Text style={s.vs}>{t('shared.teams.vs')}</Text>
        <View style={[s.dot, { backgroundColor: theme.pairB }]} />
        <Text style={s.legendText} numberOfLines={1}>{b}</Text>
      </View>
      <View style={s.chartRow}>
        <View style={s.gutter}>
          <Text style={[s.axis, { top: 0 }]}>+{num(max)}</Text>
          <Text style={[s.axis, { top: HALF - 7 }]}>0</Text>
          <Text style={[s.axis, { bottom: 0 }]}>−{num(max)}</Text>
        </View>
        <View style={s.plot}>
          <View style={[s.baseline, { top: HALF }]} />
          {data.holes.map((h) => {
            const played = h.holeDelta != null;
            const v = played ? h.cumulative : 0;
            const height = Math.max(v !== 0 ? 2 : 0, Math.abs(v) * scale);
            return (
              <View key={h.holeNumber} style={s.col}>
                {played && v > 0 && <View style={[s.bar, { bottom: HALF, height, backgroundColor: theme.pairA }]} />}
                {played && v < 0 && <View style={[s.bar, { top: HALF, height, backgroundColor: theme.pairB }]} />}
              </View>
            );
          })}
        </View>
      </View>
      <View style={[s.chartRow, { marginTop: 4 }]}>
        <View style={{ width: GUTTER }} />
        <View style={s.xRow}>
          {data.holes.map((h, i) => (
            <Text key={h.holeNumber} style={s.xLabel}>{(i + 1) % 3 === 0 || i === 0 ? h.holeNumber : ''}</Text>
          ))}
        </View>
      </View>
      <Text style={s.summary}>
        {data.finalDelta === 0
          ? t('stats.game.pairDiff.level', { changes: data.crossovers })
          : t('stats.game.pairDiff.final', { leader, n: num(Math.abs(data.finalDelta)), changes: data.crossovers })}
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.primary, flexShrink: 1 },
    vs: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary, marginHorizontal: 4 },
    chartRow: { flexDirection: 'row' },
    gutter: { width: GUTTER, height: H },
    axis: {
      position: 'absolute', right: 6, fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: theme.text.secondary,
      fontVariant: ['tabular-nums'],
    },
    plot: { flex: 1, height: H, flexDirection: 'row' },
    baseline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: theme.border.default },
    col: { flex: 1, height: H, marginHorizontal: 1 },
    bar: { position: 'absolute', left: 0, right: 0, borderRadius: 2 },
    xRow: { flex: 1, flexDirection: 'row' },
    xLabel: {
      flex: 1, textAlign: 'center', fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: theme.text.secondary,
    },
    summary: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.secondary, marginTop: 8 },
  });
}
