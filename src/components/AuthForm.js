import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import useAuthSignIn from '../hooks/useAuthSignIn';
import { useT, tr } from '../i18n';

// Email + password fields, "Forgot password?", the submit button and
// "Continue with Google". Used by AuthScreen (sign in / sign up) and by the
// league invite screen's "I have an account" tab (sign in only). Every
// surface is opaque: the form sits on bg.primary (login sheet) or a card, and
// dark mode's translucent tints went see-through over the brand green.
export default function AuthForm({ mode = 'signin', onSignedUp }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const [focused, setFocused] = useState(null);
  const {
    email, setEmail, password, setPassword,
    loading, oauthLoading, showPassword, setShowPassword,
    setTouched, formValid, emailError, passwordError,
    submit, handleForgotPassword, signInWithProvider,
  } = useAuthSignIn({ mode, onSignedUp });

  const blur = (field) => () => {
    setFocused(null);
    setTouched((prev) => ({ ...prev, [field]: true }));
  };
  // A busy button keeps its enabled colours so the spinner stays visible.
  const enabled = formValid;

  return (
    <>
      <Text style={s.label} nativeID="auth-email-label">{t('auth.emailLabel')}</Text>
      <TextInput
        style={[s.input, focused === 'email' && s.inputFocused, emailError && s.inputError]}
        accessibilityLabel={t('auth.emailLabel')}
        accessibilityLabelledBy="auth-email-label"
        placeholder={t('auth.emailPlaceholder')}
        placeholderTextColor={theme.text.secondary}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        value={email}
        onChangeText={setEmail}
        onFocus={() => setFocused('email')}
        onBlur={blur('email')}
      />
      {emailError && <Text style={s.fieldError}>{tr(emailError)}</Text>}

      <Text style={[s.label, s.labelGap]} nativeID="auth-password-label">{t('auth.passwordLabel')}</Text>
      <View style={[s.input, s.passwordRow, focused === 'password' && s.inputFocused, passwordError && s.inputError]}>
        <TextInput
          style={s.passwordInput}
          accessibilityLabel={t('auth.passwordLabel')}
          accessibilityLabelledBy="auth-password-label"
          placeholder={t('auth.passwordPlaceholder')}
          placeholderTextColor={theme.text.secondary}
          secureTextEntry={!showPassword}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocused('password')}
          onBlur={blur('password')}
          onSubmitEditing={submit}
        />
        <TouchableOpacity
          style={s.eyeBtn}
          onPress={() => setShowPassword((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
        >
          <Feather name={showPassword ? 'eye-off' : 'eye'} size={19} color={theme.text.secondary} />
        </TouchableOpacity>
      </View>
      {passwordError && <Text style={s.fieldError}>{tr(passwordError)}</Text>}

      <View style={s.forgotRow}>
        {mode === 'signin' && (
          <TouchableOpacity
            onPress={handleForgotPassword}
            activeOpacity={0.7}
            disabled={loading}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.forgotText}>{t('auth.forgotPassword')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[s.btn, !enabled && s.btnDisabled]}
        onPress={submit}
        disabled={!enabled || loading}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled || loading, busy: loading }}
      >
        {loading
          ? <ActivityIndicator color={theme.text.inverse} />
          : (
            <Text style={[s.btnText, !enabled && s.btnTextDisabled]}>
              {mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
            </Text>
          )}
      </TouchableOpacity>

      <View style={s.divider}>
        <View style={s.dividerLine} />
        <Text style={s.dividerText}>{t('auth.or')}</Text>
        <View style={s.dividerLine} />
      </View>

      <TouchableOpacity
        style={[s.googleBtn, oauthLoading && { opacity: 0.6 }]}
        onPress={() => signInWithProvider('google')}
        disabled={!!oauthLoading}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {oauthLoading === 'google'
          ? <ActivityIndicator color="#1f1f1f" />
          : (
            <>
              <Text style={s.googleG}>G</Text>
              <Text style={s.googleBtnText}>{t('auth.continueGoogle')}</Text>
            </>
          )}
      </TouchableOpacity>
    </>
  );
}

const makeStyles = (theme) => {
  // Opaque field fill and a border with real contrast on both surfaces; the
  // disabled button keeps readable text instead of fading to 50%.
  const fieldBg = theme.isDark ? '#13221b' : '#ffffff';
  const fieldBorder = theme.isDark ? 'rgba(255,255,255,0.16)' : '#d9d3c4';
  return StyleSheet.create({
    label: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13,
      color: theme.text.primary, marginBottom: 6,
    },
    labelGap: { marginTop: 14 },
    input: {
      height: 50, backgroundColor: fieldBg,
      color: theme.text.primary, borderRadius: 12, borderWidth: 1,
      borderColor: fieldBorder, paddingHorizontal: 14, fontSize: 16,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    inputFocused: { borderColor: theme.accent.primary },
    inputError: { borderColor: theme.destructive },
    fieldError: {
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 12, color: theme.destructive,
      marginTop: 6, marginLeft: 2,
    },
    passwordRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0, paddingLeft: 14 },
    passwordInput: {
      flex: 1, alignSelf: 'stretch', color: theme.text.primary, fontSize: 16,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    eyeBtn: { width: 46, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    forgotRow: { minHeight: 40, alignItems: 'flex-end', justifyContent: 'center' },
    forgotText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontSize: 13, color: theme.accent.primary,
    },
    btn: {
      height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary,
    },
    btnDisabled: { backgroundColor: theme.isDark ? '#1b3328' : '#dfe8e3' },
    btnText: {
      fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.inverse,
    },
    btnTextDisabled: { color: theme.isDark ? '#a9b8b0' : '#3f5a4c' },
    divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 12 },
    dividerLine: { flex: 1, height: 1, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.12)' : '#e2dccd' },
    dividerText: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.secondary,
    },
    googleBtn: {
      height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: '#ffffff', borderRadius: 12,
      borderWidth: theme.isDark ? 0 : 1, borderColor: fieldBorder,
    },
    googleG: {
      fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: '#4285F4',
      width: 20, textAlign: 'center',
    },
    googleBtnText: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: '#1f1f1f',
    },
  });
};
