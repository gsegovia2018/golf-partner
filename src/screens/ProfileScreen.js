import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { loadProfile, upsertProfile, computePersonalStats } from '../store/profileStore';

const AVATAR_COLORS = ['#006747', '#c77b38', '#1b4965', '#7b3f6b', '#4a6d3f', '#b33951'];

export default function ProfileScreen({ navigation }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [handicap, setHandicap] = useState('');
  const [avatarColor, setAvatarColor] = useState(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await loadProfile();
      setProfile(p);
      setDisplayName(p?.displayName ?? '');
      setHandicap(p?.handicap != null ? String(p.handicap) : '');
      setAvatarColor(p?.avatarColor ?? null);
      setDirty(false);
      if (p?.displayName) {
        setStats(await computePersonalStats(p.displayName));
      } else {
        setStats(null);
      }
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
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
      await upsertProfile({ displayName, handicap, avatarColor });
      await load();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not save profile');
    } finally {
      setSaving(false);
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

  const initials = (profile?.displayName || profile?.email || '?').slice(0, 2).toUpperCase();
  const resolvedAvatarColor = avatarColor || AVATAR_COLORS[0];

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
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
        <ScrollView style={s.scroll} contentContainerStyle={s.content} automaticallyAdjustKeyboardInsets>
          <View style={s.heroCard}>
            <View style={[s.avatar, { backgroundColor: resolvedAvatarColor }]}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <Text style={s.email}>{profile?.email}</Text>
          </View>

          <Text style={s.sectionLabel}>ACCOUNT</Text>

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
              Used to match you to players in tournaments for personal stats.
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
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 24, color: '#ffd700' },
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

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, marginTop: 32, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
  },
  signOutText: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 14,
  },
});
