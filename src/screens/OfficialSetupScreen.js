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
  addRosterPlayer, listRoster,
  regenerateToken, withdrawPlayer, createRound, saveTournamentData,
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

function copyToClipboard(text) {
  // expo-clipboard is not a dependency; react-native's Clipboard is used.
  Clipboard.setString(text);
}

export default function OfficialSetupScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // The tournament being managed — supplied by the setup wizard.
  const tournamentId = route?.params?.tournamentId ?? null;

  // Guards async handlers from calling setState after the screen unmounts.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Initial load (tournament + roster + rounds).
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Tournament identity (read-only).
  const [name, setName] = useState('');

  // Local rules & notes — persisted into the tournament `data` blob.
  const [rules, setRules] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  // Holds whatever else lives in `data` so a rules save never clobbers it.
  const tournamentDataRef = useRef({});

  // Roster
  const [roster, setRoster] = useState([]);
  // Roster id whose share link/QR is currently expanded.
  const [openLinkId, setOpenLinkId] = useState(null);
  // Roster id with a per-row action in flight; blocks double-submit.
  const [pendingRowId, setPendingRowId] = useState(null);

  // Add-player form
  const [newName, setNewName] = useState('');
  const [newHandicap, setNewHandicap] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);

  // Rounds — loaded from tournament_rounds.
  const [rounds, setRounds] = useState([]);
  const [addingRound, setAddingRound] = useState(false);

  // Load tournament, roster and rounds for the route's tournamentId.
  const load = useCallback(async () => {
    if (!tournamentId) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const [tournamentRes, rosterRows, roundsRes] = await Promise.all([
        supabase
          .from('tournaments')
          .select('name, data')
          .eq('id', tournamentId)
          .single(),
        listRoster(tournamentId),
        supabase
          .from('tournament_rounds')
          .select('id, round_index, format, status')
          .eq('tournament_id', tournamentId)
          .order('round_index'),
      ]);
      if (tournamentRes.error) throw tournamentRes.error;
      if (roundsRes.error) throw roundsRes.error;
      if (!mountedRef.current) return;

      const data = tournamentRes.data?.data ?? {};
      tournamentDataRef.current = data;
      setName(tournamentRes.data?.name ?? '');
      setRules(typeof data.rules === 'string' ? data.rules : '');
      setRoster(rosterRows ?? []);
      setRounds(roundsRes.data ?? []);
    } catch (e) {
      if (!mountedRef.current) return;
      console.warn('OfficialSetupScreen: failed to load tournament', e);
      setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  // Persist the rules text into tournaments.data, preserving other keys.
  async function handleRulesSave() {
    if (!tournamentId || savingRules) return;
    setSavingRules(true);
    try {
      const existing = tournamentDataRef.current ?? {};
      const nextData = { ...existing, rules };
      await saveTournamentData(tournamentId, existing, { rules });
      if (!mountedRef.current) return;
      tournamentDataRef.current = nextData;
    } catch (e) {
      if (!mountedRef.current) return;
      showError(e?.message);
    } finally {
      if (mountedRef.current) setSavingRules(false);
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
      if (!mountedRef.current) return;
      setRoster((prev) => [...prev, row]);
      setNewName('');
      setNewHandicap('');
    } catch (e) {
      if (!mountedRef.current) return;
      showError(e?.message);
    } finally {
      if (mountedRef.current) setAddingPlayer(false);
    }
  }

  function handleShowLink(row) {
    if (openLinkId === row.id) {
      setOpenLinkId(null);
      return;
    }
    setOpenLinkId(row.id);
    copyToClipboard(joinLink(row.magic_token));
  }

  async function handleRegenerate(rosterId) {
    if (pendingRowId) return;
    setPendingRowId(rosterId);
    try {
      const token = await regenerateToken(rosterId);
      if (!mountedRef.current) return;
      setRoster((prev) => prev.map((r) => (
        r.id === rosterId ? { ...r, magic_token: token } : r
      )));
    } catch (e) {
      if (!mountedRef.current) return;
      showError(e?.message);
    } finally {
      if (mountedRef.current) setPendingRowId(null);
    }
  }

  async function handleWithdrawToggle(row) {
    if (pendingRowId) return;
    const next = !row.withdrawn;
    setPendingRowId(row.id);
    try {
      await withdrawPlayer(row.id, next);
      if (!mountedRef.current) return;
      setRoster((prev) => prev.map((r) => (
        r.id === row.id ? { ...r, withdrawn: next } : r
      )));
    } catch (e) {
      if (!mountedRef.current) return;
      showError(e?.message);
    } finally {
      if (mountedRef.current) setPendingRowId(null);
    }
  }

  async function handleAddRound() {
    if (!tournamentId || addingRound) return;
    setAddingRound(true);
    try {
      // Next index follows the highest existing round_index.
      const roundIndex = rounds.reduce(
        (max, r) => Math.max(max, (r.round_index ?? -1) + 1), rounds.length,
      );
      const roundId = await createRound(tournamentId, {
        roundIndex, course: {}, format: 'stableford',
      });
      if (!mountedRef.current) return;
      setRounds((prev) => [
        ...prev,
        { id: roundId, round_index: roundIndex, format: 'stableford', status: 'setup' },
      ]);
      navigation.navigate('PartyBoard', { tournamentId, roundId });
    } catch (e) {
      if (!mountedRef.current) return;
      showError(e?.message);
    } finally {
      if (mountedRef.current) setAddingRound(false);
    }
  }

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Official Tournament</Text>
        <View style={{ width: 64 }} />
      </View>

      {loading ? (
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
        </View>
      ) : loadError ? (
        <View style={s.centerState}>
          <Text style={s.errorText}>
            {tournamentId
              ? 'Could not load this tournament.'
              : 'No tournament selected.'}
          </Text>
          {!!tournamentId && (
            <TouchableOpacity style={s.secondaryBtn} onPress={load}>
              <Text style={s.secondaryBtnText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView style={s.container} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
          {/* Tournament name (read-only) */}
          <Text style={s.sectionTitle}>Tournament</Text>
          <View style={s.card}>
            <Text style={s.tournamentName}>{name || 'Untitled tournament'}</Text>
          </View>

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
                <TouchableOpacity
                  style={[s.actionBtn, pendingRowId === row.id && s.btnDisabled]}
                  onPress={() => handleRegenerate(row.id)}
                  disabled={pendingRowId === row.id}
                >
                  <Feather name="refresh-cw" size={13} color={theme.accent.primary} style={{ marginRight: 4 }} />
                  <Text style={s.actionBtnText}>Regenerate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, pendingRowId === row.id && s.btnDisabled]}
                  onPress={() => handleWithdrawToggle(row)}
                  disabled={pendingRowId === row.id}
                >
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
          {rounds.length === 0 && (
            <Text style={s.hint}>No rounds added yet.</Text>
          )}
          {rounds.map((round) => (
            <TouchableOpacity
              key={round.id}
              style={s.roundCard}
              onPress={() => navigation.navigate('PartyBoard', { tournamentId, roundId: round.id })}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.roundName}>Round {(round.round_index ?? 0) + 1}</Text>
                <Text style={s.roundMeta}>
                  {(round.format ?? 'stableford')}  •  {(round.status ?? 'setup')}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.accent.primary} />
            </TouchableOpacity>
          ))}
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
        </ScrollView>
      )}
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
  centerState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginBottom: 8 },
  errorText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.destructive, fontSize: 13, marginBottom: 10, textAlign: 'center' },
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
  tournamentName: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18,
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
    paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center',
  },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
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
  roundCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  roundName: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 15 },
  roundMeta: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 12, marginTop: 2, textTransform: 'capitalize',
  },
  addRoundBtn: {
    borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, borderStyle: 'dashed',
    padding: 14, alignItems: 'center', marginTop: 4,
    flexDirection: 'row', justifyContent: 'center',
  },
  addRoundBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
