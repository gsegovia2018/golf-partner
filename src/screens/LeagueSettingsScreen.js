import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Switch, Alert, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PullToRefresh from '../components/PullToRefresh';
import DateField from '../components/DateField';
import DeleteLeagueSheet from '../components/DeleteLeagueSheet';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';
import {
  updateLeagueRules, setLeagueFeePaid, setLeagueRole, archiveLeague, leaveLeague, deleteLeague,
} from '../store/leagueStore';
import {
  parseIsoDate, parsePointsTable, formatPointsTable, parseFeeCents,
} from '../store/leagueDraft';
import {
  formatEuros, memberLabel, voteThreshold, monthName,
} from '../store/leagueView';
import {
  getPendingLeagueFinals, subscribePendingLeagueFinals, flushPendingLeagueFinals,
} from '../lib/leagueFinalPending';
import {
  LEAGUE_NOTIFICATION_ROWS, resolveLeaguePrefs, leaguePrefsPatch,
} from '../store/leagueNotificationPrefs';

// Alert.alert does nothing on web (react-native-web), so both helpers fall
// back to the browser's own dialogs there.
function fail(e) {
  const message = e?.message || 'Something went wrong';
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert('Error', message);
}

function confirmDestructive(title, message, actionLabel) {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: actionLabel, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

// Links to Members and the Final, rules (admin edits), fees and roles (admin),
// notification switches and leave / archive / delete. Everyone sees the rules; only an admin can change them.
export default function LeagueSettingsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(theme);
  const meId = user?.id ?? null;
  const leagueId = route?.params?.leagueId;
  const { data, loading, refreshing, error, reload, refresh } = useLeague(navigation, leagueId);
  const appSettings = useAppSettings();

  const [name, setName] = useState('');
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [pointsText, setPointsText] = useState('');
  const [capText, setCapText] = useState('');
  const [feeText, setFeeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const seededRef = useRef(false);

  // Seed the form once, from the first snapshot (cache or live). Later
  // refreshes must not overwrite what the admin is typing.
  useEffect(() => {
    if (!data || seededRef.current) return;
    seededRef.current = true;
    const l = data.league;
    setName(l.name);
    setSeasonStart(String(l.seasonStart).slice(0, 10));
    setSeasonEnd(String(l.seasonEnd).slice(0, 10));
    setPointsText(formatPointsTable(l.pointsTable));
    setCapText(String(l.handicapCap));
    setFeeText(l.entryFeeCents ? String(l.entryFeeCents / 100) : '');
  }, [data]);

  // A Final started on this device whose link to the league is still being
  // retried (see lib/leagueFinalPending). Flush on focus; reload once it lands.
  const [pendingFinal, setPendingFinal] = useState(null);
  useEffect(() => {
    let alive = true;
    let had = false;
    const apply = (list) => {
      if (!alive) return;
      const mine = list.find((x) => x.leagueId === leagueId) ?? null;
      setPendingFinal(mine);
      if (had && !mine) reload(); // the link landed: pick up the server's Final
      had = !!mine;
    };
    const unsub = subscribePendingLeagueFinals(apply);
    const onFocus = async () => {
      apply(await getPendingLeagueFinals());
      await flushPendingLeagueFinals();
    };
    onFocus();
    const off = navigation?.addListener?.('focus', onFocus);
    return () => { alive = false; unsub(); if (typeof off === 'function') off(); };
  }, [navigation, leagueId, reload]);

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
      <Text style={s.headerTitle}>League settings</Text>
    </View>
  );

  if (!data) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Text style={s.emptyTitle}>Couldn't load the league</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={reload}><Text style={s.secondaryText}>Try again</Text></TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const { league, members } = data;
  const active = members.filter((m) => !m.leftAt);
  const me = active.find((m) => m.userId === meId);
  const isAdmin = me?.role === 'admin';
  const archived = !!league.archivedAt;
  const prefs = resolveLeaguePrefs(appSettings);

  const startIso = parseIsoDate(seasonStart);
  const endIso = parseIsoDate(seasonEnd);
  const pointsTable = parsePointsTable(pointsText);
  const cap = Number(capText.replace(',', '.'));
  const feeCents = parseFeeCents(feeText);
  const formValid = name.trim().length > 0 && !!startIso && !!endIso && startIso <= endIso
    && !!pointsTable && Number.isFinite(cap) && cap >= 0 && cap <= 54 && feeCents != null;

  async function act(action) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRules() {
    const ok = await act(async () => {
      await updateLeagueRules(leagueId, {
        name: name.trim(), seasonStart: startIso, seasonEnd: endIso, pointsTable, cap, feeCents,
      });
      await reload();
    });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  function toggleFee(member, paid) {
    return act(async () => { await setLeagueFeePaid(leagueId, member.userId, paid); await reload(); });
  }

  function toggleAdmin(member, makeAdmin) {
    return act(async () => { await setLeagueRole(leagueId, member.userId, makeAdmin ? 'admin' : 'member'); await reload(); });
  }

  async function confirmArchive() {
    const yes = await confirmDestructive(
      'Archive the league?',
      'The board stays visible but becomes read-only for everyone. Announcing cards, joining and handicap changes stop.',
      'Archive',
    );
    if (yes) await act(async () => { await archiveLeague(leagueId); await reload(); });
  }

  async function confirmLeave() {
    const yes = await confirmDestructive(
      'Leave this league?',
      'Your past cards stay in the standings, marked as left. You can rejoin with the invite link.',
      'Leave',
    );
    if (!yes) return;
    const ok = await act(async () => { await leaveLeague(leagueId); });
    if (ok) navigation.navigate('Main');
  }

  function openDelete() {
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function runDelete() {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteLeague(leagueId);
      setDeleteOpen(false);
      navigation.navigate('Main');
    } catch (e) {
      setDeleteError(e?.message || 'Something went wrong.');
    } finally {
      setDeleteBusy(false);
    }
  }

  function archiveInstead() {
    setDeleteOpen(false);
    confirmArchive();
  }

  const field = (label, props) => (
    <>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        accessibilityLabel={label}
        placeholderTextColor={theme.text.muted}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        selectionColor={theme.accent.primary}
        {...props}
      />
    </>
  );

  // The December Final: the admin sets it up once; afterwards it is a link to
  // the tournament for everyone.
  const finalId = data.final?.tournamentId ?? pendingFinal?.tournamentId ?? null;
  const finalDate = data.final?.createdAt
    ? new Date(data.final.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null;
  let finalRow = null;
  if (finalId) {
    finalRow = {
      title: ['The Final', finalDate].filter(Boolean).join(' · '),
      sub: data.final ? 'Open' : 'Linking the Final to the league…',
      onPress: () => navigation.navigate('Tournament', { tournamentId: finalId, viewMode: 'tournament' }),
    };
  } else if (isAdmin && !archived) {
    finalRow = {
      title: 'Set up the Final',
      sub: `${monthName(league.seasonEnd)} · extra strokes from the standings`,
      onPress: () => navigation.navigate('LeagueFinal', { leagueId }),
    };
  }
  const openVotes = (data.votes ?? []).length;
  const membersSub = isAdmin
    ? `${active.length} members · cap ${league.handicapCap}`
    : (me?.leagueHandicap != null ? `Your league handicap ${Number(me.leagueHandicap).toFixed(1)}` : 'Handicaps and votes');
  const linkRows = [
    {
      key: 'members', icon: 'users', title: 'Members and handicaps', sub: membersSub, pill: openVotes > 0 ? `${openVotes} ${openVotes === 1 ? 'vote' : 'votes'} open` : null,
      onPress: () => navigation.navigate('LeagueMembers', { leagueId }),
    },
    finalRow && { key: 'final', icon: 'flag', ...finalRow },
  ].filter(Boolean);

  const readRow = (label, value, last) => (
    <View style={[s.readRow, !last && s.rowDivider]}>
      <Text style={s.readLabel}>{label}</Text>
      <Text style={s.readValue}>{value}</Text>
    </View>
  );

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <PullToRefresh style={{ flex: 1 }} contentContainerStyle={s.content} refreshing={refreshing} onRefresh={refresh}>
        <Text style={s.sectionLabel}>LEAGUE</Text>
        <View style={[s.card, { paddingVertical: 4 }]}>
          {linkRows.map((r, i) => (
            <TouchableOpacity
              key={r.key}
              style={[s.linkRow, i < linkRows.length - 1 && s.rowDivider]}
              onPress={r.onPress}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Feather name={r.icon} size={16} color={theme.text.primary} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.readLabel}>{r.title}</Text>
                <Text style={s.readValue}>{r.sub}</Text>
              </View>
              {!!r.pill && <View style={s.pill}><Text style={s.pillText}>{r.pill}</Text></View>}
              <Feather name="chevron-right" size={18} color={theme.text.muted} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.sectionLabel}>RULES</Text>
        {isAdmin && !archived ? (
          <View style={s.card}>
            {field('League name', { value: name, onChangeText: setName })}
            <Text style={s.fieldLabel}>Season starts</Text>
            <DateField label="Season starts" value={seasonStart} onChange={setSeasonStart} quickDates={false} />
            <Text style={s.fieldLabel}>Season ends</Text>
            <DateField label="Season ends" value={seasonEnd} onChange={setSeasonEnd} quickDates={false} min={startIso || undefined} />
            {startIso && endIso && startIso > endIso && (
              <Text style={s.errorText}>The season must end on or after it starts.</Text>
            )}
            {field('Points table (1st, 2nd, 3rd…)', { value: pointsText, onChangeText: setPointsText, autoCapitalize: 'none' })}
            {field('Handicap cap', { value: capText, onChangeText: setCapText, keyboardType: 'decimal-pad' })}
            {field('Entry fee (€)', { value: feeText, onChangeText: setFeeText, keyboardType: 'decimal-pad', placeholder: '0' })}
            <Text style={s.hint}>One card a month and net differential are fixed for every league.</Text>
            <TouchableOpacity
              style={[s.primaryBtn, (!formValid || busy) && { opacity: 0.5 }]}
              onPress={saveRules}
              disabled={!formValid || busy}
              activeOpacity={0.8}
            >
              <Text style={s.primaryText}>{saved ? 'Saved' : 'Save rules'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[s.card, { paddingVertical: 4 }]}>
            {readRow('Format', 'One card a month · net differential')}
            {readRow('Points table', `${formatPointsTable(league.pointsTable)} · ties share`)}
            {readRow('Handicaps', `Max ${league.handicapCap} · changes need ${voteThreshold(active.length)} of ${active.length} votes`)}
            {readRow('Entry fee', league.entryFeeCents > 0 ? formatEuros(league.entryFeeCents) : 'None', true)}
          </View>
        )}

        {isAdmin && !archived && (
          <>
            <Text style={s.sectionLabel}>MEMBERS</Text>
            <View style={s.card}>
              <View style={[s.adminHead, s.rowDivider]}>
                <Text style={[s.colHead, { flex: 1 }]}>Member</Text>
                {league.entryFeeCents > 0 && <Text style={s.colHead}>Paid</Text>}
                <Text style={s.colHead}>Admin</Text>
              </View>
              {active.map((m, i) => (
                <View key={m.userId} style={[s.adminRow, i < active.length - 1 && s.rowDivider]}>
                  <Text style={s.memberName} numberOfLines={1}>{memberLabel(m, meId)}</Text>
                  {league.entryFeeCents > 0 && (
                    <Switch
                      value={m.feePaid}
                      onValueChange={(v) => toggleFee(m, v)}
                      disabled={busy}
                      accessibilityLabel={`${memberLabel(m, meId)} paid`}
                      trackColor={{ true: theme.accent.primary }}
                    />
                  )}
                  <Switch
                    value={m.role === 'admin'}
                    onValueChange={(v) => toggleAdmin(m, v)}
                    disabled={busy}
                    accessibilityLabel={`${memberLabel(m, meId)} admin`}
                    trackColor={{ true: theme.accent.primary }}
                  />
                </View>
              ))}
            </View>
          </>
        )}

        {/* Notification preferences. The switches save to profiles.settings
            (notifications.league) through settingsStore; send-push reads the push
            column. send-email (P10) does not read the email column yet. */}
        <Text style={s.sectionLabel}>NOTIFICATIONS</Text>
        <View style={s.card}>
          <View style={[s.adminHead, s.rowDivider]}>
            <Text style={[s.colHead, { flex: 1 }]} />
            <Text style={s.colHead}>Push</Text>
            <Text style={s.colHead}>Email</Text>
          </View>
          {LEAGUE_NOTIFICATION_ROWS.map((row, i) => (
            <View key={row.type} style={[s.adminRow, i < LEAGUE_NOTIFICATION_ROWS.length - 1 && s.rowDivider]}>
              <Text style={s.memberName}>{row.label}</Text>
              {['push', 'email'].map((channel) => (
                <Switch
                  key={channel}
                  value={prefs[channel][row.type]}
                  onValueChange={(v) => updateAppSettings(leaguePrefsPatch(appSettings, channel, row.type, v))}
                  accessibilityLabel={`${row.label} (${channel})`}
                  trackColor={{ true: theme.accent.primary }}
                />
              ))}
            </View>
          ))}
        </View>
        <Text style={s.hint}>Email delivery for leagues is coming. Your email choices are saved now.</Text>

        <Text style={s.sectionLabel}>SEASON</Text>
        {isAdmin && !archived && (
          <TouchableOpacity style={s.dangerRow} onPress={confirmArchive} disabled={busy} activeOpacity={0.7}>
            <Text style={s.dangerTitle}>Archive the league</Text>
            <Text style={s.dangerSub}>Keeps the board read-only for everyone</Text>
          </TouchableOpacity>
        )}
        {isAdmin && (
          <TouchableOpacity style={s.dangerRow} onPress={openDelete} disabled={busy} activeOpacity={0.7} accessibilityRole="button">
            <Text style={s.dangerTitle}>Delete the league</Text>
            <Text style={s.dangerSub}>{"Removes it for everyone. Can't be undone"}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.dangerRow} onPress={confirmLeave} disabled={busy} activeOpacity={0.7}>
          <Text style={s.dangerTitle}>Leave league</Text>
          <Text style={s.dangerSub}>Your past cards stay in the standings</Text>
        </TouchableOpacity>
      </PullToRefresh>
      {isAdmin && (
        <DeleteLeagueSheet
          visible={deleteOpen}
          leagueName={league.name}
          memberCount={active.length}
          cardCount={data.cards.filter((c) => c.status !== 'void').length}
          hasFinal={!!data.final}
          canArchive={!archived}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={runDelete}
          onArchiveInstead={archiveInstead}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
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
      marginBottom: 10, marginTop: 12,
    },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      paddingHorizontal: 16, paddingVertical: 12, marginBottom: 10, ...(theme.isDark ? {} : theme.shadow.card),
    },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    fieldLabel: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12, marginBottom: 6, marginTop: 8 },
    input: {
      backgroundColor: theme.bg.secondary, color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, padding: 12, marginBottom: 4, fontSize: 15, fontFamily: 'PlusJakartaSans-Medium',
    },
    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 13, lineHeight: 18, marginBottom: 8 },
    hint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, lineHeight: 17, marginVertical: 8 },

    linkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 12 },
    pill: { backgroundColor: theme.accent.light, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6 },
    pillText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11 },
    readRow: { paddingVertical: 12 },
    readLabel: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    readValue: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },

    adminHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, gap: 12 },
    colHead: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10, letterSpacing: 1,
      textTransform: 'uppercase', width: 52, textAlign: 'center',
    },
    adminRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
    memberName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },

    primaryBtn: {
      alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary,
      borderRadius: 14, paddingVertical: 14, marginTop: 8,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 28,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },

    dangerRow: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 10,
    },
    dangerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 14 },
    dangerSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
  });
}
