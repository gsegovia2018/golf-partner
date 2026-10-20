import React, {
  useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, PanResponder,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT, formatNumber, formatTime } from '../../i18n';
import {
  holeFeatures, haversineMeters, bearingDeg,
} from '../../lib/geo';
import { windText } from '../../lib/playConditions';
import { useCourseGeometry } from '../../hooks/useCourseGeometry';
import { anchorFor } from '../../lib/flyoverModel';
import { hud } from '../../theme/tokens';
import { courseKeyFor } from '../../store/tileCache';
import { useAppSettings } from '../../hooks/useAppSettings';
import { usePlayConditions } from '../../hooks/usePlayConditions';
import { subscribeShots, getShotsVersion, shotsForHole, setShotPos, getShots } from '../../store/shotStore';
import { guessClub } from '../../store/clubGuess';
import { clubLabel } from '../../lib/clubs';
import { HoleMapView } from './HoleMapView';
import { ShotTracker, isOnGreen } from './ShotTracker';
import { SeenMapCard, MissingPill } from './ShotProposals';
import { useShotProposals } from '../../hooks/useShotProposals';

const NO_SEEN = [];

// Full-screen interactive satellite flyover of one hole (Leaflet + Esri tiles,
// pan/zoom). Green markers/outline, your live position, a draggable aim ring
// with a double line (you → aim → green) and front/center/back distances — all
// rendered inside the map page. Off-course (GPS far from the green) it switches
// to a drag-to-measure marker. Admins get an Edit button.
export function HoleFlyover({
  courseName, holeNumber, par, strokeIndex,
  position, visible, onClose, onEdit,
  roundId, roundIndex, seenEnabled = false,
  // My score for this hole, for the missing-shot count (see useShotProposals).
  strokes = null, detail = null, pickedUp = false,
}) {
  const geometry = useCourseGeometry(courseName);
  const appSettings = useAppSettings();
  const tl = useT();
  const { units } = appSettings;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geometry]);

  // Logged shots for this hole, as plain {lat,lng,club} for the map layer.
  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const shotPinsRaw = roundId != null ? shotsForHole(roundId, roundIndex, holeNumber) : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shotPins = useMemo(() => shotPinsRaw.map((sh) => ({ lat: sh.lat, lng: sh.lng, club: sh.club })), [roundId, roundIndex, holeNumber, shotsVersion]);

  // Automatically detected shots as hollow "seen" pins; tapping one opens the
  // "Shot from here?" card. `missing` drives the pill and "+1 from here".
  const seen = useShotProposals({
    roundId, roundIndex, holeNumber, courseName, enabled: seenEnabled, strokes, detail, pickedUp,
  });
  const seenPins = useMemo(() => (seen.open.length ? seen.open.map((p) => ({ lat: p.lat, lng: p.lng })) : NO_SEEN), [seen.open]);
  const [seenIdx, setSeenIdx] = useState(null);
  // A card left open must not greet the next opening (or another hole).
  useEffect(() => { setSeenIdx(null); }, [visible, holeNumber]);
  const seenSel = seenIdx != null ? seen.open[seenIdx] ?? null : null;

  const anchorInfo = useMemo(() => {
    if (!feat) return null;
    const r = anchorFor({ player: position, tee: feat.start, greenCenter: feat.greenCenter });
    return { pos: r.anchor, source: r.source, playerDistance: r.playerDistance };
  }, [feat, position]);

  // Playing conditions, wind taken along the shot: the map's anchor (live fix
  // or tee) to the green centre — the same point the HUD measures from.
  const shotBearing = anchorInfo?.pos && feat?.greenCenter ? bearingDeg(anchorInfo.pos, feat.greenCenter) : null;
  const cond = usePlayConditions(courseName, shotBearing);
  // What the map's Plays row and breakdown need: multipliers + final copy.
  const plays = useMemo(() => {
    if (!cond.enabled) return null;
    const b = cond.breakdown(100);
    const est = cond.source === 'estimate';
    const { tempC, altitudeM } = cond.describe;
    return {
      air: (100 + b.air) / 100,
      wind: b.plays / (100 + b.air),
      approx: est,
      arrowDeg: cond.wind && cond.wind.kind !== 'calm' ? cond.wind.arrowDeg : null,
      windLine: windText(cond.wind) ?? tl('shared.conditions.noWind'),
      labels: {
        plays: tl('shared.conditions.plays'),
        measured: tl('shared.conditions.measured'),
        windRow: cond.wind && cond.wind.kind !== 'calm' ? windText(cond.wind, { row: true }) : null,
        air: tl(est ? 'shared.conditions.airEstimate' : 'shared.conditions.air', { temp: formatNumber(tempC), alt: formatNumber(altitudeM) }),
        total: tl('shared.conditions.playsLike'),
        foot: est
          ? tl('shared.conditions.noForecastMap')
          : `${tl('shared.conditions.forecastAt', { time: formatTime(cond.fetchedAt) })} · ${tl('shared.conditions.source')}`,
      },
    };
  }, [cond, tl]);

  // Top-left card: distance from the last logged shot to the green center, plus
  // a club tip for the next shot. Skipped when the setting is off, before any
  // real shot is marked (a lone seeded tee doesn't count), or once the ball is
  // on the green — in which case the club tip is dropped but the distance stays.
  //
  // Club tip visibility also depends on GPS. It's suppressed only when GPS is
  // giving us a real fix that places us OFF the course (physically not here) —
  // that's when a "club to hit next" tip would be misleading. With GPS off, or
  // GPS on but no usable fix (e.g. a desktop with no geolocation), the map is a
  // planning tool and the tip always shows. Distance to the green is unaffected.
  const lastShot = useMemo(() => {
    if (!appSettings.showLastShot || !feat?.greenCenter) return null;
    const last = shotPins[shotPins.length - 1];
    const seededTeeOnly = shotPins.length === 1 && !last?.club;
    if (!last || seededTeeOnly) return null;
    const pt = [last.lat, last.lng];
    const meters = haversineMeters(pt, feat.greenCenter);
    const onGreen = isOnGreen(pt, feat.green, feat.greenCenter);
    const gpsOn = appSettings.gpsEnabled !== false;
    const haveFix = anchorInfo?.playerDistance != null; // a real player position exists
    const offCourse = anchorInfo?.source !== 'gps';
    const suppressRec = gpsOn && haveFix && offCourse; // real fix, but not on the course
    let club = null;
    if (!onGreen && !suppressRec) {
      // Same guess as the shot tracker's picker: the driver only from the
      // hole's first mark (the tee).
      const rec = guessClub({
        meters, bearing: bearingDeg(pt, feat.greenCenter), courseName, settings: appSettings, fromTee: shotPins.length === 1, shots: getShots(),
      });
      club = rec ? clubLabel(rec.club) : null;
    }
    return { meters, club };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feat, shotPins, appSettings, anchorInfo, cond, courseName, shotsVersion]);

  const data = useMemo(() => (feat ? {
    mode: 'view',
    holeKey: `${courseName}#${holeNumber}#view`,
    holeLabel: tl('map.hole', { hole: formatNumber(holeNumber) }),
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
    seen: seenPins, // same for detected shots (option A)
    showRec: appSettings.showLastShot, // gates the top-left last-shot-to-green card
    lastShot, // initial paint; live updates arrive via the lastShot prop below
    plays, // initial paint; live updates arrive via the plays prop below
  } : null), [feat, courseName, holeNumber, position, anchorInfo, units, shotPins, seenPins, appSettings.showLastShot, lastShot, plays, tl]);

  // Latest aim state reported by the map: { pos, rings } — pos is the ring
  // nearest the green (for "Add shot" fallback), rings is the full
  // chain-ordered ring list (1 or 2 entries) for two-ring segment logging.
  const [aim, setAim] = useState(null);
  // Pending set-targets command sent down to the map (e.g. to collapse the
  // rings to the landing after a segment is logged).
  const [targetsCmd, setTargetsCmd] = useState(null);
  // Index of a shot pin tapped on the map, relayed to ShotTracker to open its
  // club wheel for that shot.
  const [tappedShot, setTappedShot] = useState(null);

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
        <Pressable
          style={s.backdropTouch}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tl('map.close')}
        />
        <Animated.View style={[s.sheet, { transform: [{ translateY: dragY }] }]}>
          <View {...pan.panHandlers}>
            <View style={s.grabber} testID="flyover-grabber" />
            <View style={s.header}>
              <View style={s.titleWrap}>
                <Text style={s.title} numberOfLines={1}>{feat ? tl('map.hole', { hole: formatNumber(holeNumber) }) : tl('map.noData')}</Text>
                {par != null && strokeIndex != null && (
                  <Text style={s.subtitle}>{tl('map.parSi', { par: formatNumber(par), si: formatNumber(strokeIndex) })}</Text>
                )}
              </View>
              <View style={s.hbtns}>
                {onEdit && feat && (
                  <Pressable onPress={onEdit} style={s.editBtn} hitSlop={8}>
                    <Feather name="edit-2" size={14} color={hud.onAccent} />
                    <Text style={s.editTxt}>{tl('map.edit')}</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={onClose}
                  style={s.closeBtn}
                  hitSlop={10}
                  testID="flyover-close"
                  accessibilityRole="button"
                  accessibilityLabel={tl('map.close')}
                >
                  <Feather name="x" size={22} color={hud.text} />
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
                seen={seenPins}
                onSeenTap={setSeenIdx}
                lastShot={lastShot}
                plays={plays}
                targets={targetsCmd}
                onShotMove={(i, p) => {
                  const sh = shotsForHole(roundId, roundIndex, holeNumber)[i];
                  if (sh) setShotPos(sh.id, p);
                }}
                onAim={(pos, rings) => setAim({ pos, rings })}
                onShotTap={setTappedShot}
                style={s.map}
              />
              {roundId != null && (
                <ShotTracker
                  roundId={roundId}
                  roundIndex={roundIndex}
                  holeNumber={holeNumber}
                  pos={position ?? null}
                  aimPos={aim?.pos ?? null}
                  aimRings={aim?.rings ?? null}
                  courseName={courseName}
                  targetPos={feat?.greenCenter ?? null}
                  greenPolygon={feat?.green ?? null}
                  // The seen card spans the bottom of the map; the FABs would
                  // sit under it, and marking a shot mid-review is a second
                  // decision on top of the card's.
                  hideFabs={!!seenSel}
                  tappedShotIndex={tappedShot}
                  onConsumeShotTap={() => setTappedShot(null)}
                  onCollapseTargets={(t) => setTargetsCmd(t)}
                  missing={seen.missing}
                />
              )}
              {seenSel ? (
                <SeenMapCard
                  proposal={seenSel}
                  missing={seen.missing}
                  onAdd={(p) => { seen.confirm([p]); setSeenIdx(null); }}
                  onPlusOne={(p) => { seen.plusOne(p); setSeenIdx(null); }}
                  onDismiss={() => { seen.dismiss(seenSel.id); setSeenIdx(null); }}
                />
              ) : <MissingPill missing={seen.missing} />}
            </View>
          ) : (
            <View style={s.center}><Text style={s.muted}>{tl('map.noGeometry')}</Text></View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,26,20,0.38)', justifyContent: 'flex-end' },
  // 48dp dismiss band (Android touch-target minimum). The sheet renders
  // after it, so any overlap on short screens stays owned by the sheet.
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, height: 48 },
  sheet: {
    height: '96%',
    backgroundColor: hud.bg,
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
  title: { color: hud.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: hud.textMuted, fontSize: 12, fontWeight: '600' },
  hbtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: hud.accent, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  editTxt: { color: hud.onAccent, fontWeight: '700', fontSize: 13 },
  closeBtn: { padding: 4 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: hud.textMuted, fontSize: 15 },
});
