import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Share, Clipboard, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PullToRefresh from '../components/PullToRefresh';
import BottomSheet from '../components/BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import {
  castHandicapBallot, openHandicapVote, setLeagueHandicap,
} from '../store/leagueStore';
import { parseMemberHandicap, leagueJoinLink } from '../store/leagueDraft';
import {
  formatEuros, potCents, memberLabel, memberName, handicapEventLine, voteThreshold,
} from '../store/leagueView';
import { shareOrigin } from '../lib/shareOrigin';

function fail(e) {
  Alert.alert('Error', e?.message || 'Something went wrong');
}

const shortDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

// Members, league handicaps and their history, the open handicap vote, and the
// invite link. Fee and role changes live in League settings.
export default function LeagueMembersScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, loading, refreshing, error, reload, refresh } = useLeague(navigation, leagueId);

  const [target, setTarget] = useState(null); // member whose handicap sheet is open
  const [hcpText, setHcpText] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={s.headerTitle}>Members</Text>
    </View>
  );

  if (!data) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Text style={s.emptyTitle}>Couldn't load the members</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={reload}><Text style={s.secondaryText}>Try again</Text></TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const { league, members, votes, handicapEvents } = data;
  const active = members.filter((m) => !m.leftAt);
  const me = active.find((m) => m.userId === meId);
  const isAdmin = me?.role === 'admin';
  const archived = !!league.archivedAt;
  const needed = voteThreshold(active.length);
  const link = leagueJoinLink(shareOrigin(), league.inviteCode);
  const pot = potCents(members, league.entryFeeCents);
  const history = [...handicapEvents].reverse().slice(0, 8);

  function openSheet(member) {
    setTarget(member);
    setHcpText(member.leagueHandicap == null ? '' : String(member.leagueHandicap));
  }

  async function run(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setTarget(null);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const proposed = parseMemberHandicap(hcpText, league.handicapCap);

  async function vote(v, yes) {
    if (busy) return;
    setBusy(true);
    try {
      await castHandicapBallot(v.id, yes);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function shareLink() {
    try {
      await Share.share({ message: `Join "${league.name}" on Golf Partner:\n${link}` });
    } catch (e) {
      fail(e);
    }
  }

  function copyLink() {
    Clipboard.setString(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <PullToRefresh style={{ flex: 1 }} contentContainerStyle={s.content} refreshing={refreshing} onRefresh={refresh}>
        {votes.map((v) => {
          const subject = memberName(members, v.subjectUser, meId);
          const current = members.find((m) => m.userId === v.subjectUser)?.leagueHandicap;
          const myBallot = v.ballots.find((b) => b.voter === meId);
          const verb = current != null && v.proposed > current ? 'Raise' : 'Lower';
          return (
            <View key={v.id} style={s.voteCard}>
              <View style={s.voteHead}>
                <Text style={s.voteOverline}>OPEN VOTE</Text>
              </View>
              <Text style={s.voteTitle}>
                {current != null
                  ? `${verb} ${subject}'s handicap from ${current.toFixed(1)} to ${v.proposed.toFixed(1)}?`
                  : `Set ${subject}'s handicap to ${v.proposed.toFixed(1)}?`}
              </Text>
              <Text style={s.voteMeta}>
                {`Proposed by ${memberName(members, v.openedBy, meId)} · ${v.ballots.filter((b) => b.yes).length} yes of ${active.length} votes, needs ${needed} · closes ${shortDate(v.closesAt)}`}
              </Text>
              {myBallot ? (
                <Text style={s.voteMeta}>{`You voted ${myBallot.yes ? 'yes' : 'no'}.`}</Text>
              ) : (
                <View style={s.voteBtns}>
                  <TouchableOpacity style={[s.voteBtn, s.voteNo]} onPress={() => vote(v, false)} disabled={busy || archived} activeOpacity={0.8}>
                    <Text style={s.voteNoText}>No</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.voteBtn, s.voteYes]} onPress={() => vote(v, true)} disabled={busy || archived} activeOpacity={0.8}>
                    <Text style={s.voteYesText}>{`Yes, ${verb.toLowerCase()} it`}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        <Text style={s.sectionLabel}>
          {`${active.length} MEMBERS${league.entryFeeCents > 0 ? ` · POT ${formatEuros(pot).toUpperCase()}` : ''}`}
        </Text>
        <View style={s.card}>
          {active.map((m, i) => {
            const hcp = m.leagueHandicap == null ? 'No league handicap yet' : `League hcp ${m.leagueHandicap.toFixed(1)}`;
            const atCap = m.leagueHandicap != null && m.leagueHandicap >= league.handicapCap;
            return (
              <TouchableOpacity
                key={m.userId}
                style={[s.memberRow, i < active.length - 1 && s.rowDivider]}
                onPress={() => !archived && openSheet(m)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${memberLabel(m, meId)} handicap`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.memberName} numberOfLines={1}>
                    {m.userId === meId ? `You (${m.displayName ?? 'me'})` : memberLabel(m, meId)}
                  </Text>
                  <Text style={s.memberSub}>
                    {`${hcp}${atCap ? ' · at the cap' : ''}${m.role === 'admin' ? ' · admin' : ''}`}
                  </Text>
                </View>
                {m.role === 'admin' && <View style={s.badge}><Text style={s.badgeText}>Admin</Text></View>}
                {league.entryFeeCents > 0 && (
                  <Text style={[s.fee, m.feePaid ? { color: theme.accent.primary } : { color: theme.destructive }]}>
                    {m.feePaid ? 'Paid' : `${formatEuros(league.entryFeeCents)} due`}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {history.length > 0 && (
          <>
            <Text style={s.sectionLabel}>HANDICAP HISTORY</Text>
            <View style={s.card}>
              {history.map((ev, i) => (
                <View key={ev.id} style={[s.historyRow, i < history.length - 1 && s.rowDivider]}>
                  <Text style={s.historyText}>{handicapEventLine(ev, members, meId)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={s.sectionLabel}>INVITE</Text>
        <View style={s.card}>
          <Text style={s.link} selectable>{link}</Text>
          <View style={s.inviteBtns}>
            <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={copyLink} activeOpacity={0.8}>
              <Feather name={copied ? 'check' : 'link'} size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
              <Text style={s.secondaryText}>{copied ? 'Copied' : 'Copy link'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1 }]} onPress={shareLink} activeOpacity={0.8}>
              <Feather name="share-2" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
              <Text style={s.primaryText}>Share invite</Text>
            </TouchableOpacity>
          </View>
        </View>
      </PullToRefresh>

      <BottomSheet visible={!!target} onClose={() => setTarget(null)} sheetStyle={s.sheet}>
        <View style={s.handle} />
        <Text style={s.sheetTitle}>{target ? memberLabel(target, meId) : ''}</Text>
        <Text style={s.sheetSub}>{`League handicap, max ${league.handicapCap}`}</Text>
        <TextInput
          style={s.input}
          value={hcpText}
          onChangeText={setHcpText}
          keyboardType="decimal-pad"
          placeholder="e.g. 18.0"
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          accessibilityLabel="New league handicap"
        />
        {isAdmin && (
          <TouchableOpacity
            style={[s.primaryBtn, (proposed == null || busy) && { opacity: 0.5 }]}
            disabled={proposed == null || busy}
            onPress={() => run(() => setLeagueHandicap(leagueId, target.userId, proposed))}
            activeOpacity={0.8}
          >
            <Text style={s.primaryText}>Set handicap</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.secondaryBtn, { marginTop: 10 }, (proposed == null || busy) && { opacity: 0.5 }]}
          disabled={proposed == null || busy}
          onPress={() => run(() => openHandicapVote(leagueId, target.userId, proposed))}
          activeOpacity={0.8}
        >
          <Text style={s.secondaryText}>{`Open a vote (needs ${needed} of ${active.length})`}</Text>
        </TouchableOpacity>
      </BottomSheet>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 4 },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3 },
    content: { padding: 16, paddingBottom: 40 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },

    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10, letterSpacing: 1.5,
      marginBottom: 10, marginTop: 8,
    },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      paddingHorizontal: 16, marginBottom: 14, ...(theme.isDark ? {} : theme.shadow.card),
    },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
    memberName: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    memberSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
    fee: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
    badge: { backgroundColor: theme.accent.light, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 10 },
    historyRow: { paddingVertical: 10 },
    historyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17 },

    voteCard: {
      backgroundColor: theme.accent.light, borderRadius: 16, borderWidth: 1, borderColor: theme.accent.primary + '40',
      padding: 16, marginBottom: 14,
    },
    voteHead: { flexDirection: 'row', marginBottom: 6 },
    voteOverline: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 10, letterSpacing: 1.6 },
    voteTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 18, lineHeight: 24 },
    voteMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
    voteBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
    voteBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 12 },
    voteNo: { borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.bg.card },
    voteNoText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
    voteYes: { backgroundColor: theme.accent.primary },
    voteYesText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },

    link: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, paddingVertical: 14 },
    inviteBtns: { flexDirection: 'row', gap: 10, paddingBottom: 14 },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 14,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 14, paddingHorizontal: 16,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 14 },

    sheet: {
      backgroundColor: theme.bg.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22,
      paddingBottom: 28, borderWidth: 1, borderColor: cardBorder,
    },
    handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border.default, alignSelf: 'center', marginBottom: 18 },
    sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, textAlign: 'center' },
    sheetSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 14 },
    input: {
      backgroundColor: theme.bg.secondary, color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, padding: 14, marginBottom: 12, fontSize: 16, fontFamily: 'PlusJakartaSans-Bold',
      textAlign: 'center',
    },
  });
}
