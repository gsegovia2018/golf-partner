import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { subscribeShots, getShotsVersion, getShots, shotsForHole } from '../../store/shotStore';
import {
  holeFeatures, haversineMeters,
  subscribeCourseGeometry, getCourseGeometryVersion,
} from '../../lib/geo';
import { recommendClub } from '../../lib/shotStats';
import { clubLabel } from '../../lib/clubs';
import { usePlayConditions } from '../../hooks/usePlayConditions';
import { useTourTarget } from '../tour/tourTargets';

// Right-hand side of the hole header: live GPS distances to the green, or —
// when the player isn't on the hole (or has no fix) — the same distances
// measured from the tee, and the tap target that opens the hole map sheet.
// Renders nothing when the course has no geometry, or when location is
// denied and there's no tee to fall back to.
export function HoleDistanceBlock({
  gps, courseName, holeNumber, roundId, roundIndex, onPress,
}) {
  const { theme } = useTheme();
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tourRef = useTourTarget('hole-distances');
  // Club to play for the distance to the green, from the player's own carry
  // averages (nominal fallback). Under the conditions toggle the target is the
  // "plays like" distance (temp + elevation), so the club matches today's air.
  // Hooks stay above the early return.
  const cond = usePlayConditions(courseName);
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // Subscribe so a new shot / edited geometry re-renders this block.
  useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  const center = gps?.distances?.center ?? null;

  // Distance the recommendation plays FROM. Once a ball is marked on this hole,
  // measure the last spot → green (200m drive on a 300m par 4 leaves ~100m, so
  // the club drops to a wedge). No shots yet → the live GPS-to-green number.
  const lastShot = roundId != null
    ? shotsForHole(roundId, roundIndex, holeNumber).at(-1) : null;
  const green = lastShot ? holeFeatures(courseName, holeNumber)?.greenCenter : null;
  const remaining = green ? haversineMeters([lastShot.lat, lastShot.lng], green) : null;

  const baseTarget = remaining ?? center;
  const playTarget = baseTarget != null ? cond.plays(baseTarget) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestion = useMemo(() => recommendClub(playTarget, appSettings.bag, getShots()), [playTarget, appSettings.bag, shotsVersion]);
  // "Xm left" once measuring from a marked shot; else the conditions "plays" note.
  const leftNote = remaining != null
    ? `${formatDistance(playTarget, units)}${unitSuffix(units)} left`
    : (cond.enabled && center != null && Math.round(playTarget) !== Math.round(center)
      ? `plays ${formatDistance(playTarget, units)}${unitSuffix(units)}` : null);
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
        {leftNote && <Text style={s.plays}>{leftNote}</Text>}
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
          {leftNote && <Text style={s.plays}>{leftNote}</Text>}
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
    plays: {
      color: theme.text.muted,
      fontSize: 10,
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
