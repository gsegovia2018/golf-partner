import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { joinTournamentByCode, setActiveTournament } from '../store/tournamentStore';

export default function JoinTournamentScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // Allow deep-links / share URLs to pre-fill the code (e.g. `?invite=ABC123`
  // is picked up by AppNavigator and forwarded as route.params.code).
  const initialCode = (route?.params?.code ?? '').toString().toUpperCase().slice(0, 6);
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (code.trim().length < 6) return;
    setLoading(true);
    try {
      const { tournamentId, role } = await joinTournamentByCode(code.trim());
      await setActiveTournament(tournamentId);
      // Editors get to say which player they are (or add themselves) before
      // landing in the tournament. Viewers are read-only — straight in.
      if (role === 'editor') {
        navigation.replace('ClaimPlayer', { tournamentId });
      } else {
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not join tournament');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Join Tournament</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={s.content}>
        <View style={s.icon}>
          <Feather name="link" size={32} color={theme.accent.primary} />
        </View>
        <Text style={s.title}>Enter Invite Code</Text>
        <Text style={s.subtitle}>Ask the tournament owner for their 6-character invite code.</Text>

        <TextInput
          style={s.codeInput}
          placeholder="ABC123"
          placeholderTextColor={theme.text.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
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
                <Feather name="log-in" size={18} color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
                <Text style={s.btnText}>Join</Text>
              </>
            )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  content: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
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
  },
});
