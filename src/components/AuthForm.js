import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import useAuthSignIn from '../hooks/useAuthSignIn';

// Email + password fields, "Forgot password?", the submit button and
// "Continue with Google". Used by AuthScreen (sign in / sign up) and by the
// league invite screen's "I have an account" tab (sign in only).
export default function AuthForm({ mode = 'signin', onSignedUp }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const {
    email, setEmail, password, setPassword,
    loading, oauthLoading, showPassword, setShowPassword,
    setTouched, formValid, emailError, passwordError,
    submit, handleForgotPassword, signInWithProvider,
  } = useAuthSignIn({ mode, onSignedUp });

  return (
    <>
      <TextInput
        style={[s.input, emailError && s.inputError]}
        placeholder="Email"
        placeholderTextColor={theme.text.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        value={email}
        onChangeText={setEmail}
        onBlur={() => setTouched((t) => ({ ...t, email: true }))}
      />
      {emailError && <Text style={s.fieldError}>{emailError}</Text>}

      <View style={[s.passwordRow, passwordError && s.inputError]}>
        <TextInput
          style={s.passwordInput}
          placeholder="Password"
          placeholderTextColor={theme.text.muted}
          secureTextEntry={!showPassword}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          onSubmitEditing={submit}
        />
        <TouchableOpacity
          style={s.eyeBtn}
          onPress={() => setShowPassword((v) => !v)}
          activeOpacity={0.7}
          accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather
            name={showPassword ? 'eye-off' : 'eye'}
            size={18}
            color={theme.text.muted}
          />
        </TouchableOpacity>
      </View>
      {passwordError && <Text style={s.fieldError}>{passwordError}</Text>}

      {mode === 'signin' && (
        <TouchableOpacity
          style={s.forgotBtn}
          onPress={handleForgotPassword}
          activeOpacity={0.7}
          disabled={loading}
        >
          <Text style={s.forgotText}>Forgot password?</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.btn, (loading || !formValid) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={loading || !formValid}
        activeOpacity={0.8}
      >
        {loading
          ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
          : <Text style={s.btnText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>}
      </TouchableOpacity>

      <View style={s.divider}>
        <View style={s.dividerLine} />
        <Text style={s.dividerText}>OR</Text>
        <View style={s.dividerLine} />
      </View>

      <TouchableOpacity
        style={[s.googleBtn, oauthLoading && { opacity: 0.6 }]}
        onPress={() => signInWithProvider('google')}
        disabled={!!oauthLoading}
        activeOpacity={0.8}
      >
        {oauthLoading === 'google'
          ? <ActivityIndicator color={theme.text.primary} />
          : (
            <>
              <Text style={s.googleG}>G</Text>
              <Text style={s.googleBtnText}>Continue with Google</Text>
            </>
          )}
      </TouchableOpacity>
    </>
  );
}

const makeStyles = (theme) => StyleSheet.create({
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
  passwordRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, marginBottom: 12,
    paddingRight: 12,
  },
  passwordInput: {
    flex: 1, color: theme.text.primary, padding: 14, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  eyeBtn: { padding: 4 },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 4, paddingVertical: 2 },
  forgotText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 12, color: theme.accent.primary,
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
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.border.default },
  dividerText: {
    fontFamily: 'PlusJakartaSans-SemiBold',
    fontSize: 10, color: theme.text.muted, letterSpacing: 1.2,
  },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#ffffff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: theme.border.default,
    marginBottom: 10,
  },
  googleG: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 18, color: '#4285F4',
    width: 20, textAlign: 'center',
  },
  googleBtnText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 15, color: '#1f1f1f',
  },
});
