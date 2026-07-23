import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { subscribeShots, getShotsVersion, getShots, shotsForHole } from '../../store/shotStore';
import {
  holeFeatures, haversineMeters, greenDistances, pointInPolygon,
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
  gps, courseName, holeNumber, roundId, roundIndex, onPress, compact = false,
}) {
  const { theme } = useTheme();
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tourRef = useTourTarget(compact ? null : 'hole-distances');
  // Club to play for the distance to the green, from the player's own carry
  // averages (nominal fallback). Under the conditions toggle the target is the
  // "plays like" distance (temp + elevation), so the club matches today's air.
  // Hooks stay above the early return.
  const cond = usePlayConditions(courseName);
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // Subscribe so a new shot / edited geometry re-renders this block.
  useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // Front/center/back all recompute from the last marked shot on this hole,
  // so once a ball is placed the whole block reads distance-to-green FROM the
  // ball (200m drive on a 300m par 4 → ~100m, club drops to a wedge). No shot
  // yet → the live GPS/tee distances from the gps prop.
  const lastShot = roundId != null
    ? shotsForHole(roundId, roundIndex, holeNumber).at(-1) : null;
  const feat = lastShot ? holeFeatures(courseName, holeNumber) : null;
  const from = lastShot ? [lastShot.lat, lastShot.lng] : null;
  const to = (pt) => (pt ? haversineMeters(from, pt) : null);
  // Ball finished on the green → putting. Polygon test, or within ~5m of the
  // centre when the hole only has a centre point. No yardage / club then.
  const onGreen = !!feat && (
    (feat.green && pointInPolygon(from, feat.green))
    || (!feat.green && feat.greenCenter && to(feat.greenCenter) <= 5)
  );
  // Front/back split the same way the live GPS strip does: nearest / farthest
  // green-polygon vertex from the ball. Admin front/back points win when set;
  // otherwise fall back to the polygon so F ≠ C ≠ B (not all the centre).
  let shotDist = null;
  if (feat?.greenCenter) {
    const raw = (feat.greenFront || feat.greenBack)
      ? {
        center: to(feat.greenCenter),
        front: to(feat.greenFront),
        back: to(feat.greenBack),
      }
      : greenDistances(from, feat.green, feat.greenCenter);
    // Center is the fallback when a hole has no polygon / no front-back points.
    shotDist = raw ? {
      center: raw.center,
      front: raw.front ?? raw.center,
      back: raw.back ?? raw.center,
    } : null;
  }

  const baseTarget = shotDist?.center ?? gps?.distances?.center ?? null;
  const playTarget = baseTarget != null ? cond.plays(baseTarget) : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestion = useMemo(() => recommendClub(playTarget, appSettings.bag, getShots(), appSettings.clubDistances), [playTarget, appSettings.bag, appSettings.clubDistances, shotsVersion]);

  // On the green: drop yardage + club entirely, just say putting.
  if (onGreen) {
    if (compact) {
      return (
        <Pressable onPress={onPress} hitSlop={8} style={s.compactRow} accessibilityRole="button" accessibilityLabel="Hole map">
          <Feather name="flag" size={13} color={theme.accent.primary} />
          <Text style={s.compactPutt}>Putting</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </Pressable>
      );
    }
    return (
      <Pressable ref={tourRef} onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
        <Feather name="flag" size={18} color={theme.accent.primary} />
        <Text style={s.putt}>Putting</Text>
        <Text style={s.mapHint}>TAP FOR MAP</Text>
      </Pressable>
    );
  }
  if (!gps?.available) return null;

  const fmt = (meters) => formatDistance(meters, units);
  const { accuracy, source } = gps;
  // Distances to render: from the marked shot when present, else the live fix.
  const distances = shotDist ? { ...gps.distances, ...shotDist } : gps.distances;

  if (compact) {
    const c = distances?.center;
    if (c == null) return null;
    if (source !== 'tee' && c > 3000) return null;
    return (
      <Pressable onPress={onPress} hitSlop={8} style={s.compactRow} accessibilityRole="button" accessibilityLabel="Hole map">
        {/* Flag (not the live-GPS arrow) when the number is measured from the
            tee, so the slim bar doesn't imply a live-to-pin reading either. */}
        <Feather name={source === 'tee' ? 'flag' : 'navigation'} size={13} color={theme.accent.primary} />
        <Text style={s.compactDist}>{`${fmt(c)}${unitSuffix(units)}`}</Text>
        {suggestion && <Text style={s.compactClub}>{`· ${clubLabel(suggestion.club)}`}</Text>}
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </Pressable>
    );
  }
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
        {/* You're off the hole (no live fix within 1 km), so this is the hole
            played from the tee — not a live distance to the pin. Label it so
            the number isn't mistaken for a GPS reading. */}
        <Text style={s.overline}>FROM TEE</Text>
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
    putt: {
      color: theme.accent.primary,
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: -0.3,
      marginTop: 2,
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
    compactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    compactDist: {
      color: theme.accent.primary,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
    },
    compactClub: {
      color: theme.accent.primary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    compactPutt: {
      color: theme.accent.primary,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
  });
}
