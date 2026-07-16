import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useGpsDistances } from '../../hooks/useGpsDistances';

function fmt(meters) {
  return meters == null ? '—' : `${Math.round(meters)}`;
}

// Compact live-GPS strip: distances (meters) to front/center/back of the
// current hole's green. Renders nothing when the course has no geometry data
// or location is denied. `kind: 'nearest'` marks courses without per-hole
// numbering, where the target is the nearest mapped green.
export function GpsDistancePanel({ courseName, holeNumber }) {
  const { theme } = useTheme();
  const { available, distances, accuracy } = useGpsDistances(courseName, holeNumber);
  const s = useMemo(() => makeStyles(theme), [theme]);

  if (!available) return null;

  // More than 3km from the target green: the player isn't on the course —
  // a 6-digit meter count would just look frozen/broken.
  const offCourse = distances && distances.center > 3000;
  const poorFix = accuracy != null && accuracy > 25;
  return (
    <View style={s.strip}>
      <Feather name="navigation" size={13} color={theme.accent.primary} />
      {offCourse ? (
        <Text style={s.label}>
          {`Off course — ${(distances.center / 1000).toFixed(1)} km from green`}
        </Text>
      ) : distances ? (
        <>
          <Text style={s.label}>
            {distances.kind === 'nearest' ? 'Nearest green' : 'Green'}
          </Text>
          <View style={s.values}>
            <Text style={s.value}><Text style={s.tag}>F </Text>{fmt(distances.front)}</Text>
            <Text style={s.value}><Text style={s.tag}>C </Text>{fmt(distances.center)}</Text>
            <Text style={s.value}><Text style={s.tag}>B </Text>{fmt(distances.back)}</Text>
            <Text style={s.unit}>m</Text>
          </View>
          {poorFix && <Text style={s.accuracy}>±{Math.round(accuracy)}m</Text>}
        </>
      ) : (
        <Text style={s.label}>Getting GPS fix…</Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 7,
      marginHorizontal: 12,
      marginTop: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.accent.primary + '30',
      backgroundColor: theme.isDark ? theme.accent.primary + '18' : theme.bg.card,
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.text.muted,
    },
    values: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 10,
      marginLeft: 'auto',
    },
    value: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
    tag: {
      fontSize: 10,
      fontWeight: '600',
      color: theme.text.muted,
    },
    unit: {
      fontSize: 11,
      color: theme.text.muted,
    },
    accuracy: {
      fontSize: 10,
      color: theme.text.muted,
    },
  });
}
