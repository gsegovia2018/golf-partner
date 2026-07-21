import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import Reveal from '../ui/Reveal';
import { calloutSub } from './reportCardView';

// Twin summary tiles (hybrid option C): bright spots on the left, cost-you-
// points on the right, one row per rank. A missing side renders a spacer so
// the grid stays aligned. Renders nothing when there are no callouts at all.
export default function ReportCalloutTiles({ callouts }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const bright = callouts?.bright ?? [];
  const cost = callouts?.cost ?? [];
  const rowCount = Math.max(bright.length, cost.length);
  if (rowCount === 0) return null;

  const rows = Array.from({ length: rowCount }, (_, i) => ({
    bright: bright[i] ?? null,
    cost: cost[i] ?? null,
  }));

  return (
    <View style={s.wrap}>
      {rows.map((row, i) => (
        <Reveal key={row.bright?.label ?? row.cost?.label ?? i} delay={140 + i * 60} dy={9} duration={400} style={s.row}>
          {row.bright ? (
            <View style={[s.tile, s.tileGood]}>
              <Text style={[s.kicker, { color: theme.accent.primary }]}>BRIGHT SPOT</Text>
              <Text style={s.label}>{row.bright.label}</Text>
              <Text style={s.sub}>{calloutSub(row.bright)}</Text>
            </View>
          ) : <View style={s.spacer} />}
          {row.cost ? (
            <View style={[s.tile, s.tileBad]}>
              <Text style={[s.kicker, { color: theme.destructive }]}>COST YOU POINTS</Text>
              <Text style={s.label}>{row.cost.label}</Text>
              <Text style={s.sub}>{calloutSub(row.cost)}</Text>
            </View>
          ) : <View style={s.spacer} />}
        </Reveal>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    row: { flexDirection: 'row', gap: 8 },
    tile: { flex: 1, borderRadius: theme.radius.lg, paddingVertical: 11, paddingHorizontal: 12 },
    tileGood: { backgroundColor: theme.accent.light },
    // Mirrors tileGood: green wash = went well, red wash = cost you.
    tileBad: { backgroundColor: theme.isDark ? 'rgba(248,113,113,0.10)' : 'rgba(200,16,46,0.07)' },
    spacer: { flex: 1 },
    kicker: { fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1 },
    label: { fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, marginTop: 3 },
    sub: {
      fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
      marginTop: 1, fontVariant: ['tabular-nums'],
    },
  });
}
