import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  subscribeShots, getShotsVersion, getShots,
  shotsForHole, logShot, logMeasuredShot, setShotClub, deleteShot,
} from '../../store/shotStore';
import { haversineMeters } from '../../lib/geo';
import { recommendClub, clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';
import { ClubWheel } from './ClubWheel';

// Shot log overlaid on the hole map (HoleFlyover), reduced to a single club
// FAB in the bottom-right corner. Ball spots live on the map as numbered,
// draggable pins:
//   - Tap the FAB to drop a spot at the white aim ring (GPS fallback); the
//     club wheel opens on it to pick the club that got the ball there.
//   - Long-press the FAB to drop the spot at your exact live GPS instead.
//   - Drag a pin on the map to reposition it (handled by the map/host, not
//     here); tap a pin (relayed here as `tappedShotIndex`) to re-open the
//     wheel and change the club or delete it.
// The first spot on a hole is the tee, seeded from the hole geometry.
export function ShotTracker({
  roundId, roundIndex, holeNumber,
  pos, teePos, aimPos, aimRings, targetPos,
  tappedShotIndex, onConsumeShotTap, onCollapseTargets,
}) {
  const appSettings = useAppSettings();
  const { units } = appSettings;
  const bag = useMemo(() => swingClubs(appSettings.bag), [appSettings.bag]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [wheelId, setWheelId] = useState(null); // shot id whose club wheel is open

  const overrides = appSettings.clubDistances;

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

  // A pin tapped on the map opens the wheel for that shot.
  useEffect(() => {
    if (tappedShotIndex == null) return;
    const sh = shots[tappedShotIndex];
    if (sh) setWheelId(sh.id);
    onConsumeShotTap?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tappedShotIndex]);

  // Add a shot at the white aim ring (GPS as a fallback), or at exact GPS. With
  // two rings set on the map, logs the start->end segment between them
  // instead, then collapses the rings down to the landing.
  const addAtAim = async () => {
    if (aimRings?.length === 2) {
      const [start, end] = aimRings;
      const carry = haversineMeters(start, end);
      const guess = recommendClub(carry, appSettings.bag, getShots(), overrides)?.club ?? null;
      const { shotId } = await logMeasuredShot({
        roundId, roundIndex, holeNumber, start, end, club: guess,
      });
      setWheelId(shotId);
      onCollapseTargets?.([end]);
      return;
    }
    const p = aimPos || pos;
    if (p) addSpot(p);
  };
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
  const removeShot = () => {
    if (wheelId) {
      // Deleting the last landing can strand the seeded, club-less tee (index
      // 0, no club) — a non-interactive origin pin with no Undo button to
      // clear it. Drop it too so the hole resets cleanly.
      const remaining = shots.filter((sh) => sh.id !== wheelId);
      deleteShot(wheelId);
      if (remaining.length === 1 && !remaining[0].club) deleteShot(remaining[0].id);
    }
    closeWheel();
  };

  const canAdd = !!(aimPos || pos);

  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.fabCol}>
        <PressableScale
          onPress={addAtAim}
          onLongPress={dropAtMe}
          disabled={!canAdd}
          style={[s.addBtn, !canAdd && s.fabDisabled]}
          accessibilityLabel="Add a shot at the aim ring"
        >
          <Feather name="plus" size={20} color="#0a0d10" />
          <Text style={s.addLbl}>Mark shot</Text>
        </PressableScale>
      </View>

      <ClubWheel
        visible={!!editShot}
        clubs={wheelClubs}
        value={editValue}
        units={units}
        seqLabel={editIndex >= 0 ? `Shot ${editIndex}` : 'Club'}
        carryMeters={editCarry}
        toPinMeters={editToPin}
        onSelect={chooseClub}
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
  fabCol: { alignItems: 'flex-end', gap: 6 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 12, paddingRight: 16, height: 48, borderRadius: 24,
    backgroundColor: '#57ae5b',
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  addLbl: { color: '#0a0d10', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15 },
  fabDisabled: { opacity: 0.5 },
});
