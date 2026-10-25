import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform, Image,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PressableScale from '../components/ui/PressableScale';
import Reveal from '../components/ui/Reveal';
import { Skeleton, SkeletonRegion } from '../components/ui/Skeleton';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { semantic } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import {
  loadProfile, loadCachedProfile, clearCachedProfile, upsertProfile, uploadAvatar, isUsernameAvailable,
} from '../store/profileStore';
import { clearFeedSnapshot } from '../store/feedStore';
import { parseHandicapIndex, normalizeHandicapInput } from '../lib/handicap';
import { haptic } from '../lib/haptics';
import { useT, t as translate } from '../i18n';
import { useTabBarScroll, useTabBarClearance } from '../navigation/tabBarChrome';
import { useSettledFocusEffect } from '../navigation/useSettledFocusEffect';

// Stagger step between section reveals on mount.
const REVEAL_STEP = 40;

// Text input with a focus-aware border. Inputs sit inset on the warm page
// tone inside white cards, so the accent border is what signals focus.
function Field({ theme, s, style, loading = false, skeletonWidth = 60, ...rest }) {
  const [focused, setFocused] = useState(false);
  if (loading) {
    // Same box as the input, disabled, with the value as a block.
    return (
      <View style={[s.input, s.disabled, style]} accessibilityState={{ disabled: true }}>
        <Skeleton width={skeletonWidth} height={12} style={{ marginVertical: 3 }} />
      </View>
    );
  }
  return (
    <TextInput
      {...rest}
      style={[s.input, focused && s.inputFocused, style]}
      placeholderTextColor={theme.text.muted}
      keyboardAppearance={theme.isDark ? 'dark' : 'light'}
      selectionColor={theme.accent.primary}
      onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
    />
  );
}

