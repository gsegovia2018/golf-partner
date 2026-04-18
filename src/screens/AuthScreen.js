import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../theme/ThemeContext';

export default function AuthScreen() {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      let error;
      if (mode === 'signin') {
        ({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
      } else {
        ({ error } = await supabase.auth.signUp({ email: email.trim(), password }));
        if (!error) {
          Alert.alert('Check your email', 'Confirm your account then sign in.');
          setMode('signin');
          return;
        }
      }
      if (error) Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>
        <Text style={s.logo}>Golf Partner</Text>
        <Text style={s.tagline}>Track your round</Text>

        <View style={s.card}>
          <View style={s.modeRow}>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'signin' && s.modeBtnActive]}
              onPress={() => setMode('signin')}
              activeOpacity={0.7}
            >
              <Text style={[s.modeBtnText, mode === 'signin' && s.modeBtnTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'signup' && s.modeBtnActive]}
              onPress={() => setMode('signup')}
              activeOpacity={0.7}
            >
              <Text style={[s.modeBtnText, mode === 'signup' && s.modeBtnTextActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor={theme.text.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={s.input}
            placeholder="Password"
            placeholderTextColor={theme.text.muted}
            secureTextEntry
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
          />

          <TouchableOpacity
            style={[s.btn, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              : <Text style={s.btnText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#006747',
    justifyContent: 'center',
  },
  inner: { paddingHorizontal: 24 },
  logo: {
    fontFamily: 'PlayfairDisplay-Black',
    fontSize: 42, color: '#ffd700',
    letterSpacing: -1, textAlign: 'center', marginBottom: 4,
  },
  tagline: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 14, color: 'rgba(255,255,255,0.6)',
    textAlign: 'center', marginBottom: 36,
  },
  card: {
    backgroundColor: theme.bg.card,
    borderRadius: 24, padding: 20,
    borderWidth: 1, borderColor: theme.border.default,
  },
  modeRow: { flexDirection: 'row', marginBottom: 20, gap: 8 },
  modeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
    alignItems: 'center',
    backgroundColor: theme.bg.secondary,
  },
  modeBtnActive: {
    backgroundColor: theme.accent.primary,
    borderColor: theme.accent.primary,
  },
  modeBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 14, color: theme.text.muted,
  },
  modeBtnTextActive: { color: theme.text.inverse },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium', marginBottom: 12,
  },
  btn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  btnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 16,
  },
});
