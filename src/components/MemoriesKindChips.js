import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export default function MemoriesKindChips({ counts, active, onChange }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const kinds = [
    { key: 'all', label: `Todo · ${counts.all}`, icon: null },
    { key: 'photo', label: `Foto · ${counts.photo}`, icon: 'camera' },
    { key: 'video', label: `Vídeo · ${counts.video}`, icon: 'video' },
  ];

  return (
    <View style={s.row}>
      {kinds.map((k) => {
        const on = active === k.key;
        return (
          <TouchableOpacity
            key={k.key}
            style={[s.chip, on && s.chipOn]}
            onPress={() => onChange(k.key)}
            accessibilityLabel={k.label}
          >
            {k.icon ? (
              <Feather
                name={k.icon}
                size={12}
                color={on ? theme.text.inverse : theme.text.primary}
                style={{ marginRight: 4 }}
              />
            ) : null}
            <Text style={[s.label, on && s.labelOn]}>{k.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.bg.secondary,
  },
  chipOn: { backgroundColor: theme.accent.primary },
  label: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12,
    color: theme.text.primary,
  },
  labelOn: { color: theme.text.inverse },
});
