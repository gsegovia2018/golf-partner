import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, Alert, Image, Platform,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { v4 as uuidv4 } from 'uuid';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useT, formatNumber } from '../i18n';
import { semantic } from '../theme/tokens';
import { fetchMyPlayers, getCachedMyPlayers } from '../store/libraryStore';
import { rosterCap } from '../store/tournamentStore';
import { tournamentsIndex } from '../store/tournamentsIndex';
import { setPendingPlayers } from '../lib/selectionBridge';
import { buildPlayerLastUsed } from '../lib/recentUse';
import { mutate } from '../store/mutate';
import { parseHandicapIndex } from '../lib/handicap';

const normalize = (value) =>
  (value ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export default function PlayerPickerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const userId = useAuth()?.user?.id ?? null;
  const s = makeStyles(theme);

  // `kind` drives the roster cap (Task 3, audit-tier3): a tournament has no
  // real cap, only a casual game stays capped at a foursome. Callers that
  // don't pass `kind` (none currently do) default to the old 'game' (4)
  // behavior so this never silently opens up an uncapped picker.
  const { alreadySelectedIds = [], kind } = route.params;
  const maxSelectable = rosterCap(kind ?? 'game') - alreadySelectedIds.length;

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [pickedIds, setPickedIds] = useState([]);
  const [newName, setNewName] = useState('');
  const [newHcp, setNewHcp] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [lastUsed, setLastUsed] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const hasLoadedOnceRef = useRef(false);
  // Players added on this screen. The fresh list can land after an add made
  // on the cached one, and the add may still be queued offline, so they are
  // kept on top of whatever list arrives.
  const addedRef = useRef([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let shown = false;
      const show = (list) => {
        if (cancelled) return;
        const ids = new Set(list.map((p) => p.id));
        setPlayers([...list, ...addedRef.current.filter((p) => !ids.has(p.id))]);
        setLoading(false);
        shown = true;
      };
      if (!hasLoadedOnceRef.current) setLoading(true);
      setLoadError(null);
      // Recent-use order comes from the local tournaments index: no network,
      // and best-effort (alphabetical without it).
      tournamentsIndex.readIndex()
        .then((rows) => { if (!cancelled) setLastUsed(buildPlayerLastUsed(rows)); })
        .catch(() => {});
      // Cache first so the list shows at once, then the fresh list replaces
      // it. A failed fetch is only an error when nothing is on screen.
      getCachedMyPlayers(userId)
        .then((cached) => { if (cached?.length && !shown) show(cached); })
        .catch(() => {});
      fetchMyPlayers()
        .then(show)
        .catch((err) => {
          if (!cancelled && !shown) setLoadError(err?.message ?? t('players.loadFailed'));
        })
        .finally(() => {
          if (!cancelled) {
            hasLoadedOnceRef.current = true;
            setLoading(false);
          }
        });
      return () => { cancelled = true; };
    }, [reloadKey, t, userId]),
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
    // Reject a genuinely bad handicap (garbage, out of range) up front rather
    // than silently saving it as 0 — a comma-locale Android keyboard yields
    // "12,5" here, which parseHandicapIndex now normalizes on its own, so
    // this only fires for actual typos.
    const parsedHcp = parseHandicapIndex(handicap);
    if (!parsedHcp.ok && parsedHcp.reason === 'invalid') {
      Alert.alert(t('players.invalidHcpTitle'), t('players.invalidHcpBody'));
      return;
    }
    setSaving(true);
    try {
      const playerId = uuidv4();
      const hcp = parsedHcp.ok ? parsedHcp.value : 0;
      // Gender is not asked for here — quick-added guests default to male;
      // exceptions are edited later in the Players library.
      const player = { id: playerId, name: trimmed, handicap: hcp, gender: 'male' };
      await mutate(null, {
        type: 'player.upsertLibrary',
        playerId,
        name: player.name,
        handicap: hcp,
        gender: 'male',
      });
      addedRef.current.push(player);
      setPlayers((prev) => [...prev, player]);
      setNewName('');
      setNewHcp('');
      setQuery('');
      setPickedIds((prev) => {
        if (prev.length >= maxSelectable) return prev;
        return [...prev, player.id];
      });
    } catch (e) {
      Alert.alert(t('players.errorTitle'), e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{t('players.picker.title')}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={theme.text.muted} style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder={t('players.picker.searchPlaceholder')}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <IconButton icon="x" onPress={() => setQuery('')} style={s.searchClear} />
          ) : null}
        </View>

        <Text style={s.sectionTitle}>{t('players.picker.newSection')}</Text>
        <View style={s.form}>
          <TextInput
            style={[s.input, s.flex]}
            placeholder={t('players.namePlaceholder')}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={[s.input, s.hcpInput]}
            placeholder={t('players.hcpPlaceholder')}
            placeholderTextColor={theme.text.muted}
            keyboardType="decimal-pad"
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={newHcp}
            onChangeText={setNewHcp}
          />
          <TouchableOpacity style={s.addBtn} onPress={() => addAndSelect()} disabled={saving || !newName.trim()}>
            <Feather name="plus" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            <Text style={s.addBtnText}>{t('players.add')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.sectionTitle}>{t('players.picker.librarySection')}</Text>
        {loading ? (
          <ActivityIndicator color={theme.accent.primary} style={{ marginTop: 20 }} />
        ) : loadError ? (
          <View style={s.errorBox}>
            <Feather name="wifi-off" size={44} color={theme.destructive} />
            <Text style={s.errorTitle}>{t('players.loadFailedTitle')}</Text>
            <Text style={s.errorMsg}>{loadError}</Text>
            <TouchableOpacity
              style={s.retryBtn}
              onPress={() => setReloadKey((k) => k + 1)}
              activeOpacity={0.7}
            >
              <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
              <Text style={s.retryBtnText}>{t('players.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : players.length === 0 ? (
          <Text style={s.empty}>{t('players.picker.empty')}</Text>
        ) : filteredPlayers.length === 0 ? (
          <>
            <Text style={s.empty}>{t('players.picker.noMatch', { query })}</Text>
            {query.trim() ? (
              <TouchableOpacity
                style={s.createCta}
                onPress={() => addAndSelect({ name: query, handicap: 0 })}
                disabled={saving || pickedIds.length >= maxSelectable}
                activeOpacity={0.7}
              >
                <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 6 }} />
                <Text style={s.createCtaText}>{t('players.picker.create', { query: query.trim() })}</Text>
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
                    <View style={s.nameRow}>
                      <Text style={[s.playerName, alreadyAdded && s.textMuted]}>{p.name}</Text>
                      {p.user_id ? (
                        <View style={s.linkedBadge}>
                          <Feather name="user-check" size={10} color={theme.accent.primary} />
                          <Text style={s.linkedBadgeText}>{t('players.picker.appUser')}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.hcpLabel}>{t('players.hcp', { hcp: formatNumber(p.handicap) })}</Text>
                  </View>
                  {alreadyAdded
                    ? <Text style={s.addedBadge}>{t('players.picker.added')}</Text>
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
              {t('players.picker.addPlayers', { count: pickedIds.length })}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScreenContainer>
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
  // minWidth:0 lets the flexible name field shrink below its intrinsic
  // content width; without it the fixed HCP field + Add button get pushed
  // off the right edge on narrow screens.
  flex: { flex: 1, minWidth: 0 },
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
    fontFamily: 'PlusJakartaSans-ExtraBold', color: semantic.winner.dark, fontSize: 13,
  },
  playerName: {
    color: theme.text.primary,
    fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold',
  },
  textMuted: { color: theme.text.muted },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  linkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: theme.accent.light,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  linkedBadgeText: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 9,
    color: theme.accent.primary, letterSpacing: 0.3,
  },
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
  errorBox: {
    alignItems: 'center', padding: 24, marginTop: 12,
    backgroundColor: theme.bg.card, borderRadius: 16,
    borderWidth: 1, borderColor: theme.border.default,
  },
  errorTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 15, marginTop: 10,
  },
  errorMsg: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 13, marginTop: 4, textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.accent.light, borderRadius: 10,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 14,
  },
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
