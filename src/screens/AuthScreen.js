import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import AuthForm from '../components/AuthForm';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

export default function AuthScreen() {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [mode, setMode] = useState('signin');

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

          <AuthForm mode={mode} onSignedUp={() => setMode('signin')} />
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
  inner: { paddingHorizontal: 24, width: '100%', maxWidth: 460, alignSelf: 'center' },
  logo: {
    fontFamily: 'PlayfairDisplay-Black',
    fontSize: 42, color: semantic.winner.dark,
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
});
