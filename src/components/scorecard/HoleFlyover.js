import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  holeFeatures, subscribeCourseGeometry, getCourseGeometryVersion,
} from '../../lib/geo';
import { HoleMapView } from './HoleMapView';

// Full-screen interactive satellite flyover of one hole (Leaflet + Esri tiles,
// pan/zoom). Green markers/outline, your live position, a draggable aim ring
// with a double line (you → aim → green) and front/center/back distances — all
// rendered inside the map page. Off-course (GPS far from the green) it switches
// to a drag-to-measure marker. Admins get an Edit button.
export function HoleFlyover({ courseName, holeNumber, position, visible, onClose, onEdit }) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geomVersion]);

  const data = useMemo(() => (feat ? {
    mode: 'view',
    holeKey: `${courseName}#${holeNumber}#view`,
    holeLabel: `Hole ${holeNumber}`,
    green: feat.green || null,
    greenFront: feat.greenFront || null,
    greenCenter: feat.greenCenter || null,
    greenBack: feat.greenBack || null,
    tee: feat.start || null,
    hazards: feat.hazards || [],
    player: position || null,
  } : null), [feat, courseName, holeNumber, position]);

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>{feat ? `Hole ${holeNumber}` : 'No map data'}</Text>
          <View style={s.hbtns}>
            {onEdit && feat && (
              <Pressable onPress={onEdit} style={s.editBtn} hitSlop={8}>
                <Feather name="edit-2" size={15} color="#0a0d10" />
                <Text style={s.editTxt}>Edit</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8}>
              <Feather name="x" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
        {data ? (
          <HoleMapView data={data} player={position} style={s.map} />
        ) : (
          <View style={s.center}><Text style={s.muted}>This course has no green geometry yet.</Text></View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0d10' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 52, paddingBottom: 10 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1 },
  hbtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#57ae5b', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  editTxt: { color: '#0a0d10', fontWeight: '700', fontSize: 13 },
  closeBtn: { padding: 4 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#9fb0a4', fontSize: 15 },
});
