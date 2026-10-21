import React, { useState } from 'react';
import {
  Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { validateNewPassword, MIN_LENGTH } from '../lib/passwordReset';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import AuthShell from '../components/auth/AuthShell';
import makeFieldStyles from '../components/auth/fieldStyles';
import { useT, t as translate, tr } from '../i18n';

// Shown when AuthContext detects a password-recovery link (web query params
// or the native `golf://reset-password` deep link) — see AuthContext's
// `passwordRecovery` state and App.js, which renders this screen instead of
// the normal signed-in/signed-out screens while it's true. Same hole-plan
// frame as the login (AuthShell).
export default function SetNewPasswordScreen() {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const { clearPasswordRecovery } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(null);

  const { valid, error } = validateNewPassword(password, confirm);
  const fieldError = touched ? error : null;

  async function submit() {
    setTouched(true);
    if (!valid) return;
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        Alert.alert(translate('common.error'), updateError.message);
        return;
      }
      Alert.alert(translate('auth.passwordUpdated.title'), translate('auth.passwordUpdated.body'));
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

  const blur = () => {
    setFocused(null);
    setTouched(true);
  };
  const fieldProps = {
    placeholderTextColor: theme.text.secondary,
    secureTextEntry: true,
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'new-password',
    keyboardAppearance: theme.isDark ? 'dark' : 'light',
    selectionColor: theme.accent.primary,
    onBlur: blur,
  };

  return (
    <AuthShell>
      <Text style={s.heading} accessibilityRole="header">{t('auth.setNewPassword.tagline')}</Text>

      <Text style={s.label}>{t('auth.newPassword')}</Text>
      <TextInput
        {...fieldProps}
        style={[s.input, focused === 'password' && s.inputFocused, fieldError && s.inputError]}
        accessibilityLabel={t('auth.newPassword')}
        placeholder={t('auth.newPassword.placeholder', { min: MIN_LENGTH })}
        value={password}
        onChangeText={setPassword}
        onFocus={() => setFocused('password')}
      />

      <Text style={[s.label, s.labelGap]}>{t('auth.confirmPassword')}</Text>
      <TextInput
        {...fieldProps}
        style={[s.input, focused === 'confirm' && s.inputFocused, fieldError && s.inputError]}
        accessibilityLabel={t('auth.confirmPassword')}
        placeholder={t('auth.confirmPassword.placeholder')}
        value={confirm}
        onChangeText={setConfirm}
        onFocus={() => setFocused('confirm')}
        onSubmitEditing={submit}
      />
      {fieldError && <Text style={s.fieldError}>{tr(fieldError)}</Text>}

      <TouchableOpacity
        style={[s.btn, s.btnGap]}
        onPress={submit}
        disabled={loading}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading, busy: loading }}
      >
        {loading
          ? <ActivityIndicator color={theme.text.inverse} />
          : <Text style={s.btnText}>{t('auth.setNewPassword.button')}</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={s.cancelBtn}
        onPress={cancel}
        disabled={loading}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Text style={s.cancelText}>{t('auth.backToSignIn')}</Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const makeStyles = (theme) => ({
  ...makeFieldStyles(theme),
  ...StyleSheet.create({
    btnGap: { marginTop: 24 },
    cancelBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 12 },
    cancelText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.accent.primary },
  }),
});
