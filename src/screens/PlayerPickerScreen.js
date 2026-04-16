import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPlayers, upsertPlayer } from '../store/libraryStore';
import { setPendingPlayers } from '../lib/selectionBridge';

export default function PlayerPickerScreen({ navigation, route }) {
  const { alreadySelectedIds = [] } = route.params;
  const maxSelectable = 4 - alreadySelectedIds.length;

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickedIds, setPickedIds] = useState([]);
  const [newName, setNewName] = useState('');
  const [newHcp, setNewHcp] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchPlayers().then(setPlayers).finally(() => setLoading(false));
    }, []),
  );

  function togglePlayer(player) {
    setPickedIds((prev) => {
      if (prev.includes(player.id)) return prev.filter((id) => id !== player.id);
      if (prev.length >= maxSelectable) return prev;
      return [...prev, player.id];
    });
  }

  function confirm() {
    const selected = players.filter((p) => pickedIds.includes(p.id));
    setPendingPlayers(selected);
    navigation.goBack();
  }

  async function addAndSelect() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const player = await upsertPlayer({ name: newName.trim(), handicap: newHcp });
      setPlayers((prev) => [...prev, player]);
      setNewName('');
      setNewHcp('');
      setPickedIds((prev) => {
        if (prev.length >= maxSelectable) return prev;
        return [...prev, player.id];
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
        <Text style={styles.sectionTitle}>New Player</Text>
        <View style={styles.form}>
          <TextInput
            style={[styles.input, styles.flex]}
            placeholder="Name"
            placeholderTextColor="#364f68"
            keyboardAppearance="dark"
            selectionColor="#4ade80"
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={[styles.input, styles.hcpInput]}
            placeholder="HCP"
            placeholderTextColor="#364f68"
            keyboardType="numeric"
            keyboardAppearance="dark"
            selectionColor="#4ade80"
            value={newHcp}
            onChangeText={setNewHcp}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addAndSelect} disabled={saving || !newName.trim()}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Library</Text>
        {loading
          ? <ActivityIndicator color="#4ade80" style={{ marginTop: 20 }} />
          : players.length === 0
            ? <Text style={styles.empty}>No players in library yet.</Text>
            : players.map((p) => {
              const alreadyAdded = alreadySelectedIds.includes(p.id);
              const picked = pickedIds.includes(p.id);
              const disabled = alreadyAdded || (!picked && pickedIds.length >= maxSelectable);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.row, alreadyAdded && styles.rowAdded, picked && styles.rowPicked]}
                  onPress={() => !alreadyAdded && togglePlayer(p)}
                  disabled={alreadyAdded}
                  activeOpacity={disabled ? 1 : 0.7}
                >
                  <View style={styles.rowLeft}>
                    <Text style={[styles.playerName, alreadyAdded && styles.textMuted]}>{p.name}</Text>
                    <Text style={styles.hcpLabel}>HCP {p.handicap}</Text>
                  </View>
                  {alreadyAdded
                    ? <Text style={styles.addedBadge}>Added</Text>
                    : picked
                      ? <View style={styles.checkCircle}><Text style={styles.checkMark}>✓</Text></View>
                      : <View style={styles.emptyCircle} />}
                </TouchableOpacity>
              );
            })}
      </ScrollView>

      {pickedIds.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
            <Text style={styles.confirmBtnText}>
              Add {pickedIds.length} Player{pickedIds.length !== 1 ? 's' : ''}
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
  hcpInput: { width: 64, textAlign: 'center' },
  addBtn: { backgroundColor: '#22c55e', borderRadius: 12, paddingHorizontal: 16, height: 44, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  empty: { color: '#364f68', fontSize: 14, marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0c1a28',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c3250', padding: 16, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
  },
  rowAdded: { opacity: 0.35 },
  rowPicked: { borderColor: '#22c55e', backgroundColor: '#031a0a' },
  rowLeft: { flex: 1 },
  playerName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  textMuted: { color: '#7a8fa8' },
  hcpLabel: { color: '#7a8fa8', fontSize: 12, marginTop: 3, fontWeight: '500' },
  addedBadge: { color: '#364f68', fontSize: 12, fontWeight: '700' },
  checkCircle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '900' },
  emptyCircle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#1c3250' },
  footer: {
    paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1c3250',
    backgroundColor: '#070d15',
  },
  confirmBtn: { backgroundColor: '#22c55e', borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
