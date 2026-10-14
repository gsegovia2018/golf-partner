import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT, formatNumber } from '../../i18n';
import { holeFeatures } from '../../lib/geo';
import { useCourseGeometry } from '../../hooks/useCourseGeometry';
import { hud } from '../../theme/tokens';
import { courseKeyFor } from '../../store/tileCache';
import { useAppSettings } from '../../hooks/useAppSettings';
import { subscribeShots, getShotsVersion, shotsForHole } from '../../store/shotStore';
import { HoleMapView } from './HoleMapView';

// Read-only playback of one already-played hole: the satellite map with the
// numbered shot pins and carry chips exactly as they were marked. Unlike
// HoleFlyover there is no GPS, no aim ring and no shot editing — it is opened
// from the stats screens to answer "where was that shot", so the map is inert
// (see holeMapHtml's 'replay' mode).
export function ShotReplaySheet({
  visible, onClose, courseName, holeNumber, par, strokeIndex,
  roundId, roundIndex, caption,
}) {
  const geometry = useCourseGeometry(courseName);
  const { units } = useAppSettings();
  const tl = useT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geometry]);

  const shotsVersion = useSyncExternalStore(subscribeShots, getShotsVersion, getShotsVersion);
  const shots = useMemo(() => (roundId == null ? [] : shotsForHole(roundId, roundIndex, holeNumber)
    .map((sh) => ({ lat: sh.lat, lng: sh.lng, club: sh.club }))),
  // shotsVersion is the store's change signal — shotsForHole reads mutable state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [roundId, roundIndex, holeNumber, shotsVersion]);

  const data = useMemo(() => (feat ? {
    mode: 'replay',
    holeKey: `${courseName}#${holeNumber}#replay#${roundId}:${roundIndex}`,
    holeLabel: tl('map.hole', { hole: formatNumber(holeNumber) }),
    courseKey: courseKeyFor(courseName),
    green: feat.green || null,
    greenFront: feat.greenFront || null,
    greenCenter: feat.greenCenter || null,
    greenBack: feat.greenBack || null,
    tee: feat.start || null,
    hazards: feat.hazards || [],
    player: null,
    anchor: null,
    units,
    shots,
    showRec: false,
    lastShot: null,
  } : null), [feat, courseName, holeNumber, roundId, roundIndex, units, shots, tl]);

  if (!visible) return null;

  const meta = [
    par != null ? tl('map.par', { par: formatNumber(par) }) : null,
    strokeIndex != null ? tl('map.si', { si: formatNumber(strokeIndex) }) : null,
    courseName || null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable
          style={s.backdropTouch}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tl('map.close')}
        />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.header}>
            <View style={s.titleWrap}>
              <Text style={s.title} numberOfLines={1}>
                {feat ? tl('map.hole', { hole: formatNumber(holeNumber) }) : tl('map.noData')}
              </Text>
              {(caption || meta) ? (
                <Text style={s.subtitle} numberOfLines={1}>{caption || meta}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              style={s.closeBtn}
              hitSlop={10}
              testID="replay-close"
              accessibilityRole="button"
              accessibilityLabel={tl('map.close')}
            >
              <Feather name="x" size={22} color={hud.text} />
            </Pressable>
          </View>
          {data ? (
            <HoleMapView data={data} shots={shots} style={s.map} />
          ) : (
            <View style={s.center}>
              <Text style={s.muted}>{tl('map.noGeometry')}</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,26,20,0.38)', justifyContent: 'flex-end' },
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, height: 48 },
  sheet: {
    height: '92%',
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
  closeBtn: { padding: 4 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  muted: { color: hud.textMuted, fontSize: 15, textAlign: 'center' },
});
