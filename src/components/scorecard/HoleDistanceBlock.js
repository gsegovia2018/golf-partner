import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { subscribeShots, getShotsVersion, getShots } from '../../store/shotStore';
import { recommendClub } from '../../lib/shotStats';
import { clubLabel } from '../../lib/clubs';
import { useTourTarget } from '../tour/tourTargets';

// Right-hand side of the hole header: live GPS distances to the green, or —
// when the player isn't on the hole (or has no fix) — the same distances
// measured from the tee, and the tap target that opens the hole map sheet.
// Renders nothing when the course has no geometry, or when location is
// denied and there's no tee to fall back to.
export function HoleDistanceBlock({ gps, onPress }) {
  const { theme } = useTheme();
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tourRef = useTourTarget('hole-distances');
  // Club to play for the distance to the green, from the player's own carry
  // averages (nominal fallback). Hooks stay above the early return.
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const center = gps?.distances?.center ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestion = useMemo(() => recommendClub(center, appSettings.bag, getShots()), [center, appSettings.bag, shotsVersion]);
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
      <Pressable ref={tourRef} onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
        <View style={s.heroRow}>
          <Text style={s.hero}>{fmt(distances.center)}</Text>
          <Text style={s.unit}>{unitSuffix(units)}</Text>
        </View>
        <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
        {suggestion && <Text style={s.club}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
        <Text style={s.mapHint}>TAP FOR MAP</Text>
        {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
      </Pressable>
    );
  }

  return (
    <Pressable ref={tourRef} onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
      {distances?.kind === 'nearest' && <Text style={s.overline}>NEAREST GREEN</Text>}
      {offCourse ? (
        <Text style={s.off}>{`Off course · ${(distances.center / 1000).toFixed(1)} km`}</Text>
      ) : distances ? (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={14} color={theme.accent.primary} />
            <Text style={s.hero}>{fmt(distances.center)}</Text>
            <Text style={s.unit}>{unitSuffix(units)}</Text>
          </View>
          <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
          {suggestion && <Text style={s.club}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
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
    club: {
      color: theme.accent.primary,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 0.2,
      marginTop: 1,
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
