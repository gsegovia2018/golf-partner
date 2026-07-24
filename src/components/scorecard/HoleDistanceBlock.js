import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { formatDistance, unitSuffix } from '../../lib/units';
import { recommendClub } from '../../lib/shotStats';
import { getShots, subscribeShots, getShotsVersion } from '../../store/shotStore';
import { useTourTarget } from '../tour/tourTargets';

// Right-hand side of the hole header: live GPS distances to the green, or —
// when the player isn't on the hole (or has no fix) — the same distances
// measured from the tee, and the tap target that opens the hole map sheet.
// Renders nothing when the course has no geometry, or when location is
// denied and there's no tee to fall back to. The live GPS view also shows the
// recommended club for the center distance (driver excluded once the fix is
// past the tee box); the tee-sourced view is distance only — no club — plus a
// GPS-health status line (working-far / locating / location-off) so a tee
// number isn't mistaken for a dead GPS. That line is hidden when GPS is off.
export function HoleDistanceBlock({
  gps, onPress, compact = false,
}) {
  const { theme } = useTheme();
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tourRef = useTourTarget(compact ? null : 'hole-distances');

  // Club suggestion for the distance shown in the chip (center to green).
  // Subscribed to the shot store so it re-picks as the player's carry
  // averages evolve. Computed before the early return to keep hook order stable.
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const club = useMemo(
    () => recommendClub(gps?.distances?.center, appSettings.bag, getShots(), appSettings.clubDistances, { excludeDriver: !!gps?.offTee }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gps?.distances?.center, gps?.offTee, appSettings.bag, appSettings.clubDistances, shotsVersion],
  );

  if (!gps?.available) return null;

  const fmt = (meters) => formatDistance(meters, units);
  const { accuracy, source, distances, fixState } = gps;

  // GPS health line, shown only on the tee-sourced view (where the number
  // alone can't say whether GPS is alive). 'disabled' surfaces nothing — the
  // player turned GPS off, so there's nothing to reassure or fix. 'denied'
  // is the only actionable state: tapping it opens the OS location settings.
  const pick = (t) => (t ? t[theme.isDark ? 'dark' : 'light'] : theme.text.muted);
  const STATUS = {
    ok:        { color: pick(theme.semantic?.score?.good), label: 'GPS OK · far away' },
    acquiring: { color: pick(theme.semantic?.warning),     label: 'Locating GPS…' },
    denied:    { color: pick(theme.semantic?.destructive), label: 'Location off', action: true },
  };
  const status = fixState && fixState !== 'disabled' ? STATUS[fixState] : null;

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
        {!!status && (
          status.action ? (
            <Pressable
              onPress={() => { try { Linking.openSettings?.(); } catch { /* web / unsupported */ } }}
              hitSlop={6}
              style={s.status}
              accessibilityRole="button"
              accessibilityLabel="Location off — open settings"
            >
              <View style={[s.statusDot, { backgroundColor: status.color }]} />
              <Text style={[s.statusTxt, { color: status.color }]}>{status.label}</Text>
            </Pressable>
          ) : (
            <View style={s.status}>
              <View style={[s.statusDot, { backgroundColor: status.color }]} />
              <Text style={[s.statusTxt, { color: status.color }]}>{status.label}</Text>
            </View>
          )
        )}
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
          {!!club && <Text style={s.club}>{club.label}</Text>}
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
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: 0.3,
      marginTop: 1,
    },
    hzd: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontVariant: ['tabular-nums'],
    },
    caption: { color: theme.text.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 5,
      paddingTop: 6,
      borderTopWidth: 1,
      borderTopColor: theme.border.default,
      alignSelf: 'stretch',
      justifyContent: 'center',
    },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusTxt: {
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
    },
    compactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    compactDist: {
      color: theme.accent.primary,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
    },
  });
}