export default function ProfileScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const isTabPresentation = route?.params?.presentation === 'tab';
  const tabBarScroll = useTabBarScroll();
  const tabBarClearance = useTabBarClearance();
  const { user } = useAuth() ?? {};
  const userId = user?.id ?? null;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Nothing to show and the load failed: an inline error with Retry.
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handicap, setHandicap] = useState('');
  const [targetHandicap, setTargetHandicap] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [gender, setGender] = useState(null);
  const [dirty, setDirty] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  // A refresh never overwrites fields the user has started editing.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const applyProfile = useCallback((p) => {
    setProfile(p);
    if (dirtyRef.current) return;
    setUsername(p?.username ?? '');
    setDisplayName(p?.displayName ?? '');
    setHandicap(p?.handicap != null ? String(p.handicap) : '');
    setTargetHandicap(p?.targetHandicap != null ? String(p.targetHandicap) : '');
    setAvatarUrl(p?.avatarUrl ?? null);
    setGender(p?.gender ?? null);
  }, []);

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) {
      // Paint the last profile this device saw, then refresh behind it.
      const cached = await loadCachedProfile(userId);
      if (cached) {
        applyProfile(cached);
        hasLoadedOnceRef.current = true;
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    try {
      applyProfile(await loadProfile());
      setLoadError(false);
    } catch {
      // With a profile on screen a failed refresh stays quiet; with nothing
      // to show it replaces the loading layout with Retry.
      if (!hasLoadedOnceRef.current) setLoadError(true);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [applyProfile, userId]);

  useSettledFocusEffect(useCallback(() => { load(); }, [load]));

  // Intercept hardware-back / swipe-back gestures so unsaved edits aren't
  // silently lost. The header back button is handled separately by handleBack.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (!dirty) return;
      e.preventDefault();
      const confirmLeave = () => navigation.dispatch(e.data.action);
      if (Platform.OS === 'web') {
        if (window.confirm(translate('profile.unsaved.body'))) confirmLeave();
        return;
      }
      Alert.alert(
        translate('profile.unsaved.title'), translate('profile.unsaved.body'),
        [{ text: translate('profile.unsaved.stay'), style: 'cancel' },
         { text: translate('profile.unsaved.discard'), style: 'destructive', onPress: confirmLeave }],
      );
    });
    return sub;
  }, [navigation, dirty]);

  async function save() {
    // Username: 3-20 chars, lowercase letters/digits/underscore only. Keeps
    // it safe to drop into URLs and @-mentions later.
    const trimmedUsername = username.trim().toLowerCase();
    if (trimmedUsername && !/^[a-z0-9_]{3,20}$/.test(trimmedUsername)) {
      Alert.alert(
        translate('profile.usernameInvalid.title'),
        translate('profile.usernameInvalid.body'),
      );
      return;
    }

    // Golf handicap range: scratch/low-single digits up to 54 (max index
    // allowed by WHS). Reject clearly wrong values so nobody saves 200
    // and wrecks their Stableford math downstream.
    const normalizedHandicap = normalizeHandicapInput(handicap);
    if (normalizedHandicap.trim() !== '') {
      const parsed = parseHandicapIndex(normalizedHandicap);
      if (!parsed.ok) {
        Alert.alert(translate('profile.handicapInvalid.title'), translate('profile.handicapInvalid.body'));
        return;
      }
    }
    // Target handicap is the comparison baseline for Strokes Gained.
    // Decimals are fine (12.5 is a valid playing-handicap target). Range
    // matches the picker's previous 0–36 bounds.
    const normalizedTargetHandicap = normalizeHandicapInput(targetHandicap);
    if (normalizedTargetHandicap.trim() !== '') {
      const t = parseHandicapIndex(normalizedTargetHandicap);
      if (!t.ok || t.value > 36) {
        Alert.alert(translate('profile.targetInvalid.title'), translate('profile.targetInvalid.body'));
        return;
      }
    }
    // Gender drives which tee rating (men's or women's) a player's handicap
    // uses, so it can't be left unset. Only block when the profile truly has
    // no gender at all — existing users were backfilled in the DB, so this
    // only ever gates new signups.
    if (gender !== 'male' && gender !== 'female') {
      Alert.alert(translate('profile.genderRequired.title'), translate('profile.genderRequired.body'));
      return;
    }

    setSaving(true);
    try {
      // Friendly pre-check when the username actually changed. The unique
      // index still backstops the race where someone claims it mid-save.
      if (trimmedUsername && trimmedUsername !== (profile?.username ?? '')) {
        const available = await isUsernameAvailable(trimmedUsername);
        if (!available) {
          Alert.alert(translate('account.usernameTaken.title'), translate('account.usernameTaken.body'));
          return;
        }
      }
      await upsertProfile({
        username: trimmedUsername,
        displayName,
        handicap: normalizedHandicap,
        targetHandicap: normalizedTargetHandicap,
        avatarUrl,
        gender,
      });
      // Saved: the form now matches the server, so the reload may fill it.
      dirtyRef.current = false;
      setDirty(false);
      await load();
    } catch (err) {
      const msg = err?.message ?? translate('account.saveFailed');
      // Unique-constraint violation on (lower(username)) surfaces as 23505.
      if (err?.code === '23505' || /duplicate|unique/i.test(msg)) {
        Alert.alert(translate('account.usernameTaken.title'), translate('profile.usernameTaken.body'));
      } else {
        Alert.alert(translate('common.error'), msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar() {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(translate('profile.photoPermission.title'), translate('profile.photoPermission.body'));
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    setUploadingAvatar(true);
    try {
      // Compress before upload: avatars render at ~84px, so a 512px JPEG at
      // 0.6 quality is plenty and keeps storage / bandwidth small.
      let uri = result.assets[0].uri;
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 512 } }],
          { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
        );
        uri = manipulated.uri;
      } catch (_) { /* fall back to the original picked image */ }
      const publicUrl = await uploadAvatar(uri);
      // Persist immediately so other screens (Members / PlayerPicker)
      // see the new photo on their next reload, without waiting for the
      // user to tap Save.
      await upsertProfile({ avatarUrl: publicUrl });
      setAvatarUrl(publicUrl);
    } catch (err) {
      Alert.alert(translate('common.error'), err.message ?? translate('profile.avatarFailed'));
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function signOut() {
    const confirmed = Platform.OS === 'web'
      ? window.confirm(translate('auth.signOutConfirm'))
      : await new Promise((resolve) => Alert.alert(
          translate('auth.signOut'), translate('auth.signOutBody'),
          [{ text: translate('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
           { text: translate('auth.signOut'), style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    // The feed's cold-start snapshot is this user's content sitting on disk.
    // loadFeedSnapshot already refuses to serve it to anyone else, but there
    // is no reason to keep it around once they sign out.
    await clearFeedSnapshot();
    await clearCachedProfile();
    await supabase.auth.signOut();
  }

  // The unsaved-changes confirmation lives in the `beforeRemove` listener
  // above, so goBack() here is enough — the listener intercepts it.
  function handleBack() {
    navigation.goBack();
  }

  const initials = (profile?.displayName || profile?.email || '?').slice(0, 2).toUpperCase();

  // Header Save: appears only with unsaved edits. Lives in the left slot when
  // the screen is a tab (slot is free) and in the right slot when pushed,
  // where the back chevron owns the left.
  const headerSave = dirty ? (
    <TouchableOpacity
      accessibilityLabel={t('profile.saveLabel')}
      onPress={save}
      disabled={saving}
      style={s.headerSaveBtn}
      activeOpacity={0.7}
    >
      {saving
        ? <ActivityIndicator size="small" color={theme.accent.primary} />
        : <Text style={s.headerSaveText}>{t('common.save')}</Text>}
    </TouchableOpacity>
  ) : (
    <View style={s.backBtn} />
  );

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        {isTabPresentation ? (
          headerSave
        ) : (
          <IconButton
            icon="chevron-left"
            accessibilityLabel={t('common.back')}
            onPress={handleBack}
          />
        )}
        <Text style={s.headerTitle}>{t('profile.title')}</Text>
        {isTabPresentation ? <View style={s.backBtn} /> : headerSave}
      </View>

      {loadError && !profile ? (
        <View style={s.errorWrap}>
          <Feather name="cloud-off" size={44} color={theme.text.muted} />
          <Text style={s.errorTitle}>{t('profile.loadFailed')}</Text>
          <Text style={s.errorSub}>{t('common.checkConnection')}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setLoadError(false); setLoading(true); load(); }}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Feather name="refresh-cw" size={14} color={theme.text.inverse} />
            <Text style={s.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: tabBarClearance }]}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          {...tabBarScroll}
        >
          {/* First open with nothing cached: the real page with blocks where
              the values go (DESIGN.md "Loading states"). Links and Sign out
              work; fields stay disabled so typing is never overwritten. */}
          {loading && <SkeletonRegion testID="profile-skeleton" />}
          <Reveal delay={0}>
            <View style={s.heroCard}>
              <TouchableOpacity
                style={[s.avatar, {
                  backgroundColor: loading ? theme.bg.skeleton : theme.accent.primary, overflow: 'hidden',
                }]}
                onPress={pickAvatar}
                activeOpacity={0.8}
                disabled={uploadingAvatar || loading}
                accessibilityLabel={t('profile.changePhoto')}
              >
                {loading ? null : avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={{ width: '100%', height: '100%' }} />
                  : <Text style={s.avatarText}>{initials}</Text>}
                {uploadingAvatar && (
                  <View style={s.avatarOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
                {!uploadingAvatar && (
                  <View style={s.avatarEditBadge}>
                    <Feather name="camera" size={14} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
              {loading ? (
                <View style={s.heroSkeleton}>
                  <Skeleton width={130} height={18} />
                  <Skeleton width={70} height={11} />
                  <Skeleton width={160} height={11} />
                </View>
              ) : null}
              {profile?.displayName ? (
                <Text style={s.heroName}>{profile.displayName}</Text>
              ) : null}
              {profile?.username ? (
                <Text style={s.usernameTag}>@{profile.username}</Text>
              ) : null}
              {loading ? null : <Text style={s.email}>{profile?.email}</Text>}
            </View>
          </Reveal>

          <Reveal delay={REVEAL_STEP}>
            <View style={s.groupCard}>
              <PressableScale
                style={s.linkRow}
                onPress={() => navigation.navigate('Friends')}
                accessibilityRole="button"
                accessibilityLabel={t('profile.link.friends')}
              >
                <View style={s.linkIconDisc}>
                  <Feather name="users" size={15} color={theme.accent.primary} />
                </View>
                <Text style={s.linkRowText}>{t('profile.link.friends')}</Text>
                <Feather name="chevron-right" size={18} color={theme.text.muted} />
              </PressableScale>
              <PressableScale
                style={[s.linkRow, s.linkRowDivider]}
                onPress={() => navigation.navigate('Bag')}
                accessibilityRole="button"
                accessibilityLabel={t('profile.link.bagA11y')}
              >
                <View style={s.linkIconDisc}>
                  <Feather name="briefcase" size={15} color={theme.accent.primary} />
                </View>
                <Text style={s.linkRowText}>{t('profile.link.bag')}</Text>
                <Feather name="chevron-right" size={18} color={theme.text.muted} />
              </PressableScale>
              {/* Swing analyzer: the Android module, or the browser build (native.web.js). No iOS app build has it. */}
              {(Platform.OS === 'android' || Platform.OS === 'web') && (
                <PressableScale
                  style={[s.linkRow, s.linkRowDivider]}
                  onPress={() => navigation.navigate('SwingHome')}
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.link.swing')}
                >
                  <View style={s.linkIconDisc}>
                    <Feather name="activity" size={15} color={theme.accent.primary} />
                  </View>
                  <Text style={s.linkRowText}>{t('profile.link.swing')}</Text>
                  <Feather name="chevron-right" size={18} color={theme.text.muted} />
                </PressableScale>
              )}
              <PressableScale
                style={[s.linkRow, s.linkRowDivider]}
                onPress={() => navigation.navigate('Settings')}
                accessibilityRole="button"
                accessibilityLabel={t('settings.title')}
              >
                <View style={s.linkIconDisc}>
                  <Feather name="settings" size={15} color={theme.accent.primary} />
                </View>
                <Text style={s.linkRowText}>{t('settings.title')}</Text>
                <Feather name="chevron-right" size={18} color={theme.text.muted} />
              </PressableScale>
            </View>
          </Reveal>

          <Reveal delay={REVEAL_STEP * 2}>
            <Text style={s.sectionLabel}>{t('profile.section.account')}</Text>
            <View style={s.formCard}>
              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>{t('account.username')}</Text>
                <Field
                  theme={theme} s={s} loading={loading} skeletonWidth={70}
                  placeholder={t('account.usernamePlaceholder')}
                  value={username}
                  onChangeText={(v) => { setUsername(v.toLowerCase()); setDirty(true); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={s.fieldHint}>
                  {t('profile.hint.username')}
                </Text>
              </View>

              <View style={[s.fieldGroup, s.fieldGroupLast]}>
                <Text style={s.fieldLabel}>{t('account.displayName')}</Text>
                <Field
                  theme={theme} s={s} loading={loading} skeletonWidth={96}
                  placeholder={t('profile.displayNamePlaceholder')}
                  value={displayName}
                  onChangeText={(v) => { setDisplayName(v); setDirty(true); }}
                  autoCapitalize="words"
                />
                <Text style={s.fieldHint}>
                  {t('profile.hint.displayName')}
                </Text>
              </View>
            </View>
          </Reveal>

          <Reveal delay={REVEAL_STEP * 3}>
            <Text style={s.sectionLabel}>{t('profile.section.golf')}</Text>
            <View style={s.formCard}>
              <View style={[s.fieldGroup, { flexDirection: 'row', gap: 16 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>{t('account.handicap')}</Text>
                  <Field
                    theme={theme} s={s} loading={loading} skeletonWidth={30}
                    placeholder="—"
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    value={handicap}
                    onChangeText={(v) => { setHandicap(normalizeHandicapInput(v)); setDirty(true); }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>{t('profile.field.targetHandicap')}</Text>
                  <Field
                    theme={theme} s={s} loading={loading} skeletonWidth={22}
                    placeholder="—"
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    value={targetHandicap}
                    onChangeText={(v) => { setTargetHandicap(normalizeHandicapInput(v)); setDirty(true); }}
                  />
                </View>
              </View>

              <View style={[s.fieldGroup, s.fieldGroupLast]}>
                <Text style={s.fieldLabel}>{t('account.gender')}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  {[['male', 'common.male'], ['female', 'common.female']].map(([value, label]) => (
                    <PressableScale
                      key={value}
                      onPress={() => { haptic('selection'); setGender(value); setDirty(true); }}
                      disabled={loading}
                      style={[s.genderPill, gender === value && s.genderPillActive, loading && s.disabled]}
                      accessibilityRole="button"
                      accessibilityLabel={t(label)}
                      accessibilityState={{ selected: gender === value, disabled: loading }}
                    >
                      <Text style={[s.genderPillText, gender === value && s.genderPillTextActive]}>{t(label)}</Text>
                    </PressableScale>
                  ))}
                </View>
                <Text style={s.fieldHint}>
                  {t('account.genderHint')}
                </Text>
              </View>
            </View>
          </Reveal>

          <Reveal delay={REVEAL_STEP * 4}>
            <TouchableOpacity
              style={s.signOutBtn}
              onPress={signOut}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('auth.signOut')}
            >
              <Feather name="log-out" size={16} color={theme.destructive} />
              <Text style={s.signOutText}>{t('auth.signOut')}</Text>
            </TouchableOpacity>
          </Reveal>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  errorWrap: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  errorTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 18, color: theme.text.primary },
  errorSub: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13, color: theme.text.muted,
    textAlign: 'center', paddingHorizontal: 40,
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
    backgroundColor: theme.accent.primary, borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 12,
  },
  retryText: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.inverse },
  heroSkeleton: { alignItems: 'center', gap: 7, marginTop: 2 },
  disabled: { opacity: 0.6 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 150 },

  heroCard: { alignItems: 'center', marginBottom: 20 },
  avatar: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 26, color: semantic.winner.dark },
  avatarEditBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: theme.accent.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: theme.bg.primary,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroName: {
    fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary,
    fontSize: 20, marginBottom: 2,
  },
  usernameTag: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
    fontSize: 13, marginBottom: 2,
  },
  email: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12 },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted, fontSize: 10,
    letterSpacing: 1.4, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 10,
  },

  groupCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    paddingHorizontal: 14,
  },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13,
  },
  linkRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle,
  },
  linkIconDisc: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: theme.accent.light,
    alignItems: 'center', justifyContent: 'center',
  },
  linkRowText: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.text.primary, fontSize: 14,
  },

  formCard: {
    backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    padding: 14,
  },
  fieldGroup: { marginBottom: 16 },
  fieldGroupLast: { marginBottom: 0 },
  fieldLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
    fontSize: 12, marginBottom: 6,
  },
  fieldHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 11, marginTop: 6,
  },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
    color: theme.text.primary, borderRadius: 12, borderWidth: 1,
    borderColor: theme.border.default, padding: 13, fontSize: 15,
    fontFamily: 'PlusJakartaSans-Medium',
  },
  inputFocused: {
    borderColor: theme.accent.primary,
  },

  genderPill: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  genderPillActive: { borderColor: theme.accent.primary, backgroundColor: theme.accent.light },
  genderPillText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 13 },
  genderPillTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },

  headerSaveBtn: {
    minWidth: 40, height: 40, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  headerSaveText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.accent.primary,
    fontSize: 15,
  },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, marginTop: 32, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
  },
  signOutText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 14,
  },
});
