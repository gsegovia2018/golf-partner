import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { deletePlayer, fetchPlayers, upsertPlayer } from '../store/libraryStore';

export default function PlayersLibraryScreen() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [handicap, setHandicap] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    try {
      setPlayers(await fetchPlayers());
    } finally {
      setLoading(false);
    }
  }

  function startEdit(p) {
    setEditingId(p.id);
    setName(p.name);
    setHandicap(String(p.handicap));
  }

  function cancelEdit() {
    setEditingId(null);
    setName('');
    setHandicap('');
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await upsertPlayer({ id: editingId ?? undefined, name: name.trim(), handicap });
      cancelEdit();
      await load();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p) {
    Alert.alert('Remove Player', `Remove ${p.name} from the library?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await deletePlayer(p.id);
          await load();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
      <Text style={styles.sectionTitle}>{editingId ? 'Edit Player' : 'Add Player'}</Text>
      <View style={styles.form}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="Name"
          placeholderTextColor="#484f58"
          keyboardAppearance="dark"
          selectionColor="#4caf50"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[styles.input, styles.hcpInput]}
          placeholder="HCP"
          placeholderTextColor="#484f58"
          keyboardType="numeric"
          keyboardAppearance="dark"
          selectionColor="#4caf50"
          value={handicap}
          onChangeText={setHandicap}
        />
        <TouchableOpacity style={styles.addBtn} onPress={save} disabled={saving || !name.trim()}>
          <Text style={styles.addBtnText}>{editingId ? 'Save' : '+'}</Text>
        </TouchableOpacity>
        {editingId && (
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit}>
            <Text style={styles.cancelBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionTitle}>Players</Text>
      {loading
        ? <ActivityIndicator color="#4caf50" style={{ marginTop: 20 }} />
        : players.length === 0
          ? <Text style={styles.empty}>No players yet. Add one above.</Text>
          : players.map((p) => (
            <View key={p.id} style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.playerName}>{p.name}</Text>
                <Text style={styles.hcpLabel}>HCP {p.handicap}</Text>
              </View>
              <TouchableOpacity style={styles.editBtn} onPress={() => startEdit(p)}>
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(p)}>
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
  hcpInput: { width: 64, textAlign: 'center' },
  addBtn: { backgroundColor: '#22c55e', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  cancelBtn: { backgroundColor: '#0c1a28', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1c3250' },
  cancelBtnText: { color: '#7a8fa8', fontSize: 16 },
  empty: { color: '#364f68', fontSize: 14, marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c1a28',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
  },
  rowLeft: { flex: 1 },
  playerName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  hcpLabel: { color: '#7a8fa8', fontSize: 12, marginTop: 3, fontWeight: '500' },
  editBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  editBtnText: { color: '#4ade80', fontSize: 13, fontWeight: '700' },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  deleteBtnText: { color: '#f87171', fontSize: 15 },
});
