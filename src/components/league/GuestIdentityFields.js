import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { EMAIL_RE } from '../../lib/email';

export const NAME_MAX = 60;

// Both required: the server refuses a nameless guest, and the email is what
// lets the guest keep the account.
export function guestIdentityErrors({ name, email }) {
  return {
    nameError: String(name ?? '').trim() ? null : 'Enter your name',
    emailError: EMAIL_RE.test(String(email ?? '').trim()) ? null : 'Enter a valid email address',
  };
}

// Labelled text field used by the league join forms. `error` (string) turns
// the border red and shows under the field.
export function LabeledField({ label, error, inputStyle, ...inputProps }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, error && s.inputError, inputStyle]}
        placeholderTextColor={theme.text.muted}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        accessibilityLabel={label}
        {...inputProps}
      />
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

// Name + email for someone joining a league without an account yet.
export default function GuestIdentityFields({
  name, onChangeName, email, onChangeEmail, nameError, emailError, onBlurName, onBlurEmail,
}) {
  return (
    <>
      <LabeledField
        label="Name"
        placeholder="First and last name"
        value={name}
        onChangeText={onChangeName}
        onBlur={onBlurName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={NAME_MAX}
        error={nameError}
      />
      <LabeledField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={onChangeEmail}
        onBlur={onBlurEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        error={emailError}
      />
    </>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    field: { marginBottom: 14 },
    label: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12, marginBottom: 6,
    },
    input: {
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
      color: theme.text.primary, borderRadius: 12, borderWidth: 1,
      borderColor: theme.border.default, padding: 14, fontSize: 15,
      fontFamily: 'PlusJakartaSans-Medium',
    },
    inputError: { borderColor: theme.destructive },
    error: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.destructive, fontSize: 12, marginTop: 6, marginLeft: 2,
    },
  });
}
