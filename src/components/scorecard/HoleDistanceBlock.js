import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';

// Right-hand side of the hole header: live GPS distances to the green, or —
// when the player isn't on the hole (or has no fix) — the same distances
// measured from the tee, and the tap target that opens the hole map sheet.
// Renders nothing when the course has no geometry, or when location is
// denied and there's no tee to fall back to.
export function HoleDistanceBlock({ gps, onPress }) {
  const { theme } = useTheme();
  const { units } = useAppSettings();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!gps?.available) return null;

  const fmt = (meters) => formatDistance(meters, units);
  const { distances, accuracy, source } = gps;
  // Same thresholds as the old strip: >3km = not on the course; >25m = the
  // fix is too loose to trust to the meter.
  const offCourse = source !== 'tee' && distances && distances.center > 3000;
  const poorFix = accuracy != null && accuracy > 25;
  // One entry per hazard kind — the nearest ahead is the one in play.
  const bunker = distances?.hazards?.find((h) => h.kind === 'bunker');
  const water = distances?.hazards?.find((h) => h.kind === 'water');
  const hazardLine = [
    bunker && `Bunker ${fmt(bunker.reach)}–${fmt(bunker.carry)}`,
    water && `Water ${fmt(water.reach)}–${fmt(water.carry)}`,
  ].filter(Boolean).join(' · ');

  if (source === 'tee' && distances) {
    return (
      <Pressable onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
        <Text style={s.overline}>FROM TEE</Text>
        <View style={s.heroRow}>
          <Text style={s.hero}>{fmt(distances.center)}</Text>
          <Text style={s.unit}>{unitSuffix(units)}</Text>
          <Feather name="chevron-right" size={14} color={theme.text.muted} />
        </View>
        <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
        {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
      {distances?.kind === 'nearest' && <Text style={s.overline}>NEAREST GREEN</Text>}
      {offCourse ? (
        <Text style={s.off}>{`Off course · ${(distances.center / 1000).toFixed(1)} km`}</Text>
      ) : distances ? (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={13} color={theme.accent.primary} />
            <Text style={s.hero}>{fmt(distances.center)}</Text>
            <Text style={s.unit}>{unitSuffix(units)}</Text>
            <Feather name="chevron-right" size={14} color={theme.text.muted} />
          </View>
          <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
          {poorFix && <Text style={s.caption}>{`±${Math.round(accuracy)}m`}</Text>}
          {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
        </>
      ) : (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={13} color={theme.accent.primary} />
            <Text style={s.hero}>…</Text>
          </View>
          <Text style={s.caption}>Getting GPS fix</Text>
        </>
      )}
    </Pressable>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    block: { alignItems: 'flex-end', gap: 1 },
    overline: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
    },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    hero: {
      color: theme.accent.primary,
      fontSize: 24,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: -0.5,
      fontVariant: ['tabular-nums'],
    },
    unit: {
      color: theme.accent.primary,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    fb: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
    hzd: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontVariant: ['tabular-nums'],
    },
    caption: { color: theme.text.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
    off: {
      color: theme.text.muted,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontVariant: ['tabular-nums'],
    },
  });
}
