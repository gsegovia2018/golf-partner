import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchCourses, upsertCourse, defaultHoles, saveCourseHoles } from '../store/libraryStore';
import { setPendingCourses } from '../lib/selectionBridge';

export default function CoursePickerScreen({ navigation, route }) {
  const { roundIndex } = route.params;

  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchCourses().then(setCourses).finally(() => setLoading(false));
    }, []),
  );

  function toggleCourse(course) {
    setSelectedCourses((prev) => {
      const exists = prev.find((c) => c.id === course.id);
      if (exists) return prev.filter((c) => c.id !== course.id);
      return [...prev, course];
    });
  }

  function confirm() {
    setPendingCourses({ startRoundIndex: roundIndex, courses: selectedCourses });
    navigation.goBack();
  }

  async function addAndSelect() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const holes = defaultHoles();
      const course = await upsertCourse({ name: newName.trim(), slope: null });
      await saveCourseHoles(course.id, holes);
      const full = { ...course, holes };
      setCourses((prev) => [...prev, full]);
      setNewName('');
      setSelectedCourses((prev) => [...prev, full]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
        <Text style={styles.sectionTitle}>New Course</Text>
        <View style={styles.form}>
          <TextInput
            style={[styles.input, styles.flex]}
            placeholder="Course name"
            placeholderTextColor="#364f68"
            keyboardAppearance="dark"
            selectionColor="#4ade80"
            value={newName}
            onChangeText={setNewName}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addAndSelect} disabled={saving || !newName.trim()}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Library</Text>
        {loading
          ? <ActivityIndicator color="#4ade80" style={{ marginTop: 20 }} />
          : courses.length === 0
            ? <Text style={styles.empty}>No courses in library yet.</Text>
            : courses.map((c) => {
              const selIdx = selectedCourses.findIndex((s) => s.id === c.id);
              const isPicked = selIdx !== -1;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.row, isPicked && styles.rowPicked]}
                  onPress={() => toggleCourse({ id: c.id, name: c.name, slope: c.slope, holes: c.holes.length === 18 ? c.holes : defaultHoles() })}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowLeft}>
                    <Text style={styles.courseName}>{c.name}</Text>
                    <Text style={styles.courseMeta}>
                      Par {c.holes.reduce((s, h) => s + h.par, 0)}
                      {c.slope ? `  ·  Slope ${c.slope}` : ''}
                    </Text>
                  </View>
                  {isPicked
                    ? <View style={styles.orderBadge}><Text style={styles.orderBadgeText}>{selIdx + 1}</Text></View>
                    : <View style={styles.emptyCircle} />}
                </TouchableOpacity>
              );
            })}
      </ScrollView>

      {selectedCourses.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
            <Text style={styles.confirmBtnText}>
              Add {selectedCourses.length} Round{selectedCourses.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  sectionTitle: { color: '#364f68', fontWeight: '700', fontSize: 11, marginBottom: 12, marginTop: 8, letterSpacing: 1.8, textTransform: 'uppercase' },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 12, borderWidth: 1,
    borderColor: '#1c3250', padding: 13, fontSize: 15, fontWeight: '500',
  },
  addBtn: { backgroundColor: '#22c55e', borderRadius: 12, paddingHorizontal: 16, height: 44, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  empty: { color: '#364f68', fontSize: 14, marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c1a28',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
  },
  rowPicked: { borderColor: '#22c55e', backgroundColor: '#031a0a' },
  rowLeft: { flex: 1 },
  courseName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  courseMeta: { color: '#7a8fa8', fontSize: 12, marginTop: 3, fontWeight: '500' },
  orderBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  orderBadgeText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  emptyCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#1c3250' },
  footer: {
    paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1c3250',
    backgroundColor: '#070d15',
  },
  confirmBtn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
