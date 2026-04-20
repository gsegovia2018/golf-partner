import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Alert, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { v4 as uuidv4 } from 'uuid';

import { useTheme } from '../theme/ThemeContext';
import { fetchPlayers } from '../store/libraryStore';
import { loadAllTournaments } from '../store/tournamentStore';
import { setPendingPlayers } from '../lib/selectionBridge';
import { buildPlayerLastUsed } from '../lib/recentUse';
import { mutate } from '../store/mutate';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function PlayerPickerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { alreadySelectedIds = [] } = route.params;
  const maxSelectable = 4 - alreadySelectedIds.length;

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickedIds, setPickedIds] = useState([]);
  const [newName, setNewName] = useState('');
  const [newHcp, setNewHcp] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [lastUsed, setLastUsed] = useState({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([fetchPlayers(), loadAllTournaments().catch(() => [])])
        .then(([list, tournaments]) => {
          if (cancelled) return;
          setPlayers(list);
          setLastUsed(buildPlayerLastUsed(tournaments));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, []),
  );

  const filteredPlayers = useMemo(() => {
    const q = normalize(query);
    const list = q
      ? players.filter((p) => normalize(p.name).includes(q))
      : players.slice();
    list.sort((a, b) => {
      const ta = lastUsed[a.id] ?? 0;
      const tb = lastUsed[b.id] ?? 0;
      if (ta !== tb) return tb - ta;
      return normalize(a.name).localeCompare(normalize(b.name));
    });
    return list;
  }, [players, query, lastUsed]);

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

  async function addAndSelect({ name, handicap } = { name: newName, handicap: newHcp }) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const playerId = uuidv4();
      const hcp = parseInt(handicap, 10) || 0;
      const player = { id: playerId, name: trimmed, handicap: hcp };
      await mutate(null, {
        type: 'player.upsertLibrary',
        playerId,
        name: player.name,
        handicap: hcp,
      });
      setPlayers((prev) => [...prev, player]);
      setNewName('');
      setNewHcp('');
      setQuery('');
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
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Select Players</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search players"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} style={s.searchClear} activeOpacity={0.7}>
              <Feather name="x" size={16} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={s.sectionTitle}>New Player</Text>
        <View style={s.form}>
          <TextInput
            style={[s.input, s.flex]}
            placeholder="Name"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={[s.input, s.hcpInput]}
            placeholder="HCP"
            placeholderTextColor={theme.text.muted}
            keyboardType="numeric"
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={newHcp}
            onChangeText={setNewHcp}
          />
          <TouchableOpacity style={s.addBtn} onPress={() => addAndSelect()} disabled={saving || !newName.trim()}>
            <Feather name="plus" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>Library</Text>
        {loading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
        ) : players.length === 0 ? (
          <Text style={s.empty}>No players in library yet.</Text>
        ) : filteredPlayers.length === 0 ? (
          <>
            <Text style={s.empty}>No players match "{query}"</Text>
            {query.trim() ? (
              <TouchableOpacity
                style={s.createCta}
                onPress={() => addAndSelect({ name: query, handicap: 0 })}
                disabled={saving || pickedIds.length >= maxSelectable}
                activeOpacity={0.7}
              >
                <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.createCtaText}>Create "{query.trim()}"</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          filteredPlayers.map((p) => {
            const alreadyAdded = alreadySelectedIds.includes(p.id);
            const picked = pickedIds.includes(p.id);
            const disabled = alreadyAdded || (!picked && pickedIds.length >= maxSelectable);
            return (
              <View key={p.id}>
                <TouchableOpacity
                  style={[s.row, alreadyAdded && s.rowAdded, picked && s.rowPicked]}
                  onPress={() => !alreadyAdded && togglePlayer(p)}
                  disabled={alreadyAdded}
                  activeOpacity={disabled ? 1 : 0.7}
                >
                  <View style={s.pickerAvatar}>
                    {p.avatar_url
                      ? <Image source={{ uri: p.avatar_url }} style={s.pickerAvatarImg} />
                      : <Text style={s.pickerAvatarText}>{(p.name ?? '?').slice(0, 2).toUpperCase()}</Text>}
                  </View>
                  <View style={s.rowLeft}>
                    <Text style={[s.playerName, alreadyAdded && s.textMuted]}>{p.name}</Text>
                    <Text style={s.hcpLabel}>HCP {p.handicap}</Text>
                  </View>
                  {alreadyAdded
                    ? <Text style={s.addedBadge}>Added</Text>
                    : picked
                      ? (
                        <View style={s.checkCircle}>
                          <Feather name="check" size={14} color={theme.text.inverse} />
                        </View>
                      )
                      : <View style={s.emptyCircle} />}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {pickedIds.length > 0 && (
        <View style={s.footer}>
          <TouchableOpacity style={s.confirmBtn} onPress={confirm}>
            <Text style={s.confirmBtnText}>
              Add {pickedIds.length} Player{pickedIds.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: {
    fontFamily: 'PlusJakartaSans-Bold',
    fontSize: 17,
    color: theme.text.primary,
  },
  content: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  sectionTitle: {
    color: theme.text.muted,
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 11,
    marginBottom: 12,
    marginTop: 8,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border.default,
    padding: 13,
    fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  hcpInput: { width: 64, textAlign: 'center' },
  addBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  addBtnText: {
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  empty: {
    color: theme.text.muted,
    fontSize: 14,
    fontFamily: 'PlusJakartaSans-Regular',
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bg.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  rowAdded: { opacity: 0.35 },
  rowPicked: {
    borderColor: theme.accent.primary,
    backgroundColor: theme.isDark ? theme.accent.primary + '10' : theme.accent.light,
  },
  rowLeft: { flex: 1 },
  pickerAvatar: {
    width: 36, height: 36, borderRadius: 18, marginRight: 12,
    backgroundColor: theme.isDark ? theme.bg.secondary : '#006747',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  pickerAvatarImg: { width: '100%', height: '100%' },
  pickerAvatarText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 13,
  },
  playerName: {
    color: theme.text.primary,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  textMuted: { color: theme.text.muted },
  hcpLabel: {
    color: theme.text.secondary,
    fontSize: 12,
    marginTop: 3,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  addedBadge: {
    color: theme.text.muted,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.accent.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.border.default,
    backgroundColor: theme.bg.secondary,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: theme.border.subtle,
    backgroundColor: theme.bg.primary,
  },
  confirmBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  confirmBtnText: {
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontFamily: 'PlusJakartaSans-ExtraBold',
    fontSize: 16,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingHorizontal: 12, marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 4,
    color: theme.text.primary, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
  createCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.accent.primary + '40', borderStyle: 'dashed',
    backgroundColor: theme.accent.light,
    padding: 14, marginTop: 8,
  },
  createCtaText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.accent.primary, fontSize: 14,
  },
});
