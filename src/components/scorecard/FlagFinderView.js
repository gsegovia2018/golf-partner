import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { hud } from '../../theme/tokens';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useGpsDistances } from '../../hooks/useGpsDistances';
import { useCompassHeading } from '../../hooks/useCompassHeading';
import { bearingDeg, holeTargetPoint, normalizeDeltaDeg } from '../../lib/geo';
import { formatDistance, unitSuffix } from '../../lib/units';

// Half-width of the "flag is roughly ahead of you" cone, in degrees either
// side of the camera's centerline. Inside it we place a marker at the exact
// offset; outside it we fall back to a plain left/right chevron banner —
// there's no useful "x position" for a flag that's behind your shoulder.
const HALF_FOV_DEG = 30;

// A flag pill near a screen edge would get half-clipped by the icon's own
// width — this keeps it fully on-screen even at the ±1 extremes.
const MARKER_HALF_WIDTH = 30;

// Pure direction math for the overlay — no React, no I/O, easy to unit test.
// `heading`/`bearing` are both degrees clockwise from north. Returns either
// { mode: 'marker', x, deltaDeg } with x in [-1, 1] (screen-relative offset,
// -1 = left edge, +1 = right edge) when the flag is inside the camera's cone,
// or { mode: 'chevron', x: null, deltaDeg } when it's outside — deltaDeg's
// sign still tells the caller which side to point the chevron at (negative =
// left, positive = right; see normalizeDeltaDeg).
export function flagOverlayState({ heading, bearing, halfFovDeg = HALF_FOV_DEG }) {
  const deltaDeg = normalizeDeltaDeg(bearing - heading);
  if (Math.abs(deltaDeg) <= halfFovDeg) {
    return { mode: 'marker', x: deltaDeg / halfFovDeg, deltaDeg };
  }
  return { mode: 'chevron', x: null, deltaDeg };
}

// Full-screen "which way is the flag" camera view. Rendering is gated on
// `visible` at this outer layer so the GPS/compass watches (and the camera
// permission prompt) only run while the sheet is actually open — see
// FlagFinderContent below, which owns every hook that touches a live sensor.
export function FlagFinderView({ visible, courseName, holeNumber, onClose }) {
  if (!visible) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <FlagFinderContent courseName={courseName} holeNumber={holeNumber} onClose={onClose} />
    </Modal>
  );
}

