import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadTournamentMembers, removeTournamentMember } from '../store/tournamentStore';

export default function MembersScreen({ navigation, route }) {
  const { tournamentId, tournamentName } = route.params ?? {};
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    try {
      setRows(await loadTournamentMembers(tournamentId));
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not load members');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ownerRow = rows.find((r) => r.role === 'owner');
  const iAmOwner = ownerRow?.userId === user?.id;

  async function confirmRemove(row) {
    const name = row.profile?.display_name || 'this member';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`Remove ${name} from the tournament?`)
      : await new Promise((resolve) => Alert.alert(
          'Remove member', `Remove ${name} from the tournament?`,
          [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
           { text: 'Remove', style: 'destructive', onPress: () => resolve(true) }],
        ));
    if (!confirmed) return;
    setRemovingId(row.userId);
    try {
      await removeTournamentMember(tournamentId, row.userId);
      await load();
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Could not remove member');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Members</Text>
          {tournamentName && <Text style={s.headerSubtitle} numberOfLines={1}>{tournamentName}</Text>}
        </View>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Text style={s.sectionLabel}>{rows.length} {rows.length === 1 ? 'member' : 'members'}</Text>

          {rows.map((row) => {
            // Fallback chain: display_name → the signed-in user's own email
            // (when the row is ourselves) → short user_id. Avoids the
            // unhelpful "(no display name)" that shipped before.
            const fallbackEmail = row.userId === user?.id ? user?.email : null;
            const name = row.profile?.display_name
              || fallbackEmail
              || `Player ${row.userId.slice(0, 6)}`;
            const color = row.profile?.avatar_color || theme.accent.primary;
            const initials = (row.profile?.display_name || fallbackEmail || '?')
              .slice(0, 2).toUpperCase();
            const joined = formatDate(row.joinedAt);
            const isSelf = row.userId === user?.id;
            const canRemove = iAmOwner && row.role !== 'owner' && !isSelf;
            return (
              <View key={row.userId} style={s.row}>
                <View style={[s.avatar, { backgroundColor: color }]}>
                  <Text style={s.avatarText}>{initials}</Text>
                </View>
                <View style={s.info}>
                  <View style={s.nameRow}>
                    <Text style={s.name}>{name}</Text>
                    {isSelf && <Text style={s.youTag}>you</Text>}
                  </View>
                  <View style={s.metaRow}>
                    <View style={[s.roleBadge, row.role === 'owner' && s.roleBadgeOwner]}>
                      <Text style={[s.roleText, row.role === 'owner' && s.roleTextOwner]}>
                        {row.role.toUpperCase()}
                      </Text>
                    </View>
                    {row.profile?.handicap != null && (
                      <Text style={s.metaText}>HCP {row.profile.handicap}</Text>
                    )}
                    {joined && <Text style={s.metaText}>Joined {joined}</Text>}
                  </View>
                </View>
                {canRemove && (
                  removingId === row.userId
                    ? <ActivityIndicator color={theme.destructive} />
                    : (
                      <TouchableOpacity
                        onPress={() => confirmRemove(row)}
                        style={s.removeBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={`Remove ${name}`}
                      >
                        <Feather name="user-minus" size={18} color={theme.destructive} />
                      </TouchableOpacity>
                    )
                )}
              </View>
            );
          })}

          {rows.length === 1 && iAmOwner && (
            <Text style={s.hint}>
              Share an invite code from the tournament header to add more members.
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

const makeStyles = (theme) => StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  backBtn: {},
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 17, color: theme.text.primary },
  headerSubtitle: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 4, paddingBottom: 40 },
  sectionLabel: {
    fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 11,
    marginBottom: 12, letterSpacing: 1.8, textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 15 },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
  youTag: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.accent.primary,
    letterSpacing: 1, textTransform: 'uppercase',
    backgroundColor: theme.accent.primary + '22',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  roleBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    backgroundColor: theme.bg.secondary,
  },
  roleBadgeOwner: { backgroundColor: 'rgba(212,175,55,0.15)' },
  roleText: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9,
    color: theme.text.muted, letterSpacing: 0.8,
  },
  roleTextOwner: { color: '#d4af37' },
  metaText: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted,
  },
  removeBtn: { padding: 8 },
  hint: {
    fontFamily: 'PlusJakartaSans-Regular', fontSize: 13,
    color: theme.text.muted, marginTop: 16, lineHeight: 19,
  },
});
