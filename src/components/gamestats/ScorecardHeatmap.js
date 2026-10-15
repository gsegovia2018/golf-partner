// Scorecard heatmap for one round: a fixed Hole / Par / SI column and one
// column per player (scrolls sideways when the group is wide). Each cell
// prints its Stableford points over a heat tint, a superscript marks the
// handicap strokes received, and an unplayed hole is a dashed empty cell.
// Out / In / Tot rows close each nine (a 9-hole round has Tot only).
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { heatColors, shortName } from './ui';

const ROW_H = 30;
const KEY_W = 34;
const CELL_W = 56;
const SUP = ['', '¹', '²', '³'];

export default function ScorecardHeatmap({ grid, players }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);

  // Hole rows with the Out total slotted in after hole 9.
  const lines = [];
  grid.holes.forEach((h, i) => {
    lines.push({ kind: 'hole', h });
    if (!grid.nine && i === 8) lines.push({ kind: 'total', total: grid.totals.find((x) => x.key === 'out') });
  });
  grid.totals.filter((x) => x.key !== 'out').forEach((total) => lines.push({ kind: 'total', total }));
  const totalLabel = (key) => t(`stats.game.card.${key}`);

  const keyCol = (
    <View style={s.keyCol}>
      <View style={[s.row, s.head]}>
        <Text style={[s.keyText, s.headText, s.keyH]}>{t('stats.game.card.hole')}</Text>
        <Text style={[s.keyText, s.headText]}>{t('stats.game.card.par')}</Text>
        <Text style={[s.keyText, s.headText]}>{t('stats.game.card.si')}</Text>
      </View>
      {lines.map((ln, i) => (ln.kind === 'hole' ? (
        <View key={`k${i}`} style={s.row}>
          <Text style={[s.keyText, s.keyH, s.holeNum]}>{ln.h.number}</Text>
          <Text style={s.keyText}>{ln.h.par}</Text>
          <Text style={s.keyText}>{ln.h.si}</Text>
        </View>
      ) : (
        <View key={`k${i}`} style={[s.row, s.totalRow]}>
          <Text style={[s.keyText, s.keyH, s.totalText]}>{totalLabel(ln.total.key)}</Text>
          <Text style={[s.keyText, s.totalText]}>{ln.total.par}</Text>
          <Text style={s.keyText} />
        </View>
      )))}
    </View>
  );

  return (
    <View style={s.wrap} testID="scorecard-heatmap">
      {keyCol}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.scroll}>
        <View>
          <View style={[s.row, s.head]}>
            {players.map((p) => (
              <Text key={p.id} style={[s.cellW, s.headText, s.nameHead]} numberOfLines={1}>{shortName(p, players)}</Text>
            ))}
          </View>
          {lines.map((ln, i) => (
            <View key={`r${i}`} style={[s.row, ln.kind === 'total' && s.totalRow]}>
              {ln.kind === 'hole'
                ? ln.h.cells.map((c, ci) => {
                  if (c.points == null) {
                    return (
                      <View key={c.playerId} style={s.cellW}>
                        <View style={[s.cell, s.cellEmpty]} accessibilityLabel={t('stats.game.card.notPlayed')} />
                      </View>
                    );
                  }
                  const { bg, fg } = heatColors(theme, c.points);
                  return (
                    <View key={c.playerId} style={s.cellW}>
                      <View
                        style={[s.cell, { backgroundColor: bg }]}
                        accessibilityLabel={t('stats.game.card.cellA11y', {
                          name: shortName(players[ci], players), hole: ln.h.number, points: c.points, strokes: c.strokes,
                        })}
                      >
                        <Text style={[s.cellText, { color: fg }]}>
                          {c.points}
                          {c.extra > 0 ? <Text style={[s.sup, { color: fg }]}>{SUP[Math.min(c.extra, 3)]}</Text> : null}
                        </Text>
                      </View>
                    </View>
                  );
                })
                : ln.total.values.map((v, vi) => (
                  <Text key={`t${vi}`} style={[s.cellW, s.totalText, s.totalValue]}>{v ?? '–'}</Text>
                ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// The colour key under the heatmap.
export function HeatLegend() {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.legend}>
      {[0, 1, 2, 3, 4].map((p) => (
        <View key={p} style={s.legendItem}>
          <View style={[s.legendSwatch, { backgroundColor: heatColors(theme, p).bg }]} />
          <Text style={s.legendText}>{p === 4 ? '4+' : p}</Text>
        </View>
      ))}
      <Text style={s.legendText}>{t('stats.game.card.legend')}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { flexDirection: 'row' },
    keyCol: { borderRightWidth: 1, borderRightColor: theme.border.default },
    scroll: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', height: ROW_H },
    head: { height: 26 },
    totalRow: { backgroundColor: theme.bg.secondary },
    keyText: {
      width: KEY_W, textAlign: 'center', fontFamily: 'PlusJakartaSans-Medium', fontSize: 11,
      color: theme.text.secondary, fontVariant: ['tabular-nums'],
    },
    keyH: { width: KEY_W + 4 },
    holeNum: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    headText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, color: theme.text.secondary, textTransform: 'uppercase' },
    nameHead: { textAlign: 'center', textTransform: 'none', fontSize: 11 },
    cellW: { width: CELL_W, alignItems: 'center', justifyContent: 'center' },
    cell: { width: CELL_W - 8, height: ROW_H - 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    cellEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border.default },
    cellText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, fontVariant: ['tabular-nums'] },
    sup: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 10 },
    totalText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary },
    totalValue: { textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
    legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendSwatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: theme.border.default },
    legendText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: theme.text.secondary },
  });
}
