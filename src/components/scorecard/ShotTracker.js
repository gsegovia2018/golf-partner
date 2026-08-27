import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { hud } from '../../theme/tokens';
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
// FAB in the bottom-right corner.
//
// A mark records the shot you are ABOUT TO PLAY, from where you're standing:
// spot N is where shot N was struck and carries the club you hit with it. So
// the tee mark is shot 1 (driver), the next mark is made at your ball and is
// shot 2, and so on. A club's carry is therefore the distance from its own
// spot to the NEXT one, which is only known once you mark that next shot.
//
// Spots live on the map as numbered, draggable pins:
//   - Tap the FAB to drop a spot at your live GPS (the aim ring is only a
//     fallback when there's no fix); the club wheel opens on it, pre-focused
//     on the club for the distance left to the green.
//   - Long-press the FAB to drop the spot at the white aim ring instead.
//   - Drag a pin on the map to reposition it (handled by the map/host, not
//     here); tap a pin (relayed here as `tappedShotIndex`) to re-open the
//     wheel and change the club or delete it.
export function ShotTracker({
  roundId, roundIndex, holeNumber,
  pos, aimPos, aimRings, targetPos,
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

  // Add a ball spot at `spot` ([lat,lng]): the shot you're about to play from
  // there. Opens the club wheel on it, pre-focused on the club that covers
  // what's left to the green — the driver is only a candidate off the tee
  // (the hole's first mark).
  const addSpot = async (spot) => {
    const hole = shotsForHole(roundId, roundIndex, holeNumber);
    const toGreen = targetPos ? haversineMeters(spot, targetPos) : null;
    const guess = toGreen
      ? recommendClub(toGreen, appSettings.bag, getShots(), overrides,
        { excludeDriver: hole.length > 0 })?.club ?? null
      : null;
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

  // Add a shot at your live GPS (the aim ring as a fallback when there's no
  // fix), or at the aim ring on a long-press. With two rings set on the map,
  // logs the start->end segment between them instead — the club lands on the
  // start spot, since that's where the shot was played from — then collapses
  // the rings down to the landing.
  const markShot = async () => {
    if (aimRings?.length === 2) {
      const [start, end] = aimRings;
      const carry = haversineMeters(start, end);
      const guess = recommendClub(carry, appSettings.bag, getShots(), overrides)?.club ?? null;
      const { originId } = await logMeasuredShot({
        roundId, roundIndex, holeNumber, start, end, club: guess,
      });
      setWheelId(originId);
      onCollapseTargets?.([end]);
      return;
    }
    const p = pos || aimPos;
    if (p) addSpot(p);
  };
  const dropAtAim = () => { const p = aimPos || pos; if (p) addSpot(p); };

  if (!roundId) return null;

  // Carry of the shot played FROM spot i: the distance to the next spot. Null
  // for the last spot — that shot's landing hasn't been marked yet.
  const carryOf = (i) => (i < shots.length - 1
    ? haversineMeters([shots[i].lat, shots[i].lng], [shots[i + 1].lat, shots[i + 1].lng])
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
  const editCarry = editIndex >= 0 ? carryOf(editIndex) : null;
  const editToPin = editShot && targetPos
    ? haversineMeters([editShot.lat, editShot.lng], targetPos) : null;
  const editValue = editShot
    ? (editShot.club ?? recommendClub(editCarry, appSettings.bag, getShots(), overrides)?.club ?? null)
    : null;

  const closeWheel = () => setWheelId(null);
  const chooseClub = (club) => { if (wheelId && club) setShotClub(wheelId, club); closeWheel(); };
  const removeShot = () => {
    if (wheelId) deleteShot(wheelId);
    closeWheel();
  };

  const canAdd = !!(aimPos || pos);

  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.fabCol}>
        <PressableScale
          onPress={markShot}
          onLongPress={dropAtAim}
          disabled={!canAdd}
          style={[s.addBtn, !canAdd && s.fabDisabled]}
          accessibilityLabel="Mark a shot at your location"
        >
          <Feather name="plus" size={20} color={hud.onAccent} />
          <Text style={s.addLbl}>Mark shot</Text>
        </PressableScale>
      </View>

      <ClubWheel
        visible={!!editShot}
        clubs={wheelClubs}
        value={editValue}
        units={units}
        seqLabel={editIndex >= 0 ? `Shot ${editIndex + 1}` : 'Club'}
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
    backgroundColor: hud.accent,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  addLbl: { color: hud.onAccent, fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15 },
  fabDisabled: { opacity: 0.5 },
});
