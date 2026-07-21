import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { toneColor } from './metricTone';

// Hole-by-hole ledger for one course — see buildCourseBreakdown().holes in
// store/courseBreakdown.js. Renders nothing when there are no rows.
// Clubhouse ledger language: uppercase letterspaced column headers over a
// hairline, hairline-separated rows (no per-row card boxes), tone-colored
// "vs par" values. Optional `highlights` ({ nemesis, best } from
// buildCourseBreakdown) marks those holes with a small red / gold dot.
export default function HoleBreakdownTable({ holes, highlights }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!holes || holes.length === 0) return null;

  const nemesisHole = highlights?.nemesis?.holeNumber ?? null;
  const bestHole = highlights?.best?.holeNumber ?? null;

  return (
    <View style={s.table}>
      <View style={s.headRow}>
        <Text style={[s.headCell, s.holeCol]}>Hole</Text>
        <Text style={s.headNum}>Avg</Text>
        <Text style={s.headNum}>Best</Text>
        <Text style={s.headNum}>Pts</Text>
      </View>
      {holes.map((h, i) => (
        <HoleRow
          key={h.holeNumber}
          hole={h}
          last={i === holes.length - 1}
          isNemesis={h.holeNumber === nemesisHole}
          isBest={h.holeNumber === bestHole}
          s={s}
          theme={theme}
        />
      ))}
    </View>
  );
}

function HoleRow({ hole, last, isNemesis, isBest, s, theme }) {
  // Under par on average is genuinely good; more than half a stroke over is
  // where a hole starts costing real points.
  const tone = hole.avgVsPar < 0 ? 'good' : hole.avgVsPar > 0.5 ? 'bad' : 'neutral';
  const vsPar = hole.avgVsPar > 0 ? `+${hole.avgVsPar}` : `${hole.avgVsPar}`;
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const detail = [
    hole.avgPutts != null ? `${hole.avgPutts} putts avg` : null,
    hole.penalties > 0 ? `${hole.penalties} pen` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View
      style={[s.row, last && s.rowLast]}
      accessible
      accessibilityLabel={
        `Hole ${hole.holeNumber}, par ${hole.par}, average ${hole.avgStrokes} strokes, best ${hole.bestStrokes}`
        + (isNemesis ? ', nemesis hole' : '')
        + (isBest ? ', best hole' : '')
      }
    >
      <View style={s.holeCol}>
        <View style={s.holeNumRow}>
          <Text style={s.holeNum}>{hole.holeNumber}</Text>
          {isNemesis ? (
            <View testID="hole-dot-nemesis" style={[s.dot, { backgroundColor: theme.destructive }]} />
          ) : null}
          {isBest ? (
            <View testID="hole-dot-best" style={[s.dot, { backgroundColor: gold }]} />
          ) : null}
        </View>
        <Text style={s.holeMeta}>
          {`Par ${hole.par}${hole.strokeIndex != null ? ` · SI ${hole.strokeIndex}` : ''} · ${hole.timesPlayed}x`}
        </Text>
        {detail ? <Text style={s.holeMeta}>{detail}</Text> : null}
      </View>
      <View style={s.numCol}>
        <Text style={s.num}>{hole.avgStrokes}</Text>
        <Text style={[s.numMeta, { color: toneColor(theme, tone) }]}>{vsPar}</Text>
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
    table: {},
    headRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
    },
    headCell: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: theme.text.muted,
    },
    headNum: {
      fontSize: 9.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: theme.text.muted,
      width: 52, textAlign: 'center',
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
    },
    rowLast: { borderBottomWidth: 0 },
    holeCol: { flex: 1, minWidth: 0, gap: 1 },
    holeNumRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    holeNum: {
      fontSize: 14, lineHeight: 20,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
      color: theme.text.primary,
    },
    dot: { width: 6, height: 6, borderRadius: 3 },
    holeMeta: { fontSize: 11, fontFamily: 'PlusJakartaSans-Medium', lineHeight: 15, color: theme.text.muted },
    num: {
      fontSize: 14, lineHeight: 20,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
      color: theme.text.primary,
    },
    numMeta: {
      fontSize: 10, lineHeight: 14,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
  });
}
