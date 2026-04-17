import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import { deletePlayer, fetchPlayers, upsertPlayer } from '../store/libraryStore';

export default function PlayersLibraryScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const s = makeStyles(theme);

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
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Jugadores</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        <Text style={s.sectionTitle}>{editingId ? 'Editar jugador' : 'Nuevo jugador'}</Text>
        <View style={s.form}>
          <TextInput
            style={[s.input, s.flex]}
            placeholder="Nombre"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={[s.input, s.hcpInput]}
            placeholder="HCP"
            placeholderTextColor={theme.text.muted}
            keyboardType="numeric"
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={handicap}
            onChangeText={setHandicap}
          />
          <TouchableOpacity style={s.addBtn} onPress={save} disabled={saving || !name.trim()} activeOpacity={0.7}>
            <Feather name={editingId ? 'check' : 'plus'} size={20} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          </TouchableOpacity>
          {editingId && (
            <TouchableOpacity style={s.cancelBtn} onPress={cancelEdit} activeOpacity={0.7}>
              <Feather name="x" size={18} color={theme.text.secondary} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={s.sectionTitle}>Lista</Text>
        {loading
          ? <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
          : players.length === 0
            ? (
              <View style={s.emptyState}>
                <Feather name="users" size={48} color={theme.text.muted} />
                <Text style={s.emptyTitle}>Sin jugadores</Text>
                <Text style={s.emptySubtitle}>Añade jugadores para usarlos en tus torneos</Text>
              </View>
            )
            : players.map((p, index) => (
              <Animated.View key={p.id} entering={FadeInDown.delay(index * 50).duration(300).springify()}>
                <View style={s.row}>
                  <View style={s.rowLeft}>
                    <Text style={s.playerName}>{p.name}</Text>
                    <Text style={s.hcpLabel}>HCP {p.handicap}</Text>
                  </View>
                  <TouchableOpacity style={s.editBtn} onPress={() => startEdit(p)} activeOpacity={0.7}>
                    <Feather name="edit-2" size={16} color={theme.accent.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => remove(p)} activeOpacity={0.7}>
                    <Feather name="trash-2" size={16} color={theme.destructive} />
                  </TouchableOpacity>
                </View>
              </Animated.View>
            ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, marginTop: 16, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, padding: 13, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  hcpInput: { width: 64, textAlign: 'center' },
  addBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: theme.isDark ? 1 : 0, borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  cancelBtn: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.border.default,
  },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18 },
  emptySubtitle: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 14, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  rowLeft: { flex: 1 },
  playerName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16 },
  hcpLabel: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 3 },
  editBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
});
