import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useT, formatNumber } from '../../i18n';
import { holeFeatures } from '../../lib/geo';
import { useCourseGeometry } from '../../hooks/useCourseGeometry';
import { supabase } from '../../lib/supabase';
import { hud } from '../../theme/tokens';
import { ensureCourseGeometry } from '../../store/courseGeometryStore';
import { courseKeyFor } from '../../store/tileCache';
import { HoleMapView } from './HoleMapView';

const FIELDS = [
  { key: 'front', labelKey: 'map.point.front', color: '#ffd166' },
  { key: 'center', labelKey: 'map.point.center', color: '#ffffff' },
  { key: 'back', labelKey: 'map.point.back', color: '#ef8a5b' },
  { key: 'tee', labelKey: 'map.point.tee', color: '#2f6bff' },
];

// Admin-only editor over the interactive satellite map. Tap to place the
// green's front / center / back (and optional tee) for one hole, then save to
// golf_hole. Center is required; the rest optional. Prefilled from existing
// geometry. Pan/zoom the map freely; tapping drops the active point.
export function HoleGeoEditor({ courseName, holeNumber, visible, onClose, onSaved }) {
  const tl = useT();
  const geometry = useCourseGeometry(courseName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geometry]);
  const courseId = geometry?.key ?? null;

  const seedPts = () => ({
    front: feat?.greenFront ?? null,
    center: feat?.greenCenter ?? null,
    back: feat?.greenBack ?? null,
    tee: feat?.start ?? null,
  });
  const [pts, setPts] = useState(seedPts);
  const [active, setActive] = useState(1); // default: Center
  const [saving, setSaving] = useState(false);

  // The editor stays mounted while hidden (HoleView toggles `visible` as the
  // pager moves between holes), so state must re-seed from the current hole's
  // geometry on every open — not just on first mount.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPts(seedPts());
      setActive(1);
    }
  }

  const data = useMemo(() => (feat ? {
    mode: 'edit',
    holeKey: `${courseName}#${holeNumber}#edit`,
    courseKey: courseKeyFor(courseName),
    green: feat.green || null,
    greenFront: pts.front,
    greenCenter: pts.center,
    greenBack: pts.back,
    tee: pts.tee,
    hazards: feat.hazards || [],
    activeField: FIELDS[active].key,
    updateHole: true,
  } : null), [feat, courseName, holeNumber, pts, active]);

  if (!visible) return null;

  const onPoint = (field, pos, isDrag) => {
    setPts((p) => ({ ...p, [field]: pos }));
    // Tap-to-place advances to the next field; dragging an existing marker just
    // repositions it and keeps the active field where it is.
    if (!isDrag) setActive((a) => Math.min(a + 1, FIELDS.length - 1));
  };

  const save = async () => {
    if (!pts.center) { Alert.alert(tl('map.center.required'), tl('map.center.requiredBody')); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('golf_hole').update({
        green_center: pts.center, green_front: pts.front, green_back: pts.back, start_pt: pts.tee,
      }).eq('course_id', courseId).eq('number', holeNumber);
      if (error) throw error;
      await ensureCourseGeometry(courseId, { force: true });
      onSaved?.();
      onClose?.();
    } catch (err) {
      Alert.alert(tl('map.saveFailed'), err?.message ?? tl('map.saveFailedBody'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.title}>{tl('map.edit.title', { hole: formatNumber(holeNumber) })}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color={hud.text} /></Pressable>
        </View>

        {!feat ? (
          <View style={s.center}><Text style={s.muted}>{tl('map.noBase')}</Text></View>
        ) : (
          <>
            <View style={s.seg}>
              {FIELDS.map((f, i) => (
                <Pressable key={f.key} onPress={() => setActive(i)} style={[s.segBtn, i === active && s.segOn]}>
                  <View style={[s.dot, { backgroundColor: f.color }]} />
                  <Text style={[s.segTxt, i === active && s.segTxtOn]}>{tl(f.labelKey)}</Text>
                  <Feather name={pts[f.key] ? 'check' : 'plus'} size={13} color={i === active ? hud.onAccent : (pts[f.key] ? hud.accent : hud.textMuted)} />
                </Pressable>
              ))}
            </View>
            <HoleMapView data={data} activeField={FIELDS[active].key} onPoint={onPoint} style={s.map} />
            <Pressable style={[s.save, saving && s.saveOff]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={hud.onAccent} /> : <Text style={s.saveTxt}>{tl('map.save', { hole: formatNumber(holeNumber) })}</Text>}
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: hud.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 52, paddingBottom: 10 },
  title: { color: hud.text, fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: hud.textMuted, fontSize: 15 },
  seg: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: hud.border, backgroundColor: hud.inset },
  segOn: { backgroundColor: hud.accent, borderColor: hud.accentPressed },
  dot: { width: 9, height: 9, borderRadius: 5 },
  segTxt: { color: hud.text, fontSize: 13, fontWeight: '700' },
  segTxtOn: { color: hud.onAccent },
  map: { flex: 1 },
  save: { margin: 14, backgroundColor: hud.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveOff: { opacity: 0.6 },
  saveTxt: { color: hud.onAccent, fontWeight: '800', fontSize: 15 },
});
