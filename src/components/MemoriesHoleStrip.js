import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export default function MemoriesHoleStrip({
  maxHoles,
  holesWithMedia,
  activeHole,
  onSelect,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const holes = Array.from({ length: maxHoles }, (_, i) => i);
  const rows = [];
  for (let i = 0; i < holes.length; i += 9) rows.push(holes.slice(i, i + 9));

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>POR HOYO</Text>
        <Text style={s.count}>{holesWithMedia.size} / {maxHoles}</Text>
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={s.rowGrid}>
          {row.map((i) => {
            const has = holesWithMedia.has(i);
            const on = activeHole === i;
            return (
              <TouchableOpacity
                key={i}
                style={[s.cell, has && s.cellHas, on && s.cellOn]}
                activeOpacity={has ? 0.7 : 1}
                onPress={() => { if (has) onSelect(on ? null : i); }}
                disabled={!has}
                accessibilityLabel={`Hoyo ${i + 1}${has ? '' : ' sin recuerdos'}`}
              >
                <Text style={[
                  s.cellLabel,
                  has && s.cellLabelHas,
                  on && s.cellLabelOn,
                ]}>
                  {i + 1}
                </Text>
              </TouchableOpacity>
            );
          })}
          {Array.from({ length: 9 - row.length }).map((_, k) => (
            <View key={'pad' + k} style={s.cellPad} />
          ))}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
    letterSpacing: 0.6,
    color: theme.text.muted,
  },
  count: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10,
    color: theme.text.muted,
  },
  rowGrid: { flexDirection: 'row', marginBottom: 4, gap: 4 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 6,
    backgroundColor: theme.bg.primary,
    borderWidth: 1,
    borderColor: theme.bg.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellPad: { flex: 1, aspectRatio: 1 },
  cellHas: {
    backgroundColor: theme.bg.primary,
    borderColor: theme.accent.primary,
  },
  cellOn: {
    backgroundColor: theme.accent.primary,
    borderColor: theme.accent.primary,
  },
  cellLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    color: theme.text.muted,
  },
  cellLabelHas: { color: theme.text.primary },
  cellLabelOn: { color: theme.text.inverse },
});
