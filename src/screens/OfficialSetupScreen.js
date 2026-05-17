import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, Alert, Platform, Clipboard,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import {
  createOfficialTournament, addRosterPlayer, listRoster,
  regenerateToken, withdrawPlayer, createRound,
} from '../store/officialAdmin';

// Origin used when building share links. On web we read the live origin;
// off-web (or if window is unavailable) we fall back to a placeholder host.
function shareOrigin() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'https://golf.app';
}

function joinLink(token) {
  return `${shareOrigin()}/join/${token}`;
}

function showError(message) {
  const msg = message || 'Something went wrong';
  if (Platform.OS === 'web') window.alert(msg);
  else Alert.alert('Error', msg);
}

async function copyToClipboard(text) {
  // expo-clipboard is not a dependency; react-native's Clipboard is used.
  Clipboard.setString(text);
}

export default function OfficialSetupScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // Tournament creation
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [tournamentId, setTournamentId] = useState(null);

  // Local rules & notes — persisted into the tournament `data` blob.
  const [rules, setRules] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  // Holds whatever else lives in `data` so a rules save never clobbers it.
  const tournamentDataRef = useRef({});

  // Roster
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  // Roster id whose share link/QR is currently expanded.
  const [openLinkId, setOpenLinkId] = useState(null);

  // Add-player form
  const [newName, setNewName] = useState('');
  const [newHandicap, setNewHandicap] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);

  // Rounds
  const [roundCount, setRoundCount] = useState(0);
  const [addingRound, setAddingRound] = useState(false);

  const loadRoster = useCallback(async (id) => {
    setRosterLoading(true);
    setRosterError(false);
    try {
      const rows = await listRoster(id);
      setRoster(rows);
    } catch (e) {
      console.warn('OfficialSetupScreen: failed to load roster', e);
      setRosterError(true);
    } finally {
      setRosterLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tournamentId) loadRoster(tournamentId);
  }, [tournamentId, loadRoster]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const id = await createOfficialTournament({ name: trimmed });
      tournamentDataRef.current = {};
      setTournamentId(id);
    } catch (e) {
      showError(e?.message);
    } finally {
      setCreating(false);
    }
  }

  // Persist the rules text into tournaments.data, preserving other keys.
  async function handleRulesSave() {
    if (!tournamentId) return;
    setSavingRules(true);
    try {
      const nextData = { ...tournamentDataRef.current, rules };
      const { error } = await supabase
        .from('tournaments')
        .update({ data: nextData })
        .eq('id', tournamentId);
      if (error) throw error;
      tournamentDataRef.current = nextData;
    } catch (e) {
      showError(e?.message);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleAddPlayer() {
    const trimmed = newName.trim();
    if (!trimmed || !tournamentId || addingPlayer) return;
    setAddingPlayer(true);
    try {
      const row = await addRosterPlayer(tournamentId, {
        displayName: trimmed,
        handicap: parseInt(newHandicap, 10) || 0,
      });
      setRoster((prev) => [...prev, row]);
      setNewName('');
      setNewHandicap('');
    } catch (e) {
      showError(e?.message);
    } finally {
      setAddingPlayer(false);
    }
  }

  async function handleShowLink(row) {
    if (openLinkId === row.id) {
      setOpenLinkId(null);
      return;
    }
    setOpenLinkId(row.id);
    try {
      await copyToClipboard(joinLink(row.magic_token));
    } catch (e) {
      showError(e?.message);
    }
  }

  async function handleRegenerate(rosterId) {
    try {
      const token = await regenerateToken(rosterId);
      setRoster((prev) => prev.map((r) => (
        r.id === rosterId ? { ...r, magic_token: token } : r
      )));
    } catch (e) {
      showError(e?.message);
    }
  }

  async function handleWithdrawToggle(row) {
    const next = !row.withdrawn;
    try {
      await withdrawPlayer(row.id, next);
      setRoster((prev) => prev.map((r) => (
        r.id === row.id ? { ...r, withdrawn: next } : r
      )));
    } catch (e) {
      showError(e?.message);
    }
  }

  async function handleAddRound() {
    if (!tournamentId || addingRound) return;
    setAddingRound(true);
    try {
      const roundIndex = roundCount;
      const roundId = await createRound(tournamentId, {
        roundIndex, course: {}, format: 'stableford',
      });
      setRoundCount((c) => c + 1);
      navigation.navigate('PartyBoard', { tournamentId, roundId });
    } catch (e) {
      showError(e?.message);
    } finally {
      setAddingRound(false);
    }
  }

  const setupUnlocked = !!tournamentId;

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Official Tournament</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView style={s.container} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
        {/* Tournament name + create */}
        <Text style={s.sectionTitle}>Tournament</Text>
        <View style={s.card}>
          <TextInput
            style={s.input}
            placeholder="Tournament name"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={name}
            onChangeText={setName}
            editable={!setupUnlocked}
          />
          {setupUnlocked ? (
            <View style={s.createdRow}>
              <Feather name="check-circle" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
              <Text style={s.createdText}>Tournament created</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[s.primaryBtn, (!name.trim() || creating) && s.btnDisabled]}
              onPress={handleCreate}
              disabled={!name.trim() || creating}
            >
              {creating
                ? <ActivityIndicator size="small" color={theme.text.inverse} />
                : <Text style={s.primaryBtnText}>Create</Text>}
            </TouchableOpacity>
          )}
        </View>

        {setupUnlocked && (
          <>
            {/* Local rules & notes */}
            <Text style={s.sectionTitle}>Local Rules & Notes</Text>
            <View style={s.card}>
              <TextInput
                style={[s.input, s.notesInput]}
                placeholder="Local rules, notes, dress code..."
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                multiline
                value={rules}
                onChangeText={setRules}
                onBlur={handleRulesSave}
              />
              {savingRules && (
                <Text style={s.hint}>Saving…</Text>
              )}
            </View>

            {/* Roster */}
            <Text style={s.sectionTitle}>Roster</Text>
            {rosterLoading ? (
              <ActivityIndicator size="small" color={theme.accent.primary} style={{ marginVertical: 16 }} />
            ) : rosterError ? (
              <View style={s.card}>
                <Text style={s.errorText}>Could not load roster.</Text>
                <TouchableOpacity style={s.secondaryBtn} onPress={() => loadRoster(tournamentId)}>
                  <Text style={s.secondaryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {roster.length === 0 && (
                  <Text style={s.hint}>No players yet. Add the first below.</Text>
                )}
                {roster.map((row) => (
                  <View key={row.id} style={s.playerCard}>
                    <View style={s.playerRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.playerName, row.withdrawn && s.withdrawnText]}>
                          {row.display_name}
                        </Text>
                        <Text style={s.playerMeta}>
                          Handicap {row.handicap}{row.withdrawn ? '  •  Withdrawn' : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={s.actionRow}>
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleShowLink(row)}>
                        <Feather name="link" size={13} color={theme.accent.primary} style={{ marginRight: 4 }} />
                        <Text style={s.actionBtnText}>
                          {openLinkId === row.id ? 'Hide link' : 'Show link'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleRegenerate(row.id)}>
                        <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 4 }} />
                        <Text style={s.actionBtnText}>Regenerate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleWithdrawToggle(row)}>
                        <Feather
                          name={row.withdrawn ? 'rotate-ccw' : 'user-x'}
                          size={13}
                          color={row.withdrawn ? theme.accent.primary : theme.destructive}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={[s.actionBtnText, !row.withdrawn && s.actionBtnTextDanger]}>
                          {row.withdrawn ? 'Reinstate' : 'Withdraw'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {openLinkId === row.id && (
                      <View style={s.linkBlock}>
                        <View style={s.qrWrap}>
                          <QRCode
                            value={joinLink(row.magic_token)}
                            size={132}
                            backgroundColor="#ffffff"
                            color="#000000"
                          />
                        </View>
                        <Text style={s.linkText} selectable>{joinLink(row.magic_token)}</Text>
                        <Text style={s.hint}>Link copied to clipboard.</Text>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}

            {/* Add player */}
            <View style={s.card}>
              <Text style={s.cardLabel}>Add player</Text>
              <TextInput
                style={s.input}
                placeholder="Display name"
                placeholderTextColor={theme.text.muted}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                value={newName}
                onChangeText={setNewName}
              />
              <TextInput
                style={s.input}
                placeholder="Handicap"
                placeholderTextColor={theme.text.muted}
                keyboardType="numeric"
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                selectionColor={theme.accent.primary}
                value={newHandicap}
                onChangeText={setNewHandicap}
              />
              <TouchableOpacity
                style={[s.primaryBtn, (!newName.trim() || addingPlayer) && s.btnDisabled]}
                onPress={handleAddPlayer}
                disabled={!newName.trim() || addingPlayer}
              >
                {addingPlayer
                  ? <ActivityIndicator size="small" color={theme.text.inverse} />
                  : <Text style={s.primaryBtnText}>Add player</Text>}
              </TouchableOpacity>
            </View>

            {/* Rounds */}
            <Text style={s.sectionTitle}>Rounds</Text>
            <Text style={s.hint}>
              {roundCount === 0
                ? 'No rounds added yet.'
                : `${roundCount} round${roundCount !== 1 ? 's' : ''} added.`}
            </Text>
            <TouchableOpacity
              style={[s.addRoundBtn, addingRound && s.btnDisabled]}
              onPress={handleAddRound}
              disabled={addingRound}
            >
              {addingRound ? (
                <ActivityIndicator size="small" color={theme.accent.primary} />
              ) : (
                <>
                  <Feather name="plus-circle" size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
                  <Text style={s.addRoundBtnText}>Add Round</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginBottom: 8 },
  errorText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.destructive, fontSize: 13, marginBottom: 10 },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  cardLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 14, marginBottom: 10,
  },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14, marginBottom: 8, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  primaryBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 12,
    padding: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    padding: 10, alignItems: 'center',
  },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
  createdRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  createdText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  playerCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  playerRow: { flexDirection: 'row', alignItems: 'center' },
  playerName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 16 },
  withdrawnText: { textDecorationLine: 'line-through', color: theme.text.muted },
  playerMeta: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 6, paddingHorizontal: 10,
  },
  actionBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  actionBtnTextDanger: { color: theme.destructive },
  linkBlock: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: theme.border.subtle,
    alignItems: 'center',
  },
  qrWrap: {
    backgroundColor: '#ffffff', padding: 10, borderRadius: 12, marginBottom: 10,
  },
  linkText: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
    fontSize: 12, textAlign: 'center', marginBottom: 4,
  },
  addRoundBtn: {
    borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 4,
    flexDirection: 'row', justifyContent: 'center',
  },
  addRoundBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
