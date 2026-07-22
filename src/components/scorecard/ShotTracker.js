import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import PressableScale from '../ui/PressableScale';
import { useTheme } from '../../theme/ThemeContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  subscribeShots, getShotsVersion, getShots,
  shotsForHole, logShot, setShotClub, undoLastShot,
} from '../../store/shotStore';
import { haversineMeters } from '../../lib/geo';
import { recommendClub } from '../../lib/shotStats';
import { swingClubs, clubLabel } from '../../lib/clubs';
import { formatDistance, unitSuffix } from '../../lib/units';
import { haptic } from '../../lib/haptics';

// Per-hole GPS shot log on the "me" card. "Mark ball" captures the current
// fix (position matters — capture where you stand, before walking on), then
// you tag which club you hit from there. Carry = straight-line distance to the
// next marked shot, so club-on-shot-N + carry(N→N+1) feeds your bag averages.
// `gps` is the useGpsDistances result; its distances.center drives the club
// suggestion. Renders nothing off the active page unless the hole already has
// shots (so paging back still shows them).
export function ShotTracker({ roundId, roundIndex, holeNumber, gps, isActive }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // shotsVersion bumps when the shot store mutates — recompute the slice then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [pickFor, setPickFor] = useState(null); // shot id whose club sheet is open
  const pos = gps?.position ?? null;
  const targetMeters = gps?.distances?.center ?? null;
  const suggestion = useMemo(
    () => recommendClub(targetMeters, appSettings.bag, getShots()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings.bag, shotsVersion],
  );

  if (!roundId) return null;
  if (!isActive && shots.length === 0) return null;

  const carryOf = (i) => (i < shots.length - 1
    ? haversineMeters([shots[i].lat, shots[i].lng], [shots[i + 1].lat, shots[i + 1].lng])
    : null);

  const mark = async () => {
    if (!pos) return;
    haptic('light');
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos, club: suggestion?.club ?? null });
    setPickFor(shot.id); // let them confirm/change the club right away
  };

  const chooseClub = async (club) => {
    if (pickFor) await setShotClub(pickFor, club);
    setPickFor(null);
  };

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Text style={s.title}>SHOTS</Text>
        {shots.length > 0 && (
          <PressableScale
            onPress={() => { haptic('selection'); undoLastShot(roundId, roundIndex, holeNumber); }}
            style={s.undo}
            accessibilityRole="button"
            accessibilityLabel="Undo last shot"
          >
            <Feather name="corner-up-left" size={13} color={theme.text.muted} />
            <Text style={s.undoText}>Undo</Text>
          </PressableScale>
        )}
      </View>

      {shots.map((shot, i) => {
        const carry = carryOf(i);
        return (
          <View key={shot.id} style={s.shotRow}>
            <Text style={s.seq}>{i + 1}</Text>
            <PressableScale
              onPress={() => setPickFor(shot.id)}
              style={[s.clubPill, !shot.club && s.clubPillEmpty]}
              accessibilityRole="button"
              accessibilityLabel={shot.club ? `Club ${clubLabel(shot.club)}` : 'Set club'}
            >
              <Text style={[s.clubText, !shot.club && s.clubTextEmpty]}>
                {shot.club ? clubLabel(shot.club) : 'Set club'}
              </Text>
            </PressableScale>
            <Text style={s.carry}>
              {carry != null ? `${formatDistance(carry, units)} ${unitSuffix(units)}` : 'in play'}
            </Text>
          </View>
        );
      })}

      {isActive && (
        <PressableScale
          onPress={mark}
          disabled={!pos}
          style={[s.markBtn, !pos && s.markBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Mark ball at current position"
        >
          <Feather name="map-pin" size={15} color={pos ? theme.accent.primary : theme.text.muted} />
          <Text style={[s.markText, !pos && s.markTextDisabled]}>
            {pos ? 'Mark ball' : 'Waiting for GPS…'}
          </Text>
          {pos && suggestion && (
            <Text style={s.suggest}>
              {`≈ ${clubLabel(suggestion.club)}`}
            </Text>
          )}
        </PressableScale>
      )}

      <BottomSheet visible={!!pickFor} onClose={() => setPickFor(null)}>
        <Text style={s.sheetTitle}>Which club?</Text>
        <ScrollView style={s.sheetScroll}>
          <View style={s.sheetGrid}>
            {bag.map((club) => (
              <PressableScale
                key={club}
                onPress={() => chooseClub(club)}
                style={s.sheetChip}
                accessibilityRole="button"
                accessibilityLabel={clubLabel(club)}
              >
                <Text style={s.sheetChipText}>{clubLabel(club)}</Text>
              </PressableScale>
            ))}
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    marginTop: 10,
    backgroundColor: theme.bg.card,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4,
  },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  undoText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 12 },

  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  seq: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 13,
    width: 16, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  clubPill: {
    borderRadius: 999, borderWidth: 1.5, borderColor: theme.accent.primary,
    backgroundColor: theme.accent.light, paddingHorizontal: 12, paddingVertical: 6,
  },
  clubPillEmpty: { borderColor: theme.border.default, backgroundColor: theme.bg.card },
  clubText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
  clubTextEmpty: { color: theme.text.muted, fontFamily: 'PlusJakartaSans-SemiBold' },
  carry: {
    marginLeft: 'auto',
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14,
    fontVariant: ['tabular-nums'],
  },

  markBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: theme.accent.primary,
    backgroundColor: theme.accent.light, paddingVertical: 11, paddingHorizontal: 14,
  },
  markBtnDisabled: { borderColor: theme.border.default, backgroundColor: theme.bg.card },
  markText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  markTextDisabled: { color: theme.text.muted },
  suggest: {
    marginLeft: 'auto',
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13,
  },

  sheetTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16,
    marginBottom: 14,
  },
  sheetScroll: { maxHeight: 320 },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sheetChip: {
    borderRadius: 12, borderWidth: 1.5, borderColor: theme.border.default,
    backgroundColor: theme.bg.card, paddingHorizontal: 16, paddingVertical: 12,
  },
  sheetChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },
});
