import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { redeemToken, saveToken } from '../store/officialToken';

// A pasted invite can be a bare token or a full `/join/<token>` URL.
// Extract the token segment so either form works in the re-enter field.
function extractToken(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/join\/([^/?#\s]+)/);
  if (match) return match[1];
  return trimmed;
}

export default function JoinOfficialScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // Guards async handlers from calling setState after the screen unmounts.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const initialToken = route.params?.token || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // The token that was successfully redeemed (passed through to Scorecard).
  const [activeToken, setActiveToken] = useState(null);
  const [player, setPlayer] = useState(null); // redeemToken result
  const [tournamentName, setTournamentName] = useState('');
  const [rules, setRules] = useState('');
  const [rounds, setRounds] = useState([]);

  // Re-enter affordance (shown on failure).
  const [reentry, setReentry] = useState('');

  const attempt = useCallback(async (token) => {
    if (!token) {
      if (mountedRef.current) { setLoading(false); setError(true); }
      return;
    }
    if (mountedRef.current) { setLoading(true); setError(false); }
    try {
      const result = await redeemToken(token);
      if (!mountedRef.current) return;
      await saveToken(token);

      // Tournament name + local rules — best-effort; a failure here should not
      // block the confirmation, which is the important part of the redeem flow.
      let name = '';
      let rulesText = '';
      try {
        const { data: tRow } = await supabase
          .from('tournaments')
          .select('name, data')
          .eq('id', result.tournament_id)
          .single();
        name = tRow?.name || '';
        rulesText = typeof tRow?.data?.rules === 'string' ? tRow.data.rules : '';
      } catch (e) {
        console.warn('JoinOfficialScreen: failed to load tournament name', e);
      }

      // The player's rounds. Listing all tournament rounds is acceptable in
      // Core — per-round party membership is enforced server-side.
      let roundRows = [];
      try {
        const { data: rRows } = await supabase
          .from('tournament_rounds')
          .select('id, round_index, format, status')
          .eq('tournament_id', result.tournament_id)
          .order('round_index');
        roundRows = rRows || [];
      } catch (e) {
        console.warn('JoinOfficialScreen: failed to load rounds', e);
      }

      if (!mountedRef.current) return;
      setActiveToken(token);
      setPlayer(result);
      setTournamentName(name);
      setRules(rulesText);
      setRounds(roundRows);
      setError(false);
    } catch (e) {
      if (!mountedRef.current) return;
      console.warn('JoinOfficialScreen: redeem failed', e);
      setError(true);
      setPlayer(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    attempt(initialToken);
  }, [initialToken, attempt]);

  function handleReentry() {
    const token = extractToken(reentry);
    setReentry('');
    attempt(token);
  }

  // ----- Loading -----
  if (loading) {
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
          <Text style={s.loadingText}>Checking your invite…</Text>
        </View>
      </ScreenContainer>
    );
  }

  // ----- Error / re-enter -----
  if (error || !player) {
    return (
      <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <IconButton icon="chevron-left" size={22} color={theme.accent.primary} onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>Join Tournament</Text>
          <View style={{ width: 64 }} />
        </View>
        <ScrollView style={s.container} contentContainerStyle={s.content}>
          <View style={s.card}>
            <Feather name="alert-circle" size={28} color={theme.destructive} style={{ marginBottom: 10 }} />
            <Text style={s.errorTitle}>This invite link is not valid.</Text>
            <Text style={s.hint}>
              Paste your invite link or token below and try again.
            </Text>
            <TextInput
              style={s.input}
              placeholder="Paste invite link or token"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              autoCapitalize="none"
              autoCorrect={false}
              value={reentry}
              onChangeText={setReentry}
            />
            <TouchableOpacity
              style={[s.primaryBtn, !reentry.trim() && s.btnDisabled]}
              onPress={handleReentry}
              disabled={!reentry.trim()}
            >
              <Text style={s.primaryBtnText}>Re-enter link</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ----- Success -----
  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={22} color={theme.accent.primary} onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Join Tournament</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <View style={s.card}>
          <Feather name="check-circle" size={28} color={theme.accent.primary} style={{ marginBottom: 10 }} />
          <Text style={s.confirmTitle}>You're in as {player.display_name}</Text>
          {!!tournamentName && (
            <Text style={s.confirmSub}>{tournamentName}</Text>
          )}
          {player.withdrawn && (
            <View style={s.withdrawnNote}>
              <Feather name="user-x" size={13} color={theme.destructive} style={{ marginRight: 6 }} />
              <Text style={s.withdrawnText}>
                You have been withdrawn from this tournament by the admin.
              </Text>
            </View>
          )}
        </View>

        {!!rules.trim() && (
          <>
            <Text style={s.sectionTitle}>Local rules & notes</Text>
            <View style={s.card}>
              <Text style={s.rulesText}>{rules}</Text>
            </View>
          </>
        )}

        <Text style={s.sectionTitle}>Rounds</Text>
        {rounds.length === 0 ? (
          <Text style={s.hint}>No rounds have been added yet.</Text>
        ) : (
          rounds.map((round) => {
            const notStarted = round.status === 'setup';
            return (
              <View key={round.id} style={s.roundCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.roundTitle}>
                    Round {round.round_index + 1}
                  </Text>
                  <Text style={s.roundMeta}>
                    {(round.format || 'stableford')}
                    {'  •  '}
                    {round.status || 'unknown'}
                  </Text>
                  {notStarted && (
                    <Text style={s.roundHint}>Not started yet.</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[s.scoreBtn, notStarted && s.btnDisabled]}
                  onPress={() => navigation.navigate('Scorecard', {
                    official: true,
                    token: activeToken,
                    roundId: round.id,
                  })}
                  disabled={notStarted}
                >
                  <Text style={s.scoreBtnText}>Score this round</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
    fontSize: 14, marginTop: 14,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: theme.bg.primary,
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  hint: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12, marginBottom: 8 },
  card: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  confirmTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18,
  },
  confirmSub: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
    fontSize: 14, marginTop: 4,
  },
  errorTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 16, marginBottom: 6,
  },
  rulesText: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
    fontSize: 14, lineHeight: 21,
  },
  withdrawnNote: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: theme.border.subtle,
  },
  withdrawnText: {
    flex: 1, fontFamily: 'PlusJakartaSans-Medium',
    color: theme.destructive, fontSize: 12,
  },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    padding: 14, marginBottom: 8, marginTop: 8, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  primaryBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 12,
    padding: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  roundCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 14, marginBottom: 8,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  roundTitle: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 16 },
  roundMeta: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 12, marginTop: 2, textTransform: 'capitalize',
  },
  roundHint: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted,
    fontSize: 11, marginTop: 4, fontStyle: 'italic',
  },
  scoreBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 12, marginLeft: 12,
  },
  scoreBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 12 },
});
