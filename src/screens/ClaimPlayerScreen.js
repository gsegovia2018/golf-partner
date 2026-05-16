import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { useTheme } from '../theme/ThemeContext';
import { getTournament, addPlayerRoundPatches } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { mutate } from '../store/mutate';

const MAX_PLAYERS = 4;

// Shown right after an editor joins via an invite code. They pick which
// existing player they are (links their account to that player) or add
// themselves as a new player. Skippable — claiming is optional.
export default function ClaimPlayerScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const tournamentId = route?.params?.tournamentId;

  const [tournament, setTournament] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Id of the player row currently being claimed — drives a per-row spinner.
  const [claimingId, setClaimingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHcp, setNewHcp] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, p] = await Promise.all([getTournament(tournamentId), loadProfile()]);
        if (cancelled) return;
        setTournament(t);
        setProfile(p);
        // Pre-fill the "add me" form with the joiner's own profile.
        setNewName(p?.displayName || (p?.email ? p.email.split('@')[0] : ''));
        setNewHcp(p?.handicap != null ? String(p.handicap) : '');
      } catch (err) {
        if (!cancelled) Alert.alert('Error', err.message ?? 'Could not load tournament');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  function done() {
    navigation.goBack();
  }

  async function claimExisting(player) {
    if (saving || !tournament || !profile) return;
    setSaving(true);
    setClaimingId(player.id);
    try {
      await mutate(tournament, {
        type: 'tournament.claimPlayer',
        playerId: player.id,
        userId: profile.userId,
      });
      done();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not link you to that player');
      setSaving(false);
      setClaimingId(null);
    }
  }

  async function addNewPlayer() {
    if (saving || !tournament || !profile) return;
    const name = newName.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter a name to add yourself.');
      return;
    }
    setSaving(true);
    try {
      const playerId = uuidv4();
      const player = {
        id: playerId,
        name,
        handicap: parseInt(newHcp, 10) || 0,
        user_id: profile.userId,
      };
      const roundPatches = addPlayerRoundPatches(tournament, player);
      const t = await mutate(tournament, {
        type: 'tournament.addPlayer', player, roundPatches,
      });
      await mutate(t, { type: 'tournament.setMe', meId: playerId });
      done();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not add you as a player');
      setSaving(false);
    }
  }

  const players = tournament?.players ?? [];
  const rosterFull = players.length >= MAX_PLAYERS;
  const noun = tournament?.kind === 'game' ? 'game' : 'tournament';
  // Already linked to me — nothing more to claim.
  const iAmClaimed = players.some((p) => p.user_id && p.user_id === profile?.userId);
  // Every player is linked to another account: claiming is a dead end unless
  // the joiner adds themselves (when there's room).
  const allTaken = players.length > 0
    && !iAmClaimed
    && players.every((p) => p.user_id && p.user_id !== profile?.userId);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={done} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Which player are you?</Text>
        <TouchableOpacity onPress={done} activeOpacity={0.7}>
          <Text style={s.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Text style={s.subtitle}>
            You joined this {noun} as an editor. Pick which player is you, or
            add yourself below.
          </Text>

          {players.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Players in this {noun}</Text>
              {players.map((p) => {
                const linkedToOther = p.user_id && p.user_id !== profile?.userId;
                const linkedToMe = p.user_id && p.user_id === profile?.userId;
                const isClaiming = claimingId === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[s.playerRow, linkedToOther && s.playerRowDisabled]}
                    onPress={() => claimExisting(p)}
                    disabled={saving || linkedToOther}
                    activeOpacity={0.7}
                  >
                    <View style={s.playerAvatar}>
                      <Text style={s.playerAvatarText}>
                        {(p.name ?? '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.playerName}>{p.name}</Text>
                      <Text style={s.playerMeta}>
                        {`Hcp ${p.handicap ?? 0}`}
                        {linkedToOther ? ' · Taken' : ''}
                        {linkedToMe ? ' · You' : ''}
                      </Text>
                    </View>
                    {isClaiming
                      ? <ActivityIndicator size="small" color={theme.accent.primary} />
                      : !linkedToOther && (
                        <Feather name="chevron-right" size={18} color={theme.text.muted} />
                      )}
                  </TouchableOpacity>
                );
              })}
              {allTaken && (
                <View style={s.noticeBox}>
                  <Feather name="info" size={15} color={theme.accent.primary} style={{ marginRight: 8, marginTop: 1 }} />
                  <Text style={s.noticeText}>
                    {rosterFull
                      ? `Every player is already linked to another account and this ${noun} is full. You can still follow along — tap Skip to continue as a viewer.`
                      : `Every existing player is already claimed. Add yourself as a new player below, or tap Skip to follow along as a viewer.`}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={s.section}>
            <Text style={s.sectionLabel}>Not listed? Add yourself</Text>
            {rosterFull ? (
              <Text style={s.fullNote}>
                This {noun} already has {MAX_PLAYERS} players — claim one above
                or skip.
              </Text>
            ) : adding ? (
              <View style={s.addForm}>
                <TextInput
                  style={s.input}
                  placeholder="Your name"
                  placeholderTextColor={theme.text.muted}
                  value={newName}
                  onChangeText={setNewName}
                  selectionColor={theme.accent.primary}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                />
                <TextInput
                  style={[s.input, s.inputHcp]}
                  placeholder="Hcp"
                  placeholderTextColor={theme.text.muted}
                  value={newHcp}
                  onChangeText={setNewHcp}
                  keyboardType="number-pad"
                  selectionColor={theme.accent.primary}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                />
                <TouchableOpacity
                  style={[s.addBtn, saving && { opacity: 0.5 }]}
                  onPress={addNewPlayer}
                  disabled={saving}
                  activeOpacity={0.8}
                >
                  {saving
                    ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                    : <Feather name="check" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={s.addRow}
                onPress={() => setAdding(true)}
                disabled={saving}
                activeOpacity={0.7}
              >
                <Feather name="user-plus" size={18} color={theme.accent.primary} />
                <Text style={s.addRowText}>I'm not listed — add me</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  skipText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.accent.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14,
    color: theme.text.muted, marginBottom: 24, lineHeight: 20,
  },
  section: { marginBottom: 24 },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 12,
    color: theme.text.muted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 10,
  },
  playerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 14,
    borderWidth: 1, borderColor: theme.border.default,
    padding: 14, marginBottom: 8,
  },
  playerRowDisabled: { opacity: 0.5 },
  playerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  playerAvatarText: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.inverse,
  },
  playerName: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.text.primary },
  playerMeta: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 12, color: theme.text.muted, marginTop: 2 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.bg.card, borderRadius: 14,
    borderWidth: 1, borderColor: theme.border.default,
    borderStyle: 'dashed', padding: 14,
  },
  addRowText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: theme.accent.primary },
  addForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: 'PlusJakartaSans-Medium',
  },
  inputHcp: { flex: 0, width: 64, textAlign: 'center' },
  addBtn: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  fullNote: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13,
    color: theme.text.muted, lineHeight: 19,
  },
  noticeBox: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 12,
    borderWidth: 1, borderColor: theme.accent.primary + '33',
    padding: 12, marginTop: 4,
  },
  noticeText: {
    flex: 1, fontFamily: 'PlusJakartaSans-Medium',
    color: theme.text.secondary, fontSize: 13, lineHeight: 19,
  },
});
