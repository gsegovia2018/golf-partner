import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { upsertProfile, isUsernameAvailable } from '../store/profileStore';

// Blocking first-run step for fresh sign-ups (AppNavigator gates on a
// missing username; existing accounts sign in straight through). Username
// powers friend search / @-handles; gender decides which tee rating (men's
// or women's) the player's handicap uses, so neither can stay unset here.
//
// `profile` is the freshly loaded profile row; `onDone` tells the navigator
// the gate can drop.
export default function OnboardingScreen({ profile, onDone }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // Suggest the email local-part, squeezed into the allowed charset — same
  // convention the DB used when it backfilled legacy usernames.
  const [username, setUsername] = useState(() =>
    (profile?.username
      || (profile?.email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
    ),
  );
  const [gender, setGender] = useState(profile?.gender ?? null);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  // 'idle' | 'checking' | 'available' | 'taken' | 'unknown' (unknown = probe
  // failed, e.g. offline — never blocks Continue, save-time check stands).
  const [availability, setAvailability] = useState('idle');
  const [saving, setSaving] = useState(false);

  const trimmedUsername = username.trim().toLowerCase();
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(trimmedUsername);

  useEffect(() => {
    if (!usernameValid) { setAvailability('idle'); return undefined; }
    setAvailability('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(trimmedUsername);
        if (!cancelled) setAvailability(ok ? 'available' : 'taken');
      } catch {
        if (!cancelled) setAvailability('unknown');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmedUsername, usernameValid]);

  const trimmedDisplayName = displayName.trim();
  const canContinue = usernameValid
    && availability !== 'taken'
    && trimmedDisplayName.length > 0 && trimmedDisplayName.length <= 40
    && (gender === 'male' || gender === 'female')
    && !saving;

  async function submit() {
    if (!canContinue) return;
    setSaving(true);
    try {
      const available = await isUsernameAvailable(trimmedUsername);
      if (!available) {
        Alert.alert('Username taken', 'That username is already taken. Pick another one.');
        return;
      }
      await upsertProfile({ username: trimmedUsername, displayName: trimmedDisplayName, gender });
      onDone();
    } catch (err) {
      const msg = err?.message ?? 'Could not save profile';
      // Race backstop: unique(lower(username)) surfaces as 23505.
      if (err?.code === '23505' || /duplicate|unique/i.test(msg)) {
        Alert.alert('Username taken', 'That username is already taken. Pick another one.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <Feather name="flag" size={26} color={theme.accent.primary} />
          </View>
          <Text style={s.title}>Welcome to Golf Partner</Text>
          <Text style={s.subtitle}>Three quick things before you tee off.</Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Username</Text>
          <TextInput
            style={s.input}
            accessibilityLabel="Username"
            placeholder="shorthandle"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={username}
            onChangeText={(v) => setUsername(v.toLowerCase())}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          <Text style={[
            s.fieldHint,
            availability === 'available' && { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-SemiBold' },
            availability === 'taken' && { color: theme.destructive ?? '#c8102e' },
          ]}>
            {username.length > 0 && !usernameValid
              ? 'Must be 3–20 characters: lowercase letters, digits or underscores.'
              : availability === 'taken'
                ? 'That username is already taken. Pick another one.'
                : availability === 'available'
                  ? `✓ Available — friends find you as @${trimmedUsername}`
                  : 'Unique handle friends use to find you. You can change it later.'}
          </Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Display name</Text>
          <TextInput
            style={s.input}
            accessibilityLabel="Display name"
            placeholder="Your name"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={40}
          />
          <Text style={s.fieldHint}>How you appear on scorecards and leaderboards.</Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Gender</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {[['male', 'Male'], ['female', 'Female']].map(([value, label]) => (
              <TouchableOpacity
                key={value}
                onPress={() => setGender(value)}
                style={[s.genderPill, gender === value && s.genderPillActive]}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: gender === value }}
                activeOpacity={0.7}
              >
                <Text style={[s.genderPillText, gender === value && s.genderPillTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.fieldHint}>
            Sets which tee rating (men&apos;s or women&apos;s) your handicap uses.
          </Text>
        </View>

        <TouchableOpacity
          accessibilityLabel="Continue"
          style={[s.continueBtn, !canContinue && { opacity: 0.5 }]}
          onPress={submit}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            : <Text style={s.continueBtnText}>Continue</Text>}
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  content: { padding: 24, paddingTop: 36, maxWidth: 480, width: '100%', alignSelf: 'center' },

  hero: { alignItems: 'center', marginBottom: 28 },
  heroIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: theme.accent.light,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  title: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 22,
    color: theme.text.primary, marginBottom: 6, textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 14,
    color: theme.text.secondary, textAlign: 'center',
  },

  fieldGroup: { marginBottom: 18 },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
    fontSize: 12, marginBottom: 6,
  },
  fieldHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: 6,
  },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, padding: 13, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },

  genderPill: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  genderPillActive: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  genderPillText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  genderPillTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },

  continueBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 10,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  continueBtnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 15,
  },
});
