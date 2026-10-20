import React, {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import PressableScale from '../ui/PressableScale';
import { hud } from '../../theme/tokens';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  subscribeShots, getShotsVersion, getShots,
  shotsForHole, logShot, logMeasuredShot, setShotClub, setShotPos,
  insertShotAfter, deleteShot, chainEndNear,
} from '../../store/shotStore';
import { haversineMeters, bearingDeg, pointInPolygon } from '../../lib/geo';
import { useT } from '../../i18n';
import { guessClub } from '../../store/clubGuess';
import { ClubWheel, wheelClubsFor } from './ClubWheel';

// How far from the green centre "On the green" still makes sense. A green is
// in range of an approach, never of a drive on a par 4 — see canFinishOnGreen.
const MAX_GREEN_CLOSE_M = 250;

// Whether `pt` ([lat,lng]) is on the green: inside its outline when the map
// has one, else within 12 m of the green centre.
export function isOnGreen(pt, green, greenCenter) {
  if (!pt) return false;
  if (green) return pointInPolygon(pt, green);
  return !!greenCenter && haversineMeters(pt, greenCenter) <= 12;
}

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
//     only ever putt from. A spot on the green is where the first putt was
//     struck, so its sheet offers no club — only Move and Delete.
export function ShotTracker({
  roundId, roundIndex, holeNumber, courseName = null,
  pos, aimPos, aimRings, targetPos,
  // The hole's green outline ([[lat,lng],...]), or null — see isOnGreen.
  greenPolygon = null,
  // Hide the FABs (a seen-shot card is using the bottom of the map).
  hideFabs = false,
  tappedShotIndex, onConsumeShotTap, onCollapseTargets,
  // Shots the hole's score says are missing (useShotProposals), or null.
  missing = null,
}) {
  const appSettings = useAppSettings();
  const tl = useT();
  const { units } = appSettings;

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shots = useMemo(() => shotsForHole(roundId, roundIndex, holeNumber), [roundId, roundIndex, holeNumber, shotsVersion]);

  const [wheelId, setWheelId] = useState(null); // shot id whose club wheel is open

  const overrides = appSettings.clubDistances;
  // Every guess here goes through guessClub, so the picker preselects the
  // same club the header, measure button and map card recommend.
  const guess = (meters, from, to, fromTee) => (Number.isFinite(meters) && meters > 0
    ? guessClub({
      meters, bearing: from && to ? bearingDeg(from, to) : null, courseName, settings: appSettings, fromTee, shots: getShots(),
    })?.club ?? null
    : null);

  const onGreen = (pt) => isOnGreen(pt, greenPolygon, targetPos);

  // Add a ball spot at `spot` ([lat,lng]): the shot you're about to play from
  // there. Opens the club wheel on it, pre-focused on the club that covers
  // what's left to the green — the driver is only a candidate off the tee
  // (the hole's first mark). When the hole's chain already ends in an un-hit
  // landing at this spot (a measured shot's end, chainEndNear), that spot is
  // tagged where it is instead of stacking a duplicate on it.
  const addSpot = async (spot) => {
    const hole = shotsForHole(roundId, roundIndex, holeNumber);
    const toGreen = targetPos ? haversineMeters(spot, targetPos) : null;
    const end = chainEndNear(hole, spot);
    if (end && !end.club) {
      const at = [end.lat, end.lng];
      if (!onGreen(at)) {
        const club = guess(toGreen, at, targetPos, hole.length === 1);
        if (club) await setShotClub(end.id, club);
      }
      setWheelId(end.id);
      return;
    }
    const club = guess(toGreen, spot, targetPos, hole.length === 0);
    const shot = await logShot({ roundId, roundIndex, holeNumber, pos: spot, club });
    setWheelId(shot.id);
  };

  // One mark at a time: a double tap must not drop two stacked pins while the
  // first is still being written.
  const marking = useRef(false);
  const once = (fn) => async () => {
    if (marking.current) return;
    marking.current = true;
    try { await fn(); } finally { marking.current = false; }
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
      const club = guess(carry, start, end, shotsForHole(roundId, roundIndex, holeNumber).length === 0);
      const { originId } = await logMeasuredShot({
        roundId, roundIndex, holeNumber, start, end, club,
      });
      setWheelId(originId);
      onCollapseTargets?.([end]);
      return;
    }
    const p = pos || aimPos;
    if (p) await addSpot(p);
  };
  const dropAtAim = async () => { const p = aimPos || pos; if (p) await addSpot(p); };

  // The approach finished on the green: everything after it is a putt, so the
  // chain ends here. Marking the green centre rather than walking to the ball
  // gives the approach an honest carry (a green is ~20-30 m across, and the
  // centre is the number the approach was aimed at anyway) and leaves nothing
  // more to mark on the hole.
  const finishOnGreen = async () => {
    if (!targetPos) return;
    await logShot({ roundId, roundIndex, holeNumber, pos: targetPos, club: null });
  };

  if (!roundId) return null;

  // Carry of the shot played FROM spot i: the distance to the next spot. Null
  // for the last spot — that shot's landing hasn't been marked yet.
  const carryOf = (i) => (i < shots.length - 1
    ? haversineMeters([shots[i].lat, shots[i].lng], [shots[i + 1].lat, shots[i + 1].lng])
    : null);

  // ── Wheel state derived from the shot being edited ───────────────────────
  const wheelClubs = wheelClubsFor(appSettings.bag, overrides, getShots());
  const editIndex = wheelId ? shots.findIndex((sh) => sh.id === wheelId) : -1;
  const editShot = editIndex >= 0 ? shots[editIndex] : null;
  const editCarry = editIndex >= 0 ? carryOf(editIndex) : null;
  // A spot on the green is the first putt: there's no club to pick for it.
  const editOnGreen = !!editShot && onGreen([editShot.lat, editShot.lng]);
  const editToPin = editShot && targetPos
    ? haversineMeters([editShot.lat, editShot.lng], targetPos) : null;
  const editValue = editShot
    ? (editShot.club ?? guess(editCarry, [editShot.lat, editShot.lng],
      editIndex < shots.length - 1 ? [shots[editIndex + 1].lat, shots[editIndex + 1].lng] : null, editIndex === 0))
    : null;

  const closeWheel = () => setWheelId(null);
  const chooseClub = (club) => { if (wheelId && club) setShotClub(wheelId, club); closeWheel(); };
  const removeShot = () => {
    if (wheelId) deleteShot(wheelId);
    closeWheel();
  };
  // Re-place a spot that was marked in the wrong place — at the live fix when
  // there is one (you're standing at the ball now), otherwise at the aim ring
  // (the map always has one, so you can put it exactly where the ball was).
  const movePos = pos || aimPos;
  const moveShot = () => {
    if (wheelId && movePos) setShotPos(wheelId, movePos);
    closeWheel();
  };
  // A shot played but never marked — a punch-out, a lay-up you walked past.
  // It lands halfway to the next spot when there is one, else at the live fix,
  // else at the aim ring; either way the pin is draggable once it's down.
  const insertPos = editIndex >= 0 && shots[editIndex + 1]
    ? [(editShot.lat + shots[editIndex + 1].lat) / 2, (editShot.lng + shots[editIndex + 1].lng) / 2]
    : (pos || aimPos);
  const insertShot = async () => {
    if (!wheelId || !insertPos) return;
    closeWheel();
    const added = await insertShotAfter(wheelId, insertPos);
    if (added) setWheelId(added.id);
  };

  // The score says shots are missing (a duff, a re-tee, a drop): play
  // another one from this same spot.
  const repeatShot = async () => {
    if (!editShot) return;
    closeWheel();
    await insertShotAfter(editShot.id, [editShot.lat, editShot.lng], editShot.club);
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
      {!hideFabs && (
        <View style={s.fabCol}>
          {canFinishOnGreen && (
            <PressableScale
              onPress={once(finishOnGreen)}
              style={s.greenBtn}
              accessibilityLabel={tl('shots.tracker.onGreenA11y')}
            >
              <Feather name="flag" size={16} color={hud.text} />
              <Text style={s.greenLbl}>{tl('shots.tracker.onGreen')}</Text>
            </PressableScale>
          )}
          <PressableScale
            onPress={once(markShot)}
            onLongPress={once(dropAtAim)}
            disabled={!canAdd}
            style={[s.addBtn, !canAdd && s.fabDisabled]}
            accessibilityLabel={tl('shots.tracker.markA11y')}
          >
            <Feather name="plus" size={20} color={hud.onAccent} />
            <Text style={s.addLbl}>{tl('shots.tracker.mark')}</Text>
          </PressableScale>
        </View>
      )}

      <ClubWheel
        visible={!!editShot}
        clubs={wheelClubs}
        value={editValue}
        units={units}
        seqLabel={editOnGreen ? tl('shots.tracker.onGreen')
          : editIndex >= 0 ? tl('shots.tracker.shotN', { n: editIndex + 1 }) : tl('shots.wheel.club')}
        pickClub={!editOnGreen}
        carryMeters={editCarry}
        toPinMeters={editToPin}
        onSelect={chooseClub}
        onMove={movePos ? moveShot : undefined}
        onInsert={insertPos && !editOnGreen ? insertShot : undefined}
        onRepeat={missing > 0 && !editOnGreen ? repeatShot : undefined}
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
