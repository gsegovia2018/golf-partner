import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, PanResponder,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  holeFeatures, subscribeCourseGeometry, getCourseGeometryVersion, haversineMeters,
} from '../../lib/geo';
import { anchorFor } from '../../lib/flyoverModel';
import { courseKeyFor } from '../../store/tileCache';
import { useAppSettings } from '../../hooks/useAppSettings';
import { usePlayConditions } from '../../hooks/usePlayConditions';
import { subscribeShots, getShotsVersion, shotsForHole } from '../../store/shotStore';
import { HoleMapView } from './HoleMapView';
import { ShotTracker } from './ShotTracker';

// Full-screen interactive satellite flyover of one hole (Leaflet + Esri tiles,
// pan/zoom). Green markers/outline, your live position, a draggable aim ring
// with a double line (you → aim → green) and front/center/back distances — all
// rendered inside the map page. Off-course (GPS far from the green) it switches
// to a drag-to-measure marker. Admins get an Edit button.
export function HoleFlyover({
  courseName, holeNumber, par, strokeIndex,
  position, visible, onClose, onEdit,
  roundId, roundIndex,
}) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  const { units } = useAppSettings();
  const cond = usePlayConditions(courseName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geomVersion]);

  // Logged shots for this hole, as plain {lat,lng,club} for the map layer.
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const shotPinsRaw = roundId != null ? shotsForHole(roundId, roundIndex, holeNumber) : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shotPins = useMemo(() => shotPinsRaw.map((sh) => ({ lat: sh.lat, lng: sh.lng, club: sh.club })), [roundId, roundIndex, holeNumber, shotsVersion]);

  const anchorInfo = useMemo(() => {
    if (!feat) return null;
    const r = anchorFor({ player: position, tee: feat.start, greenCenter: feat.greenCenter });
    return { pos: r.anchor, source: r.source, playerDistance: r.playerDistance };
  }, [feat, position]);

  const data = useMemo(() => (feat ? {
    mode: 'view',
    holeKey: `${courseName}#${holeNumber}#view`,
    holeLabel: `Hole ${holeNumber}`,
    courseKey: courseKeyFor(courseName),
    green: feat.green || null,
    greenFront: feat.greenFront || null,
    greenCenter: feat.greenCenter || null,
    greenBack: feat.greenBack || null,
    tee: feat.start || null,
    hazards: feat.hazards || [],
    player: position || null,
    anchor: anchorInfo,
    units,
    shots: shotPins, // initial paint; live marks arrive via the shots prop below
  } : null), [feat, courseName, holeNumber, position, anchorInfo, units, shotPins]);

  // Shot placement: `placing` puts the map in tap-to-drop mode; a tapped point
  // arrives here as `pendingPoint` and is handed to ShotTracker to log.
  const [placing, setPlacing] = useState(false);
  const [pendingPoint, setPendingPoint] = useState(null);

  // Swipe-down on the grabber/header dismisses; the map owns its own gestures.
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120 || g.vy > 0.8) {
        dragY.setValue(0);
        onCloseRef.current?.();
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => { dragY.setValue(0); },
  })).current;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={s.backdropTouch} onPress={onClose} accessibilityLabel="Close hole map" />
        <Animated.View style={[s.sheet, { transform: [{ translateY: dragY }] }]}>
          <View {...pan.panHandlers}>
            <View style={s.grabber} testID="flyover-grabber" />
            <View style={s.header}>
              <View style={s.titleWrap}>
                <Text style={s.title} numberOfLines={1}>{feat ? `Hole ${holeNumber}` : 'No map data'}</Text>
                {par != null && strokeIndex != null && (
                  <Text style={s.subtitle}>{`Par ${par} · SI ${strokeIndex}`}</Text>
                )}
              </View>
              <View style={s.hbtns}>
                {onEdit && feat && (
                  <Pressable onPress={onEdit} style={s.editBtn} hitSlop={8}>
                    <Feather name="edit-2" size={14} color="#0a0d10" />
                    <Text style={s.editTxt}>Edit</Text>
                  </Pressable>
                )}
                <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8} testID="flyover-close">
                  <Feather name="x" size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
          </View>
          {data ? (
            <View style={s.map}>
              <HoleMapView
                data={data}
                player={position}
                anchor={anchorInfo}
                shots={shotPins}
                placing={placing}
                onShotPoint={(p) => { setPendingPoint(p); setPlacing(false); }}
                style={s.map}
              />
              {roundId != null && (
                <ShotTracker
                  roundId={roundId}
                  roundIndex={roundIndex}
                  holeNumber={holeNumber}
                  pos={position ?? null}
                  teePos={feat?.start ?? null}
                  targetPos={feat?.greenCenter ?? null}
                  targetMeters={feat?.greenCenter && position
                    ? cond.plays(haversineMeters(position, feat.greenCenter)) : null}
                  placing={placing}
                  onTogglePlacing={() => setPlacing((v) => !v)}
                  pendingPoint={pendingPoint}
                  onConsumePoint={() => setPendingPoint(null)}
                />
              )}
            </View>
          ) : (
            <View style={s.center}><Text style={s.muted}>This course has no green geometry yet.</Text></View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,26,20,0.38)', justifyContent: 'flex-end' },
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, height: 28 },
  sheet: {
    height: '96%',
    backgroundColor: '#0a0d10',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)', marginTop: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10,
  },
  titleWrap: { flex: 1, gap: 1 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  subtitle: { color: '#9fb0a4', fontSize: 12, fontWeight: '600' },
  hbtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#57ae5b', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  editTxt: { color: '#0a0d10', fontWeight: '700', fontSize: 13 },
  closeBtn: { padding: 4 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#9fb0a4', fontSize: 15 },
});
