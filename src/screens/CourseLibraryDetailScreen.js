import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { fetchCourses, saveCourseHoles, upsertCourse } from '../store/libraryStore';

const STANDARD_SLOPE = 113;

function calcPlayingHandicap(index, slope) {
  if (!slope || slope <= 0) return index;
  return Math.round(index * (slope / STANDARD_SLOPE));
}

function defaultHoles() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}

export default function CourseLibraryDetailScreen({ navigation, route }) {
  const { courseId, courseName: initialName } = route.params;

  const [name, setName] = useState(initialName ?? '');
  const [slope, setSlope] = useState('');
  const [holes, setHoles] = useState(defaultHoles());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: initialName || 'Course' });
    (async () => {
      const courses = await fetchCourses();
      const course = courses.find((c) => c.id === courseId);
      if (course) {
        setName(course.name);
        setSlope(course.slope ? String(course.slope) : '');
        if (course.holes.length === 18) setHoles(course.holes.map((h) => ({ ...h })));
      }
      setLoading(false);
    })();
  }, [courseId]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await upsertCourse({ id: courseId, name: name.trim(), slope: slope || null });
      await saveCourseHoles(courseId, holes);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  function setPar(i, par) {
    setHoles((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], par };
      return next;
    });
  }

  function setSI(i, value) {
    setHoles((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], strokeIndex: parseInt(value, 10) || 0 };
      return next;
    });
  }

  const totalPar = holes.reduce((s, h) => s + h.par, 0);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4caf50" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <TextInput
        style={styles.nameInput}
        value={name}
        onChangeText={setName}
        placeholder="Course name"
        placeholderTextColor="#484f58"
        keyboardAppearance="dark"
        selectionColor="#4caf50"
      />

      <View style={styles.slopeRow}>
        <Text style={styles.slopeLabel}>Course Slope</Text>
        <TextInput
          style={styles.slopeInput}
          keyboardType="numeric"
          maxLength={3}
          placeholder="e.g. 128"
          placeholderTextColor="#484f58"
          keyboardAppearance="dark"
          selectionColor="#4caf50"
          value={slope}
          onChangeText={setSlope}
        />
        <Text style={styles.slopeHint}>std 113</Text>
      </View>

      <Text style={styles.sectionTitle}>Holes  ·  Par {totalPar}</Text>
      <View style={styles.headerRow}>
        <Text style={[styles.col, styles.holeCol, styles.headerText]}>Hole</Text>
        <Text style={[styles.col, styles.parCol, styles.headerText]}>Par</Text>
        <Text style={[styles.col, styles.siCol, styles.headerText]}>SI</Text>
      </View>

      {holes.map((hole, i) => (
        <View key={hole.number} style={[styles.row, i % 2 === 1 && styles.altRow]}>
          <Text style={[styles.col, styles.holeCol, styles.holeNum]}>{hole.number}</Text>
          <View style={[styles.col, styles.parCol, styles.parPicker]}>
            {[3, 4, 5].map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.parBtn, hole.par === p && styles.parBtnActive]}
                onPress={() => setPar(i, p)}
              >
                <Text style={[styles.parBtnText, hole.par === p && styles.parBtnTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.col, styles.siCol, styles.siInput]}
            keyboardType="numeric"
            maxLength={2}
            keyboardAppearance="dark"
            selectionColor="#4caf50"
            value={hole.strokeIndex > 0 ? String(hole.strokeIndex) : ''}
            onChangeText={(v) => setSI(i, v)}
          />
        </View>
      ))}

      <TouchableOpacity style={[styles.btn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
        <Text style={styles.btnText}>{saving ? 'Saving…' : 'Save Course'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, backgroundColor: '#070d15', alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  nameInput: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 12, borderWidth: 1,
    borderColor: '#1c3250', padding: 14, fontSize: 18, fontWeight: '700', marginBottom: 16,
  },
  slopeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  slopeLabel: { color: '#c8d6e5', fontSize: 15, flex: 1, fontWeight: '600' },
  slopeInput: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 10, borderWidth: 1,
    borderColor: '#1c3250', width: 76, textAlign: 'center', fontSize: 16, fontWeight: '700', padding: 9,
  },
  slopeHint: { color: '#364f68', fontSize: 12 },
  sectionTitle: { color: '#4ade80', fontWeight: '700', fontSize: 11, marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase' },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1c3250', paddingBottom: 8, marginBottom: 4 },
  headerText: { color: '#4ade80', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  altRow: { backgroundColor: '#0c1a28' },
  col: { paddingHorizontal: 4 },
  holeCol: { width: 44 },
  parCol: { width: 110 },
  siCol: { width: 60 },
  holeNum: { color: '#7a8fa8', fontSize: 15, fontWeight: '600' },
  parPicker: { flexDirection: 'row', gap: 6 },
  parBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#112038', borderWidth: 1, borderColor: '#1c3250', alignItems: 'center', justifyContent: 'center',
  },
  parBtnActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  parBtnText: { color: '#364f68', fontWeight: '700', fontSize: 13 },
  parBtnTextActive: { color: '#fff', fontWeight: '800' },
  siInput: {
    backgroundColor: '#112038', color: '#f1f5f9', borderRadius: 8, borderWidth: 1,
    borderColor: '#1c3250', textAlign: 'center', fontSize: 15, fontWeight: '600', padding: 6,
  },
  btn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 17, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
