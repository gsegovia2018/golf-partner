import React, { useMemo, useState, useSyncExternalStore } from 'react';
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

// Shot log overlaid on the hole map (HoleFlyover). Lives INSIDE the map — no
// map, no tracking — because a shot is only meaningful as a point you can see
// against the green. "Mark ball" captures the current fix (capture where you
// stand, before walking on); you then tag the club. Carry = straight-line
// distance to the next marked shot, so club-on-shot-N + carry(N→N+1) feeds
// your bag averages. Dark-styled: the flyover is always a dark sheet.
export function ShotTracker({ roundId, roundIndex, holeNumber, pos, targetMeters }) {
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [pickFor, setPickFor] = useState(null); // shot id whose club chooser is open
  const suggestion = useMemo(
    () => recommendClub(targetMeters, appSettings.bag, getShots()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings.bag, shotsVersion],
  );

  if (!roundId) return null;

  const carryOf = (i) => (i < shots.length - 1
    ? haversineMeters([shots[i].lat, shots[i].lng], [shots[i + 1].lat, shots[i + 1].lng])
    : null);

  const mark = async () => {
    if (!pos) return;
    haptic('light');
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos, club: suggestion?.club ?? null });
    setPickFor(shot.id);
  };
  const chooseClub = async (club) => {
    if (pickFor) await setShotClub(pickFor, club);
    setPickFor(null);
  };

  return (
    <View style={s.wrap} pointerEvents="box-none">
      {pickFor && (
        <View style={s.picker}>
          <Text style={s.pickerTitle}>Which club?</Text>
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
              const carry = carryOf(i);
              return (
                <PressableScale key={shot.id} onPress={() => setPickFor(shot.id)} style={s.shotPill}>
                  <Text style={s.shotSeq}>{i + 1}</Text>
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
              style={s.undo}
              accessibilityLabel="Undo last shot"
            >
              <Feather name="corner-up-left" size={16} color="#cfe3d5" />
            </PressableScale>
          )}
          <PressableScale
            onPress={mark}
            disabled={!pos}
            style={[s.mark, !pos && s.markDisabled]}
            accessibilityLabel="Mark ball at current position"
          >
            <Feather name="map-pin" size={15} color={pos ? '#0a0d10' : '#6d7d72'} />
            <Text style={[s.markText, !pos && s.markTextDisabled]}>
              {pos ? 'Mark ball' : 'No GPS'}
            </Text>
            {pos && suggestion && <Text style={s.suggest}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
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
  undo: {
    width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  mark: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#57ae5b', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
  },
  markDisabled: { backgroundColor: 'rgba(255,255,255,0.10)' },
  markText: { color: '#0a0d10', fontFamily: 'PlusJakartaSans-Bold', fontSize: 15 },
  markTextDisabled: { color: '#6d7d72' },
  suggest: {
    marginLeft: 'auto',
    color: 'rgba(10,13,16,0.75)', fontFamily: 'PlusJakartaSans-Bold', fontSize: 13,
  },
});
