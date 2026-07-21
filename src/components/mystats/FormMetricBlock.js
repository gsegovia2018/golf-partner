import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import TrendLineChart from './TrendLineChart';

// One Form-tab metric: a header (name, Recent vs History, trend chip) above a
// compact labelled line chart.
//   metric: { key, label, recent, history, delta, direction } (from stats.form)
//   series: [{ label, value }] (from stats.formSeries.metrics[key])
export default function FormMetricBlock({ metric, series, color, formatValue, infoKey, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const trendColor = metric.direction === 'up' ? theme.accent.primary
    : metric.direction === 'down' ? theme.destructive : theme.text.muted;
  const arrow = metric.direction === 'up' ? '▲' : metric.direction === 'down' ? '▼' : '—';
  const sign = metric.delta != null && metric.delta > 0 ? '+' : '';
  const fmt = formatValue || ((v) => `${v}`);

  return (
    <View style={s.block}>
      <View style={s.top}>
        <View style={s.nameWrap}>
          <Text style={s.name}>{metric.label}</Text>
          {infoKey && onInfo ? (
            <TouchableOpacity
              onPress={() => onInfo(infoKey)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`What is ${metric.label}`}
            >
              <Feather name="info" size={14} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={s.right}>
          <Text style={s.vs}>
            <Text style={s.vsStrong}>{fmt(metric.recent)}</Text>
            {metric.history != null ? `  vs ${fmt(metric.history)}` : ''}
          </Text>
          <Text style={[s.trend, { color: trendColor }]}>
            {metric.delta == null ? '—' : `${arrow} ${sign}${metric.delta}`}
          </Text>
        </View>
      </View>
      <TrendLineChart series={series} color={color} variant="compact" formatValue={fmt} />
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    block: {
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
    },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    name: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    right: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    vs: { ...theme.typography.caption, color: theme.text.muted },
    vsStrong: { color: theme.text.primary, fontWeight: '800' },
    trend: { ...theme.typography.caption, fontWeight: '800' },
  });
}
