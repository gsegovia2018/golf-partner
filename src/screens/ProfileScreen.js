import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform, Switch, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { loadProfile, upsertProfile, uploadAvatar, computePersonalStats } from '../store/profileStore';
import { getShowRunningScore, setShowRunningScore } from '../lib/prefs';

const AVATAR_COLORS = ['#006747', '#c77b38', '#1b4965', '#7b3f6b', '#4a6d3f', '#b33951'];

export default function ProfileScreen({ navigation }) {
  const { theme, mode, toggle } = useTheme();
  const s = makeStyles(theme);

  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handicap, setHandicap] = useState('');
  const [avatarColor, setAvatarColor] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showRunning, setShowRunning] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, running] = await Promise.all([loadProfile(), getShowRunningScore()]);
      setProfile(p);
      setUsername(p?.username ?? '');
      setDisplayName(p?.displayName ?? '');
      setHandicap(p?.handicap != null ? String(p.handicap) : '');
      setAvatarColor(p?.avatarColor ?? null);
      setAvatarUrl(p?.avatarUrl ?? null);
      setShowRunning(running);
      setDirty(false);
      if (p?.userId || p?.displayName) {
        // Prefer user_id matching — it's a stable account link, whereas
        // displayName matching is fuzzy and breaks on renames. Only pass
        // displayName as a fallback when there is no userId.
        setStats(await computePersonalStats(
          p?.userId
            ? { userId: p.userId }
            : { displayName: p?.displayName },
        ));
      } else {
        setStats(null);
      }
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleShowRunning = useCallback((next) => {
    setShowRunning(next);
    setShowRunningScore(next).catch((err) => {
      Alert.alert('Error', err.message ?? 'Could not save preference');
    });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Intercept hardware-back / swipe-back gestures so unsaved edits aren't
  // silently lost. The header back button is handled separately by handleBack.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (!dirty) return;
      e.preventDefault();
      const confirmLeave = () => navigation.dispatch(e.data.action);
      if (Platform.OS === 'web') {
        if (window.confirm('You have unsaved changes. Leave without saving?')) confirmLeave();
        return;
      }
      Alert.alert(
        'Unsaved changes', 'You have unsaved changes. Leave without saving?',
        [{ text: 'Stay', style: 'cancel' },
         { text: 'Discard', style: 'destructive', onPress: confirmLeave }],
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
        'Invalid username',
        'Username must be 3–20 characters: lowercase letters, digits or underscores.',
      );
      return;
    }

    // Golf handicap range: scratch/low-single digits up to 54 (max index
    // allowed by WHS). Reject clearly wrong values so nobody saves 200
    // and wrecks their Stableford math downstream.
    if (handicap.trim() !== '') {
      const n = parseInt(handicap, 10);
      if (!Number.isFinite(n) || n < 0 || n > 54) {
        Alert.alert('Invalid handicap', 'Handicap must be a whole number between 0 and 54.');
        return;
      }
    }
    setSaving(true);
    try {
      await upsertProfile({ username: trimmedUsername, displayName, handicap, avatarColor, avatarUrl });
      await load();
    } catch (err) {
      const msg = err?.message ?? 'Could not save profile';
      // Unique-constraint violation on (lower(username)) surfaces as 23505.
      if (err?.code === '23505' || /duplicate|unique/i.test(msg)) {
        Alert.alert('Username taken', 'Pick another username.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar() {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to change your avatar.');
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
      Alert.alert('Error', err.message ?? 'Could not upload avatar');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function signOut() {
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Sign out?')
      : await new Promise((resolve) => Alert.alert(
          'Sign out', 'Are you sure?',
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Sign out', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    await supabase.auth.signOut();
  }

  // The unsaved-changes confirmation lives in the `beforeRemove` listener
  // above, so goBack() here is enough — the listener intercepts it.
  function handleBack() {
    navigation.goBack();
  }

  const initials = (profile?.displayName || profile?.email || '?').slice(0, 2).toUpperCase();
  const resolvedAvatarColor = avatarColor || AVATAR_COLORS[0];

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={handleBack} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Profile</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
          <View style={s.heroCard}>
            <TouchableOpacity
              style={[s.avatar, { backgroundColor: resolvedAvatarColor, overflow: 'hidden' }]}
              onPress={pickAvatar}
              activeOpacity={0.8}
              disabled={uploadingAvatar}
            >
              {avatarUrl
                ? <Image source={{ uri: avatarUrl }} style={{ width: '100%', height: '100%' }} />
                : <Text style={s.avatarText}>{initials}</Text>}
              {uploadingAvatar && (
                <View style={s.avatarOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}
              {!uploadingAvatar && (
                <View style={s.avatarEditBadge}>
                  <Feather name="camera" size={12} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
            <Text style={s.email}>{profile?.email}</Text>
          </View>

          <Text style={s.sectionLabel}>ACCOUNT</Text>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Username</Text>
            <TextInput
              style={s.input}
              placeholder="shorthandle"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={username}
              onChangeText={(v) => { setUsername(v.toLowerCase()); setDirty(true); }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={s.fieldHint}>
              Unique, lowercase. 3–20 letters, digits or underscores. Used in links.
            </Text>
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Display name</Text>
            <TextInput
              style={s.input}
              placeholder="How should we call you?"
              placeholderTextColor={theme.text.muted}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={displayName}
              onChangeText={(v) => { setDisplayName(v); setDirty(true); }}
              autoCapitalize="words"
            />
            <Text style={s.fieldHint}>
              Shown in tournaments and on the leaderboard.
            </Text>
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Handicap</Text>
            <TextInput
              style={[s.input, { width: 100 }]}
              placeholder="—"
              placeholderTextColor={theme.text.muted}
              keyboardType="numeric"
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              selectionColor={theme.accent.primary}
              value={handicap}
              onChangeText={(v) => { setHandicap(v); setDirty(true); }}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Avatar color</Text>
            <View style={s.colorRow}>
              {AVATAR_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    s.colorDot,
                    { backgroundColor: c },
                    resolvedAvatarColor === c && s.colorDotActive,
                  ]}
                  onPress={() => { setAvatarColor(c); setDirty(true); }}
                  activeOpacity={0.7}
                />
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[s.saveBtn, (!dirty || saving) && { opacity: 0.5 }]}
            onPress={save}
            disabled={!dirty || saving}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator color={theme.isDark ? theme.accent.primary : theme.text.inverse} />
              : <Text style={s.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>

          <Text style={s.sectionLabel}>APPEARANCE</Text>

          <View style={s.appearanceRow}>
            {[
              { value: 'light', label: 'Light', icon: 'sun' },
              { value: 'dark', label: 'Dark', icon: 'moon' },
            ].map((opt) => {
              const active = mode === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.appearanceTile, active && s.appearanceTileActive]}
                  onPress={() => { if (!active) toggle(); }}
                  activeOpacity={0.7}
                >
                  <Feather
                    name={opt.icon}
                    size={18}
                    color={active ? theme.accent.primary : theme.text.muted}
                  />
                  <Text style={[s.appearanceLabel, active && s.appearanceLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.sectionLabel}>PREFERENCES</Text>

          <View style={s.prefRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.prefLabel}>Show running points on scorecard</Text>
              <Text style={s.fieldHint}>
                Displays each player's total Stableford points under their name.
              </Text>
            </View>
            <Switch
              value={showRunning}
              onValueChange={toggleShowRunning}
              trackColor={{ false: theme.border.default, true: theme.accent.primary }}
              thumbColor={Platform.OS === 'android' ? theme.bg.card : undefined}
            />
          </View>

          <Text style={s.sectionLabel}>PERSONAL STATS</Text>

          {!profile?.displayName ? (
            <Text style={s.statsHint}>
              Set a display name above and we'll match it to players in your tournaments.
            </Text>
          ) : stats ? (
            <>
              <View style={s.statsGrid}>
                <StatCell label="Tournaments" value={stats.tournamentsPlayed} theme={theme} s={s} />
                <StatCell label="Rounds" value={stats.roundsPlayed} theme={theme} s={s} />
                <StatCell label="Total pts" value={stats.totalPoints} theme={theme} s={s} />
                <StatCell
                  label="Avg / round"
                  value={stats.roundsPlayed > 0 ? stats.avgPointsPerRound.toFixed(1) : '—'}
                  theme={theme}
                  s={s}
                />
                <StatCell label="Wins" value={stats.wins} theme={theme} s={s} />
                <StatCell
                  label="Best round"
                  value={stats.bestRound ? `${stats.bestRound.points} pts` : '—'}
                  theme={theme}
                  s={s}
                />
              </View>

              {stats.bestRound && (
                <View style={s.bestRoundCard}>
                  <Feather name="award" size={18} color={theme.accent.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.bestRoundTitle}>Best round</Text>
                    <Text style={s.bestRoundMeta}>
                      {stats.bestRound.points} pts · {stats.bestRound.strokes} strokes
                    </Text>
                    <Text style={s.bestRoundSub}>
                      {stats.bestRound.tournamentName} · R{stats.bestRound.roundIndex + 1}
                      {stats.bestRound.courseName ? ` · ${stats.bestRound.courseName}` : ''}
                    </Text>
                  </View>
                </View>
              )}

              {stats.tournamentsPlayed === 0 && (
                <Text style={s.statsHint}>
                  No tournaments matched "{profile.displayName}" yet. Check the display name
                  matches a player name exactly.
                </Text>
              )}
            </>
          ) : null}

          <Text style={s.sectionLabel}>SOCIAL</Text>

          <TouchableOpacity
            style={s.linkRow}
            onPress={() => navigation.navigate('Friends')}
            activeOpacity={0.7}
          >
            <Feather name="users" size={18} color={theme.accent.primary} />
            <Text style={s.linkRowText}>Friends</Text>
            <Feather name="chevron-right" size={18} color={theme.text.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={s.signOutBtn}
            onPress={signOut}
            activeOpacity={0.7}
          >
            <Feather name="log-out" size={16} color={theme.destructive} />
            <Text style={s.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCell({ label, value, s }) {
  return (
    <View style={s.statCell}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 60 },

  heroCard: { alignItems: 'center', marginBottom: 20 },
  avatar: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 26, color: '#ffd700' },
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
  email: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13 },

  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, marginTop: 16, letterSpacing: 1.8, textTransform: 'uppercase',
  },

  fieldGroup: { marginBottom: 14 },
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

  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorDot: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: 'transparent',
  },
  colorDotActive: { borderColor: theme.accent.primary },

  saveBtn: {
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
    borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 8,
    borderWidth: theme.isDark ? 1 : 0,
    borderColor: theme.isDark ? theme.accent.primary + '33' : 'transparent',
  },
  saveBtnText: {
    fontFamily: 'PlusJakartaSans-ExtraBold',
    color: theme.isDark ? theme.accent.primary : theme.text.inverse,
    fontSize: 15,
  },

  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, padding: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  prefLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14,
  },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCell: {
    flexGrow: 1, flexBasis: '30%',
    backgroundColor: theme.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center',
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  statValue: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: theme.text.primary },
  statLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10,
    color: theme.text.muted, marginTop: 4, letterSpacing: 1, textTransform: 'uppercase',
  },
  statsHint: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted,
    fontSize: 13, lineHeight: 19, paddingVertical: 10,
  },

  bestRoundCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, marginTop: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  bestRoundTitle: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted,
    fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
  },
  bestRoundMeta: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15, marginTop: 2 },
  bestRoundSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },

  appearanceRow: { flexDirection: 'row', gap: 10 },
  appearanceTile: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.bg.card,
    borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
    paddingVertical: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  appearanceTileActive: {
    borderColor: theme.accent.primary,
    backgroundColor: theme.isDark ? theme.accent.light : theme.accent.light,
  },
  appearanceLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 14,
  },
  appearanceLabelActive: {
    color: theme.accent.primary,
    fontFamily: 'PlusJakartaSans-Bold',
  },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
    borderColor: theme.border.default, padding: 14,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  linkRowText: {
    flex: 1, fontFamily: 'PlusJakartaSans-SemiBold',
    color: theme.text.primary, fontSize: 14,
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
