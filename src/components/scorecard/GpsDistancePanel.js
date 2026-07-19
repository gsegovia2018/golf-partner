import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

function fmt(meters) {
  return meters == null ? '—' : `${Math.round(meters)}`;
}

// Compact live-GPS strip: distances (meters) to front/center/back of the
// current hole's green, plus a second row for the nearest bunker/water ahead
// (reach–carry range) when the hole has hazard geometry. Renders nothing when
// the course has no geometry data or location is denied. `kind: 'nearest'`
// marks courses without per-hole numbering, where the target is the nearest
// mapped green.
export function GpsDistancePanel({ gps, onPress }) {
  const { theme } = useTheme();
  const { available, distances, accuracy } = gps;
  const s = useMemo(() => makeStyles(theme), [theme]);

  if (!available) return null;
  const Container = onPress ? Pressable : View;

  // More than 3km from the target green: the player isn't on the course —
  // a 6-digit meter count would just look frozen/broken.
  const offCourse = distances && distances.center > 3000;
  const poorFix = accuracy != null && accuracy > 25;
  // One entry per hazard kind — the nearest ahead is the one in play.
  const bunker = distances?.hazards?.find((h) => h.kind === 'bunker');
  const water = distances?.hazards?.find((h) => h.kind === 'water');
  return (
    <Container style={s.panel} onPress={onPress}>
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
        {onPress && <Feather name="map" size={15} color={theme.accent.primary} style={{ marginLeft: distances && !offCourse ? 6 : 'auto' }} />}
      </View>
      {!offCourse && (bunker || water) && (
        <View style={s.hazardRow}>
          {bunker && (
            <View style={s.hazard}>
              <Feather name="circle" size={11} color={theme.text.muted} />
              <Text style={s.hazardText}>
                <Text style={s.tag}>Bunker </Text>
                {fmt(bunker.reach)}–{fmt(bunker.carry)}
              </Text>
            </View>
          )}
          {water && (
            <View style={s.hazard}>
              <Feather name="droplet" size={11} color={theme.accent.primary} />
              <Text style={s.hazardText}>
                <Text style={s.tag}>Water </Text>
                {fmt(water.reach)}–{fmt(water.carry)}
              </Text>
            </View>
          )}
          <Text style={s.unit}>m</Text>
        </View>
      )}
    </Container>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    panel: {
      marginHorizontal: 12,
      marginTop: 6,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.accent.primary + '30',
      backgroundColor: theme.isDark ? theme.accent.primary + '18' : theme.bg.card,
    },
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    hazardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.accent.primary + '30',
    },
    hazard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    hazardText: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
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
