import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// A league card's holes, nine per row: strokes in a shape (circle = 3+ points,
// square = 0), points underneath. A hole capped at net double bogey gets a
// dashed ring and a small badge with the number that counts for the
// differential. `perHole` is leagueView.cardBreakdown's list.
export default function CardHoleGrid({ perHole }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const good = theme.scoreColor('excellent');
  const zero = theme.destructive;
  const halves = [
    { label: 'OUT', cells: perHole.slice(0, 9) },
    { label: 'IN', cells: perHole.slice(9, 18) },
  ].filter((h) => h.cells.length > 0);
  const anyCapped = perHole.some((h) => h.capped);

  return (
    <View>
      {halves.map((h) => {
        const strokes = h.cells.reduce((a, c) => a + c.strokes, 0);
        const points = h.cells.reduce((a, c) => a + c.points, 0);
        return (
          <View key={h.label} style={s.half}>
            {h.cells.map((c, i) => {
              const ring = c.capped ? { borderWidth: 2, borderStyle: 'dashed', borderColor: zero }
                : c.points >= 3 ? { borderWidth: 2, borderColor: good, borderRadius: 13 }
                  : c.points === 0 ? { borderWidth: 2, borderColor: zero } : null;
              return (
                <View
                  key={c.n}
                  style={[s.cell, i > 0 && s.cellEdge]}
                  accessible
                  accessibilityLabel={`Hole ${c.n}, ${c.strokes} strokes, ${c.points} points${c.capped ? `, counts as ${c.counted}` : ''}`}
                >
                  <Text style={s.holeNo}>{c.n}</Text>
                  <View style={[s.shape, ring]}>
                    <Text style={s.strokes}>{c.strokes}</Text>
                    {c.capped && (
                      <View style={s.badge}>
                        <Text style={s.badgeText}>{c.counted}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[s.pts, { color: c.points >= 3 ? good : c.points === 0 ? zero : theme.text.secondary }]}>{c.points}</Text>
                </View>
              );
            })}
            <View style={[s.cell, s.cellEdge, s.total]}>
              <Text style={s.holeNo}>{h.label}</Text>
              <View style={s.shape}><Text style={s.strokes}>{strokes}</Text></View>
              <Text style={[s.pts, { color: good }]}>{points}</Text>
            </View>
          </View>
        );
      })}
      <Text style={s.legend}>
        {`○ 3+ pts   □ 0 pts   small number = points${anyCapped ? '   dashed = capped, badge counts' : ''}`}
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  const line = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    half: {
      flexDirection: 'row', borderWidth: 1, borderColor: line, borderRadius: 12,
      overflow: 'hidden', marginBottom: 10, backgroundColor: theme.bg.card,
    },
    cell: { flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 8, gap: 3 },
    cellEdge: { borderLeftWidth: 1, borderLeftColor: line },
    total: { backgroundColor: theme.bg.secondary },
    holeNo: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 10 },
    shape: { width: 26, height: 26, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
    strokes: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 15 },
    pts: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
    badge: {
      position: 'absolute', top: -7, right: -9, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3,
      backgroundColor: theme.semantic.conflict.base, alignItems: 'center', justifyContent: 'center',
    },
    badgeText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.semantic.conflict.ink, fontSize: 9 },
    legend: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 11, textAlign: 'center',
    },
  });
}
