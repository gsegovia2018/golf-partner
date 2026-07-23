import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { useTourTarget } from '../tour/tourTargets';

// Right-hand side of the hole header: live GPS distances to the green, or —
// when the player isn't on the hole (or has no fix) — the same distances
// measured from the tee, and the tap target that opens the hole map sheet.
// Renders nothing when the course has no geometry, or when location is
// denied and there's no tee to fall back to. The card shows ONLY the distance
// (live-to-green on the hole, tee-to-green off it) — no club recommendation.
export function HoleDistanceBlock({
  gps, onPress, compact = false,
}) {
  const { theme } = useTheme();
  const { units } = useAppSettings();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tourRef = useTourTarget(compact ? null : 'hole-distances');

  if (!gps?.available) return null;

  const fmt = (meters) => formatDistance(meters, units);
  const { accuracy, source, distances } = gps;

  // Belt-and-suspenders: the hook never yields a live GPS distance beyond 1 km,
  // so a >3 km non-tee reading would be a bug — hide it rather than render a
  // giant number. Tee distances (the hole length) are exempt.
  if (source !== 'tee' && distances && distances.center > 3000) return null;

  if (compact) {
    const c = distances?.center;
    if (c == null) return null;
    return (
      <Pressable onPress={onPress} hitSlop={8} style={s.compactRow} accessibilityRole="button" accessibilityLabel="Hole map">
        {/* Flag (not the live-GPS arrow) when the number is measured from the
            tee, so the slim bar doesn't imply a live-to-pin reading either. */}
        <Feather name={source === 'tee' ? 'flag' : 'navigation'} size={13} color={theme.accent.primary} />
        <Text style={s.compactDist}>{`${fmt(c)}${unitSuffix(units)}`}</Text>
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </Pressable>
    );
  }
  // >25m = the fix is too loose to trust to the meter. (Off-course far GPS is
  // already hidden above, so there's no "off course" state to render here.)
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
      <Pressable ref={tourRef} onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
        <View style={s.heroRow}>
          <Text style={s.hero}>{fmt(distances.center)}</Text>
          <Text style={s.unit}>{unitSuffix(units)}</Text>
        </View>
        <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
        <Text style={s.mapHint}>TAP FOR MAP</Text>
        {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
      </Pressable>
    );
  }

  return (
    <Pressable ref={tourRef} onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
      {distances?.kind === 'nearest' && <Text style={s.overline}>NEAREST GREEN</Text>}
      {distances ? (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={14} color={theme.accent.primary} />
            <Text style={s.hero}>{fmt(distances.center)}</Text>
            <Text style={s.unit}>{unitSuffix(units)}</Text>
          </View>
          <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
          <Text style={s.mapHint}>TAP FOR MAP</Text>
          {poorFix && <Text style={s.caption}>{`±${fmt(accuracy)}${unitSuffix(units)}`}</Text>}
          {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
        </>
      ) : (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={14} color={theme.accent.primary} />
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
    block: {
      alignItems: 'center',
      gap: 2,
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border ?? theme.border.default : theme.border.default,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
      minWidth: 128,
    },
    overline: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
    },
    mapHint: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
      marginTop: 2,
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
    compactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    compactDist: {
      color: theme.accent.primary,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
    },
  });
}
