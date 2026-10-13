import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { upsertProfile, isUsernameAvailable } from '../store/profileStore';
import { useT, t as translate } from '../i18n';

// Blocking first-run step for fresh sign-ups (AppNavigator gates on a
// missing username; existing accounts sign in straight through). Username
// powers friend search / @-handles; gender decides which tee rating (men's
// or women's) the player's handicap uses, so neither can stay unset here.
//
// `profile` is the freshly loaded profile row; `onDone` tells the navigator
// the gate can drop.
export default function OnboardingScreen({ profile, onDone }) {
  const { theme } = useTheme();
  const t = useT();
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
        Alert.alert(translate('account.usernameTaken.title'), translate('account.usernameTaken.body'));
        return;
      }
      await upsertProfile({ username: trimmedUsername, displayName: trimmedDisplayName, gender });
      onDone();
    } catch (err) {
      const msg = err?.message ?? translate('account.saveFailed');
      // Race backstop: unique(lower(username)) surfaces as 23505.
      if (err?.code === '23505' || /duplicate|unique/i.test(msg)) {
        Alert.alert(translate('account.usernameTaken.title'), translate('account.usernameTaken.body'));
      } else {
        Alert.alert(translate('common.error'), msg);
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
          <Text style={s.title}>{t('onboarding.title')}</Text>
          <Text style={s.subtitle}>{t('onboarding.subtitle')}</Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>{t('account.username')}</Text>
          <TextInput
            style={s.input}
            accessibilityLabel={t('account.username')}
            placeholder={t('account.usernamePlaceholder')}
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
              ? t('onboarding.username.invalid')
              : availability === 'taken'
                ? t('account.usernameTaken.body')
                : availability === 'available'
                  ? t('onboarding.username.available', { username: trimmedUsername })
                  : t('onboarding.username.hint')}
          </Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>{t('account.displayName')}</Text>
          <TextInput
            style={s.input}
            accessibilityLabel={t('account.displayName')}
            placeholder={t('account.namePlaceholder')}
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={40}
          />
          <Text style={s.fieldHint}>{t('onboarding.displayName.hint')}</Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>{t('account.gender')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {[['male', 'common.male'], ['female', 'common.female']].map(([value, label]) => (
              <TouchableOpacity
                key={value}
                onPress={() => setGender(value)}
                style={[s.genderPill, gender === value && s.genderPillActive]}
                accessibilityRole="button"
                accessibilityLabel={t(label)}
                accessibilityState={{ selected: gender === value }}
                activeOpacity={0.7}
              >
                <Text style={[s.genderPillText, gender === value && s.genderPillTextActive]}>{t(label)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.fieldHint}>
            {t('account.genderHint')}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityLabel={t('onboarding.continue')}
          style={[s.continueBtn, !canContinue && { opacity: 0.5 }]}
          onPress={submit}
          disabled={!canContinue}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
            : <Text style={s.continueBtnText}>{t('onboarding.continue')}</Text>}
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
