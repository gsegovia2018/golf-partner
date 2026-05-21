import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  loadTournament, loadTournamentMembers, findClaimedSlot,
} from '../store/tournamentStore';
import { playerInitials } from '../components/RoundTeeAssignments';

export default function PlayersScreen({ navigation, route }) {
  const { tournamentId, tournamentName } = route.params ?? {};
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);

  const [tournament, setTournament] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, mem] = await Promise.all([
        loadTournament(),
        tournamentId ? loadTournamentMembers(tournamentId) : Promise.resolve([]),
      ]);
      setTournament(t);
      setMembers(mem);
    } catch (err) {
      setLoadError(err?.message ?? 'Could not load players');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ownerRow = members.find((m) => m.role === 'owner');
  const isOwner = !!ownerRow && ownerRow.userId === user?.id;
  const myRow = members.find((m) => m.userId === user?.id);
  const isViewer = myRow?.role === 'viewer';

  const players = tournament?.players ?? [];

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Players</Text>
          {tournamentName ? <Text style={s.headerSubtitle} numberOfLines={1}>{tournamentName}</Text> : null}
        </View>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}><ActivityIndicator color={theme.accent.primary} /></View>
      ) : loadError ? (
        <View style={s.errorBox}>
          <Feather name="wifi-off" size={22} color={theme.destructive} />
          <Text style={s.errorTitle}>Couldn't load players</Text>
          <Text style={s.errorMsg}>{loadError}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.7}>
            <Feather name="refresh-cw" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Text style={s.sectionLabel}>{players.length} {players.length === 1 ? 'player' : 'players'}</Text>
          {players.map((p) => {
            const member = members.find((m) => m.userId === p.user_id) || null;
            const color = member?.profile?.avatar_color || theme.accent.primary;
            return (
              <View key={p.id} style={s.row}>
                <View style={[s.avatar, { backgroundColor: color }]}>
                  {member?.profile?.avatar_url
                    ? <Image source={{ uri: member.profile.avatar_url }} style={s.avatarImg} />
                    : <Text style={s.avatarText}>{playerInitials(p.name)}</Text>}
                </View>
                <View style={s.info}>
                  <Text style={s.name}>{p.name}</Text>
                  <View style={s.metaRow}>
                    {member ? (
                      <View style={[s.roleBadge, member.role === 'owner' && s.roleBadgeOwner]}>
                        <Text style={[s.roleText, member.role === 'owner' && s.roleTextOwner]}>
                          {member.role.toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={s.metaText}>HCP {p.handicap}</Text>
                  </View>
                </View>
              </View>
            );
          })}
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
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.border.default, padding: 14, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: '#ffd700', fontSize: 15 },
  info: { flex: 1 },
  name: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
  metaText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.bg.secondary },
  roleBadgeOwner: { backgroundColor: 'rgba(212,175,55,0.15)' },
  roleText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9, color: theme.text.muted, letterSpacing: 0.8 },
  roleTextOwner: { color: '#d4af37' },
  // --- handicap input (Task 2) ---
  hcpInput: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default,
    width: 54, textAlign: 'center', fontSize: 16,
    fontFamily: 'PlusJakartaSans-Bold', padding: 7,
  },
  // --- save pill (Task 2) ---
  savePill: {
    flexDirection: 'row', alignItems: 'center', minWidth: 64, justifyContent: 'center',
    backgroundColor: theme.bg.secondary, borderRadius: 10, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 8, paddingVertical: 4,
  },
  savePillSaved: { borderColor: theme.accent.primary + '55' },
  savePillError: { borderColor: theme.destructive, backgroundColor: theme.destructive + '15' },
  savePillText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10, color: theme.text.muted },
  savePillTextError: { color: theme.destructive },
  // --- row actions (Tasks 4 & 5) ---
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleActionBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: theme.accent.light,
    borderWidth: 1, borderColor: theme.accent.primary + '33',
    alignItems: 'center', justifyContent: 'center',
  },
  removeBtn: { padding: 8 },
  // --- add / invite / leave buttons (Tasks 4 & 5) ---
  addBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.accent.light, borderRadius: 10,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 12, paddingVertical: 7,
  },
  addBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13 },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.accent.light, borderRadius: 12,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    padding: 14, marginTop: 6,
  },
  inviteBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, marginTop: 24, borderRadius: 12,
    borderWidth: 1, borderColor: theme.border.default,
  },
  leaveBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 14 },
  // --- tees section (Task 3) ---
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginTop: 24, marginBottom: 8,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  roundCard: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 10,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  roundCardTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary,
    fontSize: 14, marginBottom: 8,
  },
  // --- error box ---
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15, marginTop: 10 },
  errorMsg: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 13, marginTop: 4, textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: theme.accent.light,
    borderRadius: 10, borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 16, paddingVertical: 10, marginTop: 14,
  },
  retryBtnText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },
});
