import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AuthForm from '../components/AuthForm';
import AuthShell from '../components/auth/AuthShell';
import makeFieldStyles from '../components/auth/fieldStyles';
import { useT } from '../i18n';
import { useTheme } from '../theme/ThemeContext';

// Login: the hole-plan frame (AuthShell) around a "Sign in" / "Create your
// account" heading, the form and a link under it that switches between them.
// From a public page (a shared swing) it opens in `initialMode` with a link back to it.
export default function AuthScreen({ initialMode = 'signin', onBack = null, backLabel = null } = {}) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const [mode, setMode] = useState(initialMode);
  const signin = mode === 'signin';

  return (
    <AuthShell>
      <Text style={s.heading} accessibilityRole="header">
        {signin ? t('auth.heading.signin') : t('auth.heading.signup')}
      </Text>
      <AuthForm mode={mode} onSignedUp={() => setMode('signin')} />
      <View style={s.switchRow}>
        <Text style={s.switchLead}>
          {signin ? t('auth.switch.toSignupLead') : t('auth.switch.toSigninLead')}
        </Text>
        <TouchableOpacity
          onPress={() => setMode(signin ? 'signup' : 'signin')}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        >
          <Text style={s.switchAction}>
            {signin ? t('auth.switch.toSignup') : t('auth.switch.toSignin')}
          </Text>
        </TouchableOpacity>
      </View>
      {onBack ? (
        <TouchableOpacity onPress={onBack} accessibilityRole="button" style={s.back} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} testID="auth-back">
          <Text style={s.switchAction}>{`‹ ${backLabel}`}</Text>
        </TouchableOpacity>
      ) : null}
    </AuthShell>
  );
}

const makeStyles = (theme) => ({
  heading: makeFieldStyles(theme).heading,
  ...StyleSheet.create({
    switchRow: {
      flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center',
      gap: 6, marginTop: 20,
    },
    switchLead: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 14, color: theme.text.secondary },
    switchAction: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.accent.primary },
    back: { alignSelf: 'center', marginTop: 16, minHeight: 44, justifyContent: 'center' },
  }),
});
