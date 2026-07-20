import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { validateNewPassword } from '../lib/passwordReset';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';

// Shown when AuthContext detects a password-recovery link (web query params
// or the native `golf://reset-password` deep link) — see AuthContext's
// `passwordRecovery` state and App.js, which renders this screen instead of
// the normal signed-in/signed-out screens while it's true.
export default function SetNewPasswordScreen() {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { clearPasswordRecovery } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const { valid, error } = validateNewPassword(password, confirm);
  const fieldError = touched ? error : null;

  async function submit() {
    setTouched(true);
    if (!valid) return;
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        Alert.alert('Error', updateError.message);
        return;
      }
      Alert.alert('Password updated', 'You can now use your new password to sign in.');
      clearPasswordRecovery();
    } finally {
      setLoading(false);
    }
  }

  // Escape hatch: without this the user is stuck on this screen until an
  // updateUser succeeds. Sign out any recovery session (they arrived via a
  // reset link, not a normal login) and clear the recovery flag so App.js
  // returns to the sign-in screen.
  async function cancel() {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore — clearing the recovery flag below still frees the user.
    } finally {
      setLoading(false);
      clearPasswordRecovery();
    }
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>
        <Text style={s.logo}>Golf Partner</Text>
        <Text style={s.tagline}>Set a new password</Text>

        <View style={s.card}>
          <TextInput
            style={[s.input, fieldError && s.inputError]}
            placeholder="New password"
            placeholderTextColor={theme.text.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={password}
            onChangeText={setPassword}
            onBlur={() => setTouched(true)}
          />

          <TextInput
            style={[s.input, fieldError && s.inputError]}
            placeholder="Confirm new password"
            placeholderTextColor={theme.text.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={confirm}
            onChangeText={setConfirm}
            onBlur={() => setTouched(true)}
            onSubmitEditing={submit}
          />
          {fieldError && <Text style={s.fieldError}>{fieldError}</Text>}

          <TouchableOpacity
            style={[s.btn, loading && { opacity: 0.5 }]}
            onPress={submit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              : <Text style={s.btnText}>Set new password</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={s.cancelBtn}
            onPress={cancel}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={s.cancelText}>Back to sign in</Text>
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
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium', marginBottom: 12,
  },
  inputError: { borderColor: theme.destructive },
  fieldError: {
    fontFamily: 'PlusJakartaSans-Medium',
    fontSize: 12, color: theme.destructive,
    marginTop: -6, marginBottom: 10, marginLeft: 2,
  },
  btn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  btnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 16,
  },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 13, color: theme.text.muted,
  },
});
