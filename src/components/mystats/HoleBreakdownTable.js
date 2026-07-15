import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { toneColor } from './metricTone';

// Hole-by-hole rows for one course — see buildCourseBreakdown().holes in
// store/courseBreakdown.js. Renders nothing when there are no rows.
export default function HoleBreakdownTable({ holes }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!holes || holes.length === 0) return null;

  return (
    <View style={s.table}>
      <View style={s.headRow}>
        <Text style={[s.headCell, s.holeCol]}>Hole</Text>
        <Text style={s.headNum}>Avg</Text>
        <Text style={s.headNum}>Best</Text>
        <Text style={s.headNum}>Pts</Text>
      </View>
      {holes.map((h) => <HoleRow key={h.holeNumber} hole={h} s={s} theme={theme} />)}
    </View>
  );
}

function HoleRow({ hole, s, theme }) {
  // Under par on average is genuinely good; more than half a stroke over is
  // where a hole starts costing real points.
  const tone = hole.avgVsPar < 0 ? 'good' : hole.avgVsPar > 0.5 ? 'bad' : 'neutral';
  const vsPar = hole.avgVsPar > 0 ? `+${hole.avgVsPar}` : `${hole.avgVsPar}`;
  const detail = [
    hole.avgPutts != null ? `${hole.avgPutts} putts avg` : null,
    hole.penalties > 0 ? `${hole.penalties} pen` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View
      style={s.row}
      accessible
      accessibilityLabel={
        `Hole ${hole.holeNumber}, par ${hole.par}, average ${hole.avgStrokes} strokes, best ${hole.bestStrokes}`
      }
    >
      <View style={s.holeCol}>
        <Text style={s.holeNum}>{hole.holeNumber}</Text>
        <Text style={s.holeMeta}>
          {`Par ${hole.par}${hole.strokeIndex != null ? ` · SI ${hole.strokeIndex}` : ''} · ${hole.timesPlayed}x`}
        </Text>
        {detail ? <Text style={s.holeMeta}>{detail}</Text> : null}
      </View>
      <View style={s.numCol}>
        <Text style={[s.num, { color: toneColor(theme, tone) }]}>{hole.avgStrokes}</Text>
        <Text style={s.numMeta}>{vsPar}</Text>
      </View>
      <View style={s.numCol}>
        <Text style={s.num}>{hole.bestStrokes}</Text>
      </View>
      <View style={s.numCol}>
        <Text style={s.num}>{hole.avgPoints}</Text>
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    table: { gap: 4 },
    headRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: theme.spacing.sm, paddingBottom: 2,
    },
    headCell: {
      ...theme.typography.tiny, color: theme.text.muted,
      fontWeight: '700', textTransform: 'uppercase',
    },
    headNum: {
      ...theme.typography.tiny, color: theme.text.muted,
      fontWeight: '700', textTransform: 'uppercase',
      width: 52, textAlign: 'center',
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
      borderRadius: theme.radius.md, backgroundColor: theme.bg.card,
    },
    holeCol: { flex: 1, minWidth: 0, gap: 1 },
    numCol: { width: 52, alignItems: 'center' },
    holeNum: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    holeMeta: { ...theme.typography.caption, color: theme.text.secondary },
    num: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    numMeta: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
