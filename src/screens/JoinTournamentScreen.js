import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import IconButton from '../components/ui/IconButton';
import { useTheme } from '../theme/ThemeContext';
import {
  joinTournamentByCode, setActiveTournament, getTournament, findClaimedSlot,
} from '../store/tournamentStore';
import { leagueCodeExists } from '../store/leagueStore';
import { authUserId } from '../lib/authUser';
import { useT } from '../i18n';

export default function JoinTournamentScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);

  // Deep-link / share URLs deliver the code via route.params.code; manual
  // entry still works when the screen is opened from the Home "Join" tile.
  const initialCode = (route?.params?.code ?? '').toString().toUpperCase().slice(0, 8);
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  // True while the deep-link path is auto-redeeming, so we show a spinner
  // instead of the manual code field.
  const [autoJoining, setAutoJoining] = useState(initialCode.length >= 6);
  const didAutoJoin = useRef(false);

  async function handleJoin() {
    if (code.trim().length < 6) return;
    setLoading(true);
    try {
      const { tournamentId, role } = await joinTournamentByCode(code.trim());
      await setActiveTournament(tournamentId);
      if (role !== 'editor') {
        // Viewers are read-only — straight in.
        navigation.goBack();
        return;
      }
      // Editor: if a slot is already bound to this account (a friend the
      // creator added from their friends list), skip the picker.
      const [tournament, userId] = await Promise.all([
        getTournament(tournamentId), authUserId(),
      ]);
      const mine = findClaimedSlot(tournament?.players ?? [], userId);
      if (mine) {
        navigation.replace('Tournament', { tournamentId });
      } else {
        navigation.replace('ClaimPlayer', { tournamentId });
      }
    } catch (err) {
      // Not a tournament code (the server said "Invalid code", not revoked or
      // expired): "Join with code" also takes a league's invite code. A real
      // tournament code never reaches this, so the two can't be confused.
      if (/^invalid code/i.test(err?.message ?? '') && await leagueCodeExists(code)) {
        navigation.replace('JoinLeague', { code: code.trim().toUpperCase() });
        return;
      }
      setAutoJoining(false);
      Alert.alert(t('home.join.errorTitle'), err.message ?? t('home.join.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  // Auto-redeem when arriving via a deep link (code already present).
  useEffect(() => {
    if (didAutoJoin.current) return;
    if (initialCode.length >= 6) {
      didAutoJoin.current = true;
      handleJoin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <IconButton icon="chevron-left" onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{t('home.join.header')}</Text>
        <View style={{ width: 22 }} />
      </View>

      {autoJoining ? (
        <View style={s.content}>
          <ActivityIndicator size="large" color={theme.accent.primary} />
          <Text style={[s.subtitle, { marginTop: 16 }]}>{t('home.join.joining')}</Text>
        </View>
      ) : (
        <View style={s.content}>
          <View style={s.icon}>
            <Feather name="link" size={32} color={theme.accent.primary} />
          </View>
          <Text style={s.title}>{t('home.join.title')}</Text>
          <Text style={s.subtitle}>{t('home.join.subtitle')}</Text>

          <TextInput
            style={s.codeInput}
            placeholder="ABC123"
            placeholderTextColor={theme.text.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            onSubmitEditing={handleJoin}
          />

          <TouchableOpacity
            style={[s.btn, (loading || code.length < 6) && { opacity: 0.5 }]}
            onPress={handleJoin}
            disabled={loading || code.length < 6}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              : (
                <>
                  <Feather name="log-in" size={14} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                  <Text style={s.btnText}>{t('home.join.button')}</Text>
                </>
              )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    width: '100%', maxWidth: 460, alignSelf: 'center',
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  content: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 460, alignSelf: 'center' },
  icon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: theme.isDark ? theme.bg.card : theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 26,
    color: theme.text.primary, marginBottom: 8, textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14,
    color: theme.text.muted, textAlign: 'center', marginBottom: 32,
    maxWidth: 280,
  },
  codeInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 16, borderWidth: 1,
    borderColor: theme.border.default, padding: 18,
    fontSize: 28, fontFamily: 'PlusJakartaSans-ExtraBold',
    textAlign: 'center', letterSpacing: 8, width: '100%', marginBottom: 16,
  },
  btn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 16, alignItems: 'center', width: '100%',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  btnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 16,
    textAlign: 'center',
  },
});
