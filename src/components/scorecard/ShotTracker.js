import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  subscribeShots, getShotsVersion, getShots,
  shotsForHole, logShot, setShotClub, setShotPos, deleteShot,
} from '../../store/shotStore';
import { haversineMeters } from '../../lib/geo';
import { recommendClub, clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';
import { haptic } from '../../lib/haptics';
import { ClubWheel } from './ClubWheel';
import { ClubIcon } from './ClubIcon';

// Shot log overlaid on the hole map (HoleFlyover), reduced to a single club
// FAB in the bottom-right corner. Ball spots live on the map as numbered pins:
//   - Tap the FAB to drop a spot at the white aim ring (GPS fallback); the
//     club wheel opens on it to pick the club that got the ball there.
//   - Long-press the FAB to drop the spot at your exact live GPS instead.
//   - Tap a pin on the map (relayed here as `tappedShotIndex`) to re-open the
//     wheel and change the club, move the spot, or delete it.
// The first spot on a hole is the tee, seeded from the hole geometry.
export function ShotTracker({
  roundId, roundIndex, holeNumber,
  pos, teePos, aimPos, targetPos, targetMeters,
  placing, onTogglePlacing, pendingPoint, onConsumePoint,
  tappedShotIndex, onConsumeShotTap,
}) {
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [wheelId, setWheelId] = useState(null); // shot id whose club wheel is open
  const [moveId, setMoveId] = useState(null); // shot id being repositioned by the next tap

  const overrides = appSettings.clubDistances;
  // "Club to hit" hint for the next shot, from distance to the green.
  const suggestion = useMemo(
    () => recommendClub(targetMeters, appSettings.bag, getShots(), overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetMeters, appSettings.bag, overrides, shotsVersion],
  );

  // Add a ball spot at `spot` ([lat,lng]). Seeds the tee as the origin on an
  // empty hole, appends the landing, and opens the club wheel on it —
  // pre-focused on the club whose carry matches the just-measured distance.
  const addSpot = async (spot) => {
    const hole = shotsForHole(roundId, roundIndex, holeNumber);
    let prev = hole[hole.length - 1] ?? null;
    if (hole.length === 0 && teePos) {
      await logShot({ roundId, roundIndex, holeNumber, pos: teePos, club: null });
      prev = { lat: teePos[0], lng: teePos[1] };
    }
    const carry = prev ? haversineMeters([prev.lat, prev.lng], spot) : null;
    const guess = carry ? recommendClub(carry, appSettings.bag, getShots(), overrides)?.club ?? null : null;
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos: spot, club: guess });
    setWheelId(shot.id);
  };

  // A map tap handed down from the parent, only while moving a spot: each tap
  // repositions the shot; the move stays live until the player hits Confirm.
  useEffect(() => {
    if (!pendingPoint) return;
    haptic('light');
    (async () => {
      if (moveId) await setShotPos(moveId, pendingPoint);
    })().finally(() => onConsumePoint?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPoint]);

  // A pin tapped on the map opens the wheel for that shot.
  useEffect(() => {
    if (tappedShotIndex == null) return;
    const sh = shots[tappedShotIndex];
    if (sh) setWheelId(sh.id);
    onConsumeShotTap?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tappedShotIndex]);

  // Add a shot at the white aim ring (GPS as a fallback), or at exact GPS.
  const addAtAim = () => { const p = aimPos || pos; if (p) addSpot(p); };
  const dropAtMe = () => { if (pos) addSpot(pos); };

  if (!roundId) return null;

  // Incoming carry for spot i (distance from the previous spot). Origin = null.
  const carryOf = (i) => (i > 0
    ? haversineMeters([shots[i - 1].lat, shots[i - 1].lng], [shots[i].lat, shots[i].lng])
    : null);

  // ── Wheel state derived from the shot being edited ───────────────────────
  const averages = clubAverages(getShots());
  const effDist = (k) => {
    const o = overrides?.[k];
    return (Number.isFinite(o) && o > 0) ? o : (averages.get(k) ?? clubNominal(k));
  };
  const wheelClubs = bag.map((k) => ({ key: k, label: clubLabel(k), distance: effDist(k) }));
  const editIndex = wheelId ? shots.findIndex((sh) => sh.id === wheelId) : -1;
  const editShot = editIndex >= 0 ? shots[editIndex] : null;
  const editCarry = editIndex > 0 ? carryOf(editIndex) : null;
  const editToPin = editShot && targetPos
    ? haversineMeters([editShot.lat, editShot.lng], targetPos) : null;
  const editValue = editShot
    ? (editShot.club ?? recommendClub(editCarry, appSettings.bag, getShots(), overrides)?.club ?? null)
    : null;

  const closeWheel = () => setWheelId(null);
  const chooseClub = (club) => { if (wheelId && club) setShotClub(wheelId, club); closeWheel(); };
  const moveShot = () => {
    setMoveId(wheelId);
    closeWheel();
    if (!placing) onTogglePlacing?.();
    haptic('selection');
  };
  const confirmMove = () => {
    setMoveId(null);
    if (placing) onTogglePlacing?.();
    haptic('selection');
  };
  const removeShot = () => { if (wheelId) deleteShot(wheelId); closeWheel(); };

  const canAdd = !!(aimPos || pos);

  return (
    <View style={s.wrap} pointerEvents="box-none">
      {moveId ? (
        <View style={s.moveCol}>
          <Text style={s.moveHint}>Tap the map to move the shot</Text>
          <PressableScale
            onPress={confirmMove}
            style={[s.fab, s.fabConfirm]}
            accessibilityLabel="Confirm the shot's new spot"
          >
            <Feather name="check" size={24} color="#0a0d10" />
          </PressableScale>
        </View>
      ) : (
        <View style={s.fabCol}>
          {suggestion && <Text style={s.badge}>{`≈ ${clubLabel(suggestion.club)}`}</Text>}
          <PressableScale
            onPress={addAtAim}
            onLongPress={dropAtMe}
            disabled={!canAdd}
            style={[s.fab, !canAdd && s.fabDisabled]}
            accessibilityLabel="Add a shot at the aim ring"
          >
            <ClubIcon size={26} color="#0a0d10" />
          </PressableScale>
        </View>
      )}

      <ClubWheel
        visible={!!editShot}
        clubs={wheelClubs}
        value={editValue}
        units={units}
        seqLabel={editIndex >= 0 ? `Shot ${editIndex}` : 'Club'}
        carryMeters={editCarry}
        toPinMeters={editToPin}
        onSelect={chooseClub}
        onMove={moveShot}
        onDelete={removeShot}
        onClose={closeWheel}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', right: 16, bottom: 20, alignItems: 'flex-end', gap: 8,
  },
  fabCol: { alignItems: 'center', gap: 6 },
  moveCol: { alignItems: 'center', gap: 8 },
  badge: {
    backgroundColor: 'rgba(10,13,16,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
    color: '#cfe3d5', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
    paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999,
    fontVariant: ['tabular-nums'],
  },
  fab: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#57ae5b',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  fabConfirm: { backgroundColor: '#f4c04a' },
  fabDisabled: { opacity: 0.5 },
  moveHint: {
    color: '#0a0d10', backgroundColor: '#f4c04a',
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: 'hidden',
  },
});