// Everything below mounts/unmounts with the modal, which is what starts and
// stops the GPS watch (useGpsDistances) and the compass listener
// (useCompassHeading) — neither should run while the scorecard is just
// sitting there with the flag finder closed.
function FlagFinderContent({ courseName, holeNumber, onClose }) {
  const { units } = useAppSettings();

  const { position, accuracy, distances } = useGpsDistances(courseName, holeNumber);
  const { heading, lowAccuracy, status: compassStatus, requestPermission } = useCompassHeading();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Ask for the camera the moment the sheet opens, same as any other
  // permission-gated screen — the fallback (plain dark background, compass
  // still works) covers every way this can come back empty-handed.
  useEffect(() => {
    if (cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain !== false) {
      requestCameraPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPermission?.granted, cameraPermission?.canAskAgain]);

  const target = useMemo(
    () => holeTargetPoint(courseName, holeNumber),
    [courseName, holeNumber],
  );

  const overlay = useMemo(() => {
    if (!position || !target || heading == null) return null;
    const bearing = bearingDeg(position, target);
    return flagOverlayState({ heading, bearing });
  }, [position, target, heading]);

  const cameraGranted = !!cameraPermission?.granted;

  // Progressive states, checked in priority order — each one covers a way
  // the overlay can't yet (or ever) show a direction. Only the last case
  // renders the marker/chevron.
  let statusMessage = null;
  let statusAction = null;
  if (compassStatus === 'needs-permission') {
    statusAction = { label: 'Enable compass', onPress: requestPermission };
  } else if (compassStatus === 'unavailable') {
    statusMessage = 'Compass not available on this device';
  } else if (!position) {
    statusMessage = 'Locating GPS…';
  } else if (!target) {
    statusMessage = "This hole isn't mapped yet";
  } else if (heading == null) {
    statusMessage = 'Reading compass…';
  }

  const distanceMeters = distances?.pin ?? distances?.center ?? null;
  const screenWidth = Dimensions.get('window').width;
  const markerLeft = overlay?.mode === 'marker'
    ? Math.min(Math.max(((overlay.x + 1) / 2) * screenWidth, MARKER_HALF_WIDTH), screenWidth - MARKER_HALF_WIDTH)
    : 0;

  const poorGps = accuracy != null && accuracy > 15;

  return (
    <View style={s.root}>
      {cameraGranted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.noCamera]} />
      )}

      <View style={s.chrome} pointerEvents="box-none">
        <View style={s.topRow}>
          <Text style={s.holeLabel}>{`Hole ${holeNumber}`}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={s.closeBtn} accessibilityLabel="Close flag finder">
            <Feather name="x" size={22} color={hud.text} />
          </Pressable>
        </View>

        {!cameraGranted && (
          <Text style={s.cameraCaption}>Camera off — compass still works</Text>
        )}

        {statusAction ? (
          <View style={s.centerWrap}>
            <Pressable onPress={statusAction.onPress} style={s.enableBtn} accessibilityRole="button">
              <Text style={s.enableBtnText}>{statusAction.label}</Text>
            </Pressable>
          </View>
        ) : statusMessage ? (
          <View style={s.centerWrap}>
            <Text style={s.statusText}>{statusMessage}</Text>
          </View>
        ) : overlay?.mode === 'marker' ? (
          <View style={[s.marker, { left: markerLeft, top: '40%' }]}>
            <View style={s.markerPill}>
              <Feather name="flag" size={16} color={hud.text} />
            </View>
            {distanceMeters != null && (
              <Text style={s.markerDistance}>{`${formatDistance(distanceMeters, units)}${unitSuffix(units)}`}</Text>
            )}
          </View>
        ) : overlay?.mode === 'chevron' ? (
          <View style={s.centerWrap}>
            <Text style={s.chevronText}>
              {overlay.deltaDeg < 0
                ? `◀ Flag · ${Math.round(Math.abs(overlay.deltaDeg))}° to your left`
                : `Flag · ${Math.round(overlay.deltaDeg)}° to your right ▶`}
            </Text>
          </View>
        ) : null}

        <View style={s.captions}>
          {poorGps && (
            <Text style={s.caption}>
              {`GPS accuracy ±${formatDistance(accuracy, units)}${unitSuffix(units)} — direction is approximate`}
            </Text>
          )}
          {lowAccuracy && (
            <Text style={s.caption}>Compass needs calibration — wave your phone in a figure 8</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// Fixed dark chrome, not the app's light/dark theme — same reasoning as
// HoleFlyover/HoleGeoEditor's `hud` tokens: this sits over a live camera feed
// (or a plain dark fallback standing in for one), so it needs to read the
// same in bright sun regardless of the player's theme setting.
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: hud.bg },
  noCamera: { backgroundColor: hud.bg },
  chrome: { flex: 1 },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 54, paddingHorizontal: 18,
  },
  holeLabel: { color: hud.text, fontSize: 18, fontWeight: '800' },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: hud.scrim,
  },
  cameraCaption: { color: hud.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 },
  centerWrap: {
    position: 'absolute', left: 0, right: 0, top: '40%', alignItems: 'center', paddingHorizontal: 24,
  },
  statusText: { color: hud.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  enableBtn: { backgroundColor: hud.accent, borderRadius: 24, paddingVertical: 12, paddingHorizontal: 24 },
  enableBtnText: { color: hud.onAccent, fontSize: 15, fontWeight: '800' },
  marker: { position: 'absolute', alignItems: 'center', width: MARKER_HALF_WIDTH * 2, marginLeft: -MARKER_HALF_WIDTH },
  markerPill: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: hud.scrim,
    alignItems: 'center', justifyContent: 'center',
  },
  markerDistance: {
    color: hud.text, fontSize: 14, fontWeight: '800', marginTop: 6,
    textShadowColor: hud.scrim, textShadowRadius: 4,
  },
  chevronText: {
    color: hud.text, fontSize: 18, fontWeight: '800', textAlign: 'center',
    backgroundColor: hud.scrim, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12,
  },
  captions: { position: 'absolute', left: 0, right: 0, bottom: 34, alignItems: 'center', gap: 4, paddingHorizontal: 24 },
  caption: { color: hud.textMuted, fontSize: 11, textAlign: 'center' },
});
