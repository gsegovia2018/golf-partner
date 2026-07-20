import React, { useMemo, useState, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  holeFeatures, findCourseGeometry,
  subscribeCourseGeometry, getCourseGeometryVersion,
} from '../../lib/geo';
import { supabase } from '../../lib/supabase';
import { hydrateCourseGeometry } from '../../store/courseGeometryStore';
import { courseKeyFor } from '../../store/tileCache';
import { HoleMapView } from './HoleMapView';

const FIELDS = [
  { key: 'front', label: 'Front', color: '#ffd166' },
  { key: 'center', label: 'Center', color: '#ffffff' },
  { key: 'back', label: 'Back', color: '#ef8a5b' },
  { key: 'tee', label: 'Tee', color: '#2f6bff' },
];

// Admin-only editor over the interactive satellite map. Tap to place the
// green's front / center / back (and optional tee) for one hole, then save to
// golf_hole. Center is required; the rest optional. Prefilled from existing
// geometry. Pan/zoom the map freely; tapping drops the active point.
export function HoleGeoEditor({ courseName, holeNumber, visible, onClose, onSaved }) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geomVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const courseId = useMemo(() => findCourseGeometry(courseName)?.key ?? null, [courseName, geomVersion]);

  const [pts, setPts] = useState(() => ({
    front: feat?.greenFront ?? null,
    center: feat?.greenCenter ?? null,
    back: feat?.greenBack ?? null,
    tee: feat?.start ?? null,
  }));
  const [active, setActive] = useState(1); // default: Center
  const [saving, setSaving] = useState(false);

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
    if (!pts.center) { Alert.alert('Center required', 'Tap to set at least the green center.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('golf_hole').update({
        green_center: pts.center, green_front: pts.front, green_back: pts.back, start_pt: pts.tee,
      }).eq('course_id', courseId).eq('number', holeNumber);
      if (error) throw error;
      await hydrateCourseGeometry();
      onSaved?.();
      onClose?.();
    } catch (err) {
      Alert.alert('Save failed', err?.message ?? 'Could not save geometry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.title}>Edit Hole {holeNumber}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Feather name="x" size={22} color="#fff" /></Pressable>
        </View>

        {!feat ? (
          <View style={s.center}><Text style={s.muted}>No base geometry for this hole.</Text></View>
        ) : (
          <>
            <View style={s.seg}>
              {FIELDS.map((f, i) => (
                <Pressable key={f.key} onPress={() => setActive(i)} style={[s.segBtn, i === active && s.segOn]}>
                  <View style={[s.dot, { backgroundColor: f.color }]} />
                  <Text style={[s.segTxt, i === active && s.segTxtOn]}>{f.label}</Text>
                  <Feather name={pts[f.key] ? 'check' : 'plus'} size={13} color={i === active ? '#0a0d10' : (pts[f.key] ? '#57ae5b' : '#9fb0a4')} />
                </Pressable>
              ))}
            </View>
            <HoleMapView data={data} activeField={FIELDS[active].key} onPoint={onPoint} style={s.map} />
            <Pressable style={[s.save, saving && s.saveOff]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#0a0d10" /> : <Text style={s.saveTxt}>Save hole {holeNumber}</Text>}
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0d10' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 52, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#9fb0a4', fontSize: 15 },
  seg: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: '#23332a', backgroundColor: '#131c17' },
  segOn: { backgroundColor: '#57ae5b', borderColor: '#3f8f43' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  segTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  segTxtOn: { color: '#0a0d10' },
  map: { flex: 1 },
  save: { margin: 14, backgroundColor: '#57ae5b', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveOff: { opacity: 0.6 },
  saveTxt: { color: '#0a0d10', fontWeight: '800', fontSize: 15 },
});
