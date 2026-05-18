import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { signInAnonymously } from '../lib/oauth';
import AuthScreen from './AuthScreen';

// Shown (pre-session, web) when someone opens a /join-tournament/<code> link
// without being signed in. They choose: log in with an existing account, or
// continue anonymously. Either path establishes a Supabase session; once it
// exists, AppNavigator mounts the Stack and the linking config routes the
// same URL to the JoinTournament screen, which redeems the code.
export default function JoinTournamentLinkScreen() {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // When true, defer to the normal AuthScreen for email/social login.
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState(false);

  if (showLogin) return <AuthScreen />;

  async function continueAnon() {
    if (busy) return;
    setBusy(true);
    try {
      await signInAnonymously();
      // On success the AuthContext session updates and App re-renders into
      // the Stack; no navigation call is needed here.
    } catch (err) {
      setBusy(false);
      Alert.alert(
        'Could not continue',
        err?.message
          ? `${err.message}\n\nIf this keeps happening, ask the organiser to share the link again.`
          : 'Could not start a guest session. Please try again.',
      );
    }
  }

  return (
    <View style={s.screen}>
      <View style={s.content}>
        <View style={s.icon}>
          <Feather name="flag" size={32} color={theme.accent.primary} />
        </View>
        <Text style={s.title}>You're invited to a round</Text>
        <Text style={s.subtitle}>
          Join the tournament to enter scores. Log in if you already have a
          Golf Partner account, or jump straight in as a guest.
        </Text>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={continueAnon}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color={theme.text.inverse} />
            : <Text style={s.primaryBtnText}>Continue without an account</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => setShowLogin(true)}
          disabled={busy}
          activeOpacity={0.7}
        >
          <Text style={s.secondaryBtnText}>I have an account — log in</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg.primary },
  content: {
    flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center',
    width: '100%', maxWidth: 460, alignSelf: 'center',
  },
  icon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: theme.bg.card,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: {
    fontFamily: 'PlayfairDisplay-Bold', fontSize: 26, color: theme.text.primary,
    marginBottom: 8, textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.muted,
    textAlign: 'center', marginBottom: 32, maxWidth: 320, lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: theme.accent.primary, borderRadius: 14, padding: 16,
    alignItems: 'center', width: '100%', marginBottom: 12,
  },
  primaryBtnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 16,
  },
  secondaryBtn: { padding: 14, alignItems: 'center', width: '100%' },
  secondaryBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 15,
  },
});
