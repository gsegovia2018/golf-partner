import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { deleteCourse, fetchCourses, upsertCourse } from '../store/libraryStore';

export default function CoursesLibraryScreen({ navigation }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    try {
      setCourses(await fetchCourses());
    } finally {
      setLoading(false);
    }
  }

  async function addCourse() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const course = await upsertCourse({ name: name.trim(), slope: null });
      setName('');
      navigation.navigate('CourseLibraryDetail', { courseId: course.id, courseName: course.name });
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    Alert.alert('Remove Course', `Remove "${c.name}" from the library?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await deleteCourse(c.id);
          await load();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <Text style={styles.sectionTitle}>Add Course</Text>
      <View style={styles.form}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="Course name"
          placeholderTextColor="#484f58"
          keyboardAppearance="dark"
          selectionColor="#4caf50"
          value={name}
          onChangeText={setName}
        />
        <TouchableOpacity style={styles.addBtn} onPress={addCourse} disabled={saving || !name.trim()}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Courses</Text>
      {loading
        ? <ActivityIndicator color="#4caf50" style={{ marginTop: 20 }} />
        : courses.length === 0
          ? <Text style={styles.empty}>No courses yet. Add one above.</Text>
          : courses.map((c) => (
            <View key={c.id} style={styles.row}>
              <TouchableOpacity
                style={styles.rowLeft}
                onPress={() => navigation.navigate('CourseLibraryDetail', { courseId: c.id, courseName: c.name })}
              >
                <Text style={styles.courseName}>{c.name}</Text>
                <Text style={styles.courseMeta}>
                  Par {c.holes.reduce((s, h) => s + h.par, 0)}
                  {c.slope ? `  ·  Slope ${c.slope}` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => navigation.navigate('CourseLibraryDetail', { courseId: c.id, courseName: c.name })}
              >
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(c)}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070d15' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  sectionTitle: { color: '#364f68', fontWeight: '700', fontSize: 11, marginBottom: 12, marginTop: 16, letterSpacing: 1.8, textTransform: 'uppercase' },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: '#0c1a28', color: '#f1f5f9', borderRadius: 12, borderWidth: 1,
    borderColor: '#1c3250', padding: 13, fontSize: 15, fontWeight: '500',
  },
  addBtn: { backgroundColor: '#22c55e', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  empty: { color: '#364f68', fontSize: 14, marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c1a28',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
  },
  rowLeft: { flex: 1 },
  courseName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  courseMeta: { color: '#7a8fa8', fontSize: 12, marginTop: 3, fontWeight: '500' },
  editBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  editBtnText: { color: '#4ade80', fontSize: 13, fontWeight: '700' },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  deleteBtnText: { color: '#f87171', fontSize: 15 },
});
