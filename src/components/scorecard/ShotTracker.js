import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
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

// Shot log overlaid on the hole map (HoleFlyover). Ball spots are placed by
// TAPPING the map where the ball landed — GPS is optional (a "drop at me"
// shortcut when there's a fix). The first spot on a hole is the tee (seeded
// from the hole geometry when available); every later spot is tagged with the
// club that GOT the ball there, so its carry = distance from the previous spot.
// Distances come straight from the map geometry — no GPS required.
//
// Placement is driven by the parent: `placing` toggles map-tap mode, and a
// tapped point arrives as `pendingPoint` for us to log.
export function ShotTracker({
  roundId, roundIndex, holeNumber,
  pos, teePos, targetMeters,
  placing, onTogglePlacing, pendingPoint, onConsumePoint,
}) {
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [pickFor, setPickFor] = useState(null); // shot id whose club chooser is open

  // "Club to hit" hint for the next shot, from distance to the green.
  const suggestion = useMemo(
    () => recommendClub(targetMeters, appSettings.bag, getShots()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings.bag, shotsVersion],
  );

  // Add a ball spot at `spot` ([lat,lng]). Seeds the tee as the origin on an
  // empty hole, appends the landing, and opens the club chooser on it —
  // pre-guessing the club from the just-measured carry.
  const addSpot = async (spot) => {
    const hole = shotsForHole(roundId, roundIndex, holeNumber);
    let prev = hole[hole.length - 1] ?? null;
    if (hole.length === 0 && teePos) {
      await logShot({ roundId, roundIndex, holeNumber, pos: teePos, club: null });
      prev = { lat: teePos[0], lng: teePos[1] };
    }
    const carry = prev ? haversineMeters([prev.lat, prev.lng], spot) : null;
    const guess = carry ? recommendClub(carry, appSettings.bag, getShots())?.club ?? null : null;
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos: spot, club: guess });
    setPickFor(shot.id);
  };

  // A map tap handed down from the parent.
  useEffect(() => {
    if (!pendingPoint) return;
    haptic('light');
    addSpot(pendingPoint).finally(() => onConsumePoint?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPoint]);

  if (!roundId) return null;

  // Incoming carry for spot i (distance from the previous spot). Origin = null.
  const carryOf = (i) => (i > 0
    ? haversineMeters([shots[i - 1].lat, shots[i - 1].lng], [shots[i].lat, shots[i].lng])
    : null);
  const isOrigin = (i, shot) => i === 0 && !shot.club;

  const chooseClub = async (club) => {
    if (pickFor) await setShotClub(pickFor, club);
    setPickFor(null);
  };
  const dropAtMe = () => { if (pos) addSpot(pos); };

  return (
    <View style={s.wrap} pointerEvents="box-none">
      {pickFor && (
        <View style={s.picker}>
          <Text style={s.pickerTitle}>Club that got it there?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pickerRow}>
            {bag.map((club) => (
              <PressableScale key={club} onPress={() => chooseClub(club)} style={s.pickerChip}>
                <Text style={s.pickerChipText}>{clubLabel(club)}</Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={s.bar}>
        {shots.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shotRow} style={s.shotScroll}>
            {shots.map((shot, i) => {
              if (isOrigin(i, shot)) {
                return (
                  <View key={shot.id} style={[s.shotPill, s.teePill]}>
                    <Feather name="flag" size={12} color="#9fb0a4" />
                    <Text style={s.teeText}>Tee</Text>
                  </View>
                );
              }
              const carry = carryOf(i);
              return (
                <PressableScale key={shot.id} onPress={() => setPickFor(shot.id)} style={s.shotPill}>
                  <Text style={s.shotSeq}>{i}</Text>
                  <Text style={[s.shotClub, !shot.club && s.shotClubEmpty]}>
                    {shot.club ? clubLabel(shot.club) : 'club?'}
                  </Text>
                  {carry != null && (
                    <Text style={s.shotCarry}>{`${formatDistance(carry, units)}${unitSuffix(units)}`}</Text>
                  )}
                </PressableScale>
              );
            })}
          </ScrollView>
        )}

        <View style={s.actions}>
          {shots.length > 0 && (
            <PressableScale
              onPress={() => { haptic('selection'); undoLastShot(roundId, roundIndex, holeNumber); }}
              style={s.iconBtn}
              accessibilityLabel="Undo last shot"
            >
              <Feather name="corner-up-left" size={16} color="#cfe3d5" />
            </PressableScale>
          )}
          {pos && (
            <PressableScale onPress={dropAtMe} style={s.iconBtn} accessibilityLabel="Drop shot at my location">
              <Feather name="navigation" size={15} color="#cfe3d5" />
            </PressableScale>
          )}
          <PressableScale
            onPress={onTogglePlacing}
            style={[s.mark, placing && s.markActive]}
            accessibilityLabel={placing ? 'Cancel placing' : 'Add a shot by tapping the map'}
          >
            <Feather name={placing ? 'x' : 'plus'} size={16} color="#0a0d10" />
            <Text style={s.markText}>{placing ? 'Tap the map' : 'Add shot'}</Text>
            {!placing && suggestion && <Text style={s.suggest}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, bottom: 14, gap: 8 },

  picker: {
    backgroundColor: 'rgba(10,13,16,0.94)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
  },
  pickerTitle: {
    color: '#9fb0a4', fontFamily: 'PlusJakartaSans-Bold', fontSize: 10,
    letterSpacing: 1.2, marginBottom: 8,
  },
  pickerRow: { gap: 8, paddingRight: 4 },
  pickerChip: {
    borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 14, paddingVertical: 9,
  },
  pickerChipText: { color: '#fff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },

  bar: {
    backgroundColor: 'rgba(10,13,16,0.92)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16, padding: 8, gap: 8,
  },
  shotScroll: { maxHeight: 40 },
  shotRow: { gap: 6, alignItems: 'center' },
  shotPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  teePill: { backgroundColor: 'rgba(255,255,255,0.04)' },
  teeText: { color: '#9fb0a4', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  shotSeq: {
    color: '#9fb0a4', fontFamily: 'PlusJakartaSans-Bold', fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  shotClub: { color: '#fff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
  shotClubEmpty: { color: '#e0a23a' },
  shotCarry: {
    color: '#cfe3d5', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12,
    fontVariant: ['tabular-nums'],
  },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  mark: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#57ae5b', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
  },
  markActive: { backgroundColor: '#f4c04a' },
  markText: { color: '#0a0d10', fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },
  suggest: {
    marginLeft: 'auto',
    color: 'rgba(10,13,16,0.75)', fontFamily: 'PlusJakartaSans-Bold', fontSize: 13,
  },
});
