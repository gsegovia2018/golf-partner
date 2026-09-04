import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { hud } from '../../theme/tokens';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  subscribeShots, getShotsVersion, getShots,
  shotsForHole, logShot, logMeasuredShot, setShotClub, setShotPos,
  insertShotAfter, deleteShot,
} from '../../store/shotStore';
import { haversineMeters } from '../../lib/geo';
import { recommendClub, clubAverages } from '../../lib/shotStats';
import { swingClubs, clubLabel, clubNominal } from '../../lib/clubs';
import { ClubWheel } from './ClubWheel';

// How far from the green centre "On the green" still makes sense. A green is
// in range of an approach, never of a drive on a par 4 — see canFinishOnGreen.
const MAX_GREEN_CLOSE_M = 250;

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
//     wheel and change the club, move it, add a shot after it, or delete it.
//   - "On the green" closes the hole in one tap at the green centre, so the
//     approach earns its carry without walking up and marking a spot you'd
//     only ever putt from.
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

  // The approach finished on the green: everything after it is a putt, so the
  // chain ends here. Marking the green centre rather than walking to the ball
  // gives the approach an honest carry (a green is ~20-30 m across, and the
  // centre is the number the approach was aimed at anyway) and leaves nothing
  // more to mark on the hole.
  const finishOnGreen = () => {
    if (!targetPos) return;
    logShot({ roundId, roundIndex, holeNumber, pos: targetPos, club: null });
  };

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
  // Re-place a spot that was marked in the wrong place — at the aim ring when
  // one is set (you can put it exactly where the ball was), otherwise at the
  // live fix (you're standing there now).
  const movePos = aimPos || pos;
  const moveShot = () => {
    if (wheelId && movePos) setShotPos(wheelId, movePos);
    closeWheel();
  };
  // A shot played but never marked — a punch-out, a lay-up you walked past.
  // It lands at the aim ring, else halfway to the next spot, else at the live
  // fix; either way the pin is draggable once it's down.
  const insertPos = aimPos
    ?? (editIndex >= 0 && shots[editIndex + 1]
      ? [(editShot.lat + shots[editIndex + 1].lat) / 2, (editShot.lng + shots[editIndex + 1].lng) / 2]
      : pos);
  const insertShot = async () => {
    if (!wheelId || !insertPos) return;
    closeWheel();
    const added = await insertShotAfter(wheelId, insertPos);
    if (added) setWheelId(added.id);
  };

  const canAdd = !!(aimPos || pos);
  // Offered only while the hole's chain is still open — the last spot carries
  // a club, so its landing hasn't been marked yet — and only from somewhere the
  // green is actually reachable, so a mis-tap on the tee of a par 4 can't
  // record a 400 m "carry" against whatever club is on the tee spot.
  const lastSpot = shots[shots.length - 1] ?? null;
  const canFinishOnGreen = !!targetPos && !!lastSpot?.club
    && haversineMeters([lastSpot.lat, lastSpot.lng], targetPos) <= MAX_GREEN_CLOSE_M;

  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.fabCol}>
        {canFinishOnGreen && (
          <PressableScale
            onPress={finishOnGreen}
            style={s.greenBtn}
            accessibilityLabel="Ball is on the green — finish the hole here"
          >
            <Feather name="flag" size={16} color={hud.text} />
            <Text style={s.greenLbl}>On the green</Text>
          </PressableScale>
        )}
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
        onMove={movePos ? moveShot : undefined}
        onInsert={insertPos ? insertShot : undefined}
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
  greenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, height: 40, borderRadius: 20,
    backgroundColor: hud.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: hud.line,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  greenLbl: { color: hud.text, fontFamily: 'PlusJakartaSans-Bold', fontSize: 13 },
  fabDisabled: { opacity: 0.5 },
});
