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

  const holes = Array.from(holesWithMedia).sort((a, b) => a - b);

  if (holes.length === 0) return null;

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>POR HOYO</Text>
        <Text style={s.count}>{holes.length} / {maxHoles}</Text>
      </View>
      <View style={s.grid}>
        {holes.map((i) => {
          const on = activeHole === i;
          return (
            <TouchableOpacity
              key={i}
              style={[s.cell, on && s.cellOn]}
              activeOpacity={0.7}
              onPress={() => onSelect(on ? null : i)}
              accessibilityLabel={`Hoyo ${i + 1}${on ? ', filtrado' : ''}`}
            >
              <Text style={[s.cellLabel, on && s.cellLabelOn]}>{i + 1}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  wrap: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 17,
    backgroundColor: theme.bg.primary,
    borderWidth: 1,
    borderColor: theme.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellOn: {
    backgroundColor: theme.accent.primary,
  },
  cellLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: theme.text.primary,
  },
  cellLabelOn: { color: theme.text.inverse },
});
