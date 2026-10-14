import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import ScreenHeader from '../components/ui/ScreenHeader';
import PullToRefresh from '../components/PullToRefresh';
import DateField from '../components/DateField';
import DeleteLeagueSheet from '../components/DeleteLeagueSheet';
import BottomSheet from '../components/BottomSheet';
import PointsForPlaying from '../components/league/PointsForPlaying';
import { useT, formatNumber, formatDate } from '../i18n';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import { dropLeagueRow } from '../hooks/useMyLeagueRows';
import { useAppSettings } from '../hooks/useAppSettings';
import { updateAppSettings } from '../store/settingsStore';
import {
  updateLeagueRules, setLeagueFeePaid, setLeagueRole, archiveLeague, leaveLeague, deleteLeague,
  getLeagueShareLink, setLeaguePublicBoard, rotateLeaguePublicBoard,
} from '../store/leagueStore';
import { publicBoardUrl } from '../store/leagueShare';
import { shareOrigin } from '../lib/shareOrigin';
import {
  parseIsoDate, parsePointsTable, formatPointsTable, parseFeeCents,
} from '../store/leagueDraft';
import {
  formatEuros, voteThreshold,
} from '../store/leagueView';
import { memberLabel } from '../lib/leagueNames';
import {
  getPendingLeagueFinals, subscribePendingLeagueFinals, flushPendingLeagueFinals,
} from '../lib/leagueFinalPending';
import { LEAGUE_FINAL_ENABLED } from '../store/leagueFinal';
import {
  LEAGUE_NOTIFICATION_ROWS, resolveLeaguePrefs, leaguePrefsPatch,
} from '../store/leagueNotificationPrefs';
import { leagueErrorText } from '../lib/leagueErrorText';
import { useConfirmSheet } from '../components/league/ConfirmSheet';

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
  const t = useT();
  const { ask, sheet: confirmSheet } = useConfirmSheet();
  const fail = (e) => ask({ title: t('league.create.errorTitle'), message: leagueErrorText(e) || t('league.create.errorGeneric') });
  const confirmDestructive = (title, message, confirmLabel) => ask({ title, message, confirmLabel, destructive: true });

  const [name, setName] = useState('');
  const [seasonStart, setSeasonStart] = useState('');
  const [seasonEnd, setSeasonEnd] = useState('');
  const [pointsText, setPointsText] = useState('');
  const [capText, setCapText] = useState('');
  const [feeText, setFeeText] = useState('');
  const [participation, setParticipation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const seededRef = useRef(false);
  // The admin's "Sharing" section: { enabled, token } once loaded; busy while a
  // switch or a new link is in flight; notice/error under the rows.
  const [board, setBoard] = useState(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardNote, setBoardNote] = useState(null);
  const [rotateOpen, setRotateOpen] = useState(false);

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
    setParticipation(l.participationPoints ?? 0);
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

  // The public board link, for admins: the token (created on first ask) while
  // it is on. Loaded once the snapshot says I'm an admin.
  const amAdmin = !!data?.members?.some((m) => m.userId === meId && !m.leftAt && m.role === 'admin');
  useEffect(() => {
    if (!amAdmin || board) return undefined;
    let alive = true;
    getLeagueShareLink(leagueId)
      .then((token) => { if (alive) setBoard({ enabled: !!token, token }); })
      // Retry (or pull to refresh) clears it and loads again.
      .catch(() => { if (alive) setBoard({ failed: true }); });
    return () => { alive = false; };
  }, [amAdmin, board, leagueId]);

  function onRefresh() {
    if (board?.failed) setBoard(null);
    return refresh();
  }

  async function boardAction(run, doneKey = null) {
    if (boardBusy) return;
    setBoardBusy(true);
    setBoardNote(null);
    try {
      const next = await run();
      setBoard(next);
      if (doneKey) setBoardNote({ key: doneKey });
    } catch {
      setBoardNote({ key: 'league.share.settings.failed', error: true });
    } finally {
      setBoardBusy(false);
    }
  }

  const header = (
    <ScreenHeader onBack={() => navigation.goBack()} title={t('league.settings.title')} />
  );

  if (!data) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Text style={s.emptyTitle}>{t('league.join.couldntLoad')}</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={reload}><Text style={s.secondaryText}>{t('common.retry')}</Text></TouchableOpacity>
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
        participationPoints: participation,
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
      t('league.settings.archiveTitle'),
      t('league.settings.archiveBody'),
      t('league.settings.archiveAction'),
    );
    if (yes) await act(async () => { await archiveLeague(leagueId); await reload(); });
  }

  async function confirmLeave() {
    const yes = await confirmDestructive(
      t('league.settings.leaveTitle'),
      t('league.settings.leaveBody'),
      t('league.settings.leaveAction'),
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
      dropLeagueRow(leagueId);
      setDeleteOpen(false);
      navigation.navigate('Main');
    } catch (e) {
      setDeleteError(leagueErrorText(e) || t('league.settings.errorGenericDot'));
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
    ? formatDate(data.final.createdAt, 'day')
    : null;
  let finalRow = null;
  if (finalId) {
    finalRow = {
      title: [t('league.settings.theFinal'), finalDate].filter(Boolean).join(' · '),
      sub: data.final ? t('league.settings.finalOpen') : t('league.settings.finalLinking'),
      onPress: () => navigation.navigate('Tournament', { tournamentId: finalId, viewMode: 'tournament' }),
    };
  } else if (isAdmin && !archived && LEAGUE_FINAL_ENABLED) {
    finalRow = {
      title: t('league.settings.setUpFinal'),
      sub: t('league.settings.setUpFinalSub', { month: formatDate(`${String(league.seasonEnd).slice(0, 7)}-01`, 'monthName') }),
      onPress: () => navigation.navigate('LeagueFinal', { leagueId }),
    };
  }
  const openVotes = (data.votes ?? []).length;
  const membersSub = isAdmin
    ? t('league.settings.membersSubAdmin', { count: active.length, cap: formatNumber(league.handicapCap) })
    : (me?.leagueHandicap != null ? t('league.settings.yourHcp', { hcp: formatNumber(Number(me.leagueHandicap), { decimals: 1 }) }) : t('league.settings.hcpAndVotes'));
  const linkRows = [
    {
      key: 'members', icon: 'users', title: t('league.settings.membersAndHcp'), sub: membersSub, pill: openVotes > 0 ? t('league.settings.votesOpen', { count: openVotes }) : null,
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
      <PullToRefresh style={{ flex: 1 }} contentContainerStyle={s.content} refreshing={refreshing} onRefresh={onRefresh}>
        <Text style={s.sectionLabel}>{t('league.settings.sectionLeague')}</Text>
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

        <Text style={s.sectionLabel}>{t('league.settings.sectionRules')}</Text>
        {isAdmin && !archived ? (
          <View style={s.card}>
            {field(t('league.create.leagueName'), { value: name, onChangeText: setName })}
            <Text style={s.fieldLabel}>{t('league.create.seasonStarts')}</Text>
            <DateField label={t('league.create.seasonStarts')} value={seasonStart} onChange={setSeasonStart} quickDates={false} />
            <Text style={s.fieldLabel}>{t('league.create.seasonEnds')}</Text>
            <DateField label={t('league.create.seasonEnds')} value={seasonEnd} onChange={setSeasonEnd} quickDates={false} min={startIso || undefined} />
            {startIso && endIso && startIso > endIso && (
              <Text style={s.errorText}>{t('league.settings.seasonOrder')}</Text>
            )}
            {field(t('league.create.pointsTable'), { value: pointsText, onChangeText: setPointsText, autoCapitalize: 'none' })}
            <PointsForPlaying value={participation} onChange={setParticipation} pointsTable={pointsTable} count={active.length} />
            <Text style={s.hint}>{t('league.rules.recompute')}</Text>
            {field(t('league.create.handicapCap'), { value: capText, onChangeText: setCapText, keyboardType: 'decimal-pad' })}
            {field(t('league.create.entryFee'), { value: feeText, onChangeText: setFeeText, keyboardType: 'decimal-pad', placeholder: '0' })}
            <Text style={s.hint}>{t('league.settings.fixedRules')}</Text>
            <TouchableOpacity
              style={[s.primaryBtn, (!formValid || busy) && { opacity: 0.5 }]}
              onPress={saveRules}
              disabled={!formValid || busy}
              activeOpacity={0.8}
            >
              <Text style={s.primaryText}>{saved ? t('league.settings.saved') : t('league.settings.saveRules')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[s.card, { paddingVertical: 4 }]}>
            {readRow(t('league.settings.readFormat'), t('league.rules.format'))}
            {readRow(t('league.settings.readPoints'), t('league.settings.readTies', { table: formatPointsTable(league.pointsTable) }))}
            {readRow(t('league.rules.playing'), league.participationPoints > 0
              ? t('league.rules.playingMember', { points: formatNumber(league.participationPoints) })
              : t('league.rules.playingNone'))}
            {readRow(t('league.settings.readHandicaps'), t('league.settings.readHandicapsValue', {
              cap: formatNumber(league.handicapCap), need: voteThreshold(active.length), total: active.length,
            }))}
            {readRow(t('league.settings.readFee'), league.entryFeeCents > 0 ? formatEuros(league.entryFeeCents) : t('league.settings.readFeeNone'), true)}
          </View>
        )}

        {isAdmin && !archived && (
          <>
            <Text style={s.sectionLabel}>{t('league.settings.sectionMembers')}</Text>
            <View style={s.card}>
              <View style={[s.adminHead, s.rowDivider]}>
                <Text style={[s.colHead, { flex: 1 }]}>{t('league.settings.colMember')}</Text>
                {league.entryFeeCents > 0 && <Text style={s.colHead}>{t('league.settings.colPaid')}</Text>}
                <Text style={s.colHead}>{t('league.settings.colAdmin')}</Text>
              </View>
              {active.map((m, i) => (
                <View key={m.userId} style={[s.adminRow, i < active.length - 1 && s.rowDivider]}>
                  <Text style={s.memberName} numberOfLines={1}>{memberLabel(m, meId)}</Text>
                  {league.entryFeeCents > 0 && (
                    <Switch
                      value={m.feePaid}
                      onValueChange={(v) => toggleFee(m, v)}
                      disabled={busy}
                      accessibilityLabel={t('league.settings.paidA11y', { name: memberLabel(m, meId) })}
                      trackColor={{ true: theme.accent.primary }}
                    />
                  )}
                  <Switch
                    value={m.role === 'admin'}
                    onValueChange={(v) => toggleAdmin(m, v)}
                    disabled={busy}
                    accessibilityLabel={t('league.settings.adminA11y', { name: memberLabel(m, meId) })}
                    trackColor={{ true: theme.accent.primary }}
                  />
                </View>
              ))}
            </View>
          </>
        )}

        {isAdmin && (
          <>
            <Text style={s.sectionLabel}>{t('league.share.settings.section')}</Text>
            <View style={s.card}>
              <View style={[s.adminRow, board?.enabled && s.rowDivider]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.readLabel}>{t('league.share.settings.switch')}</Text>
                  <Text style={board?.failed ? s.errorText : s.readValue}>
                    {t(board?.failed ? 'league.share.settings.loadFailed'
                      : board?.enabled === false ? 'league.share.settings.off' : 'league.share.settings.on')}
                  </Text>
                </View>
                {board?.failed ? (
                  <TouchableOpacity style={s.retryBtn} onPress={() => setBoard(null)} accessibilityRole="button">
                    <Text style={s.secondaryText}>{t('common.retry')}</Text>
                  </TouchableOpacity>
                ) : board ? (
                  <Switch
                    value={!!board.enabled}
                    onValueChange={(v) => boardAction(() => setLeaguePublicBoard(leagueId, v))}
                    disabled={boardBusy}
                    accessibilityLabel={t('league.share.settings.switch')}
                    trackColor={{ true: theme.accent.primary }}
                  />
                ) : <ActivityIndicator color={theme.accent.primary} />}
              </View>
              {!!board?.enabled && !!board.token && (
                <>
                  <View style={[s.readRow, s.rowDivider]}>
                    <Text selectable style={s.linkValue}>
                      {publicBoardUrl(shareOrigin(), board.token)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.linkRow}
                    onPress={() => setRotateOpen(true)}
                    disabled={boardBusy}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <Feather name="refresh-cw" size={16} color={theme.text.primary} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.readLabel}>{t('league.share.settings.rotate')}</Text>
                      <Text style={s.readValue}>{t('league.share.settings.rotateSub')}</Text>
                    </View>
                    {boardBusy && <ActivityIndicator color={theme.accent.primary} />}
                  </TouchableOpacity>
                </>
              )}
            </View>
            {!!boardNote && (
              <Text style={boardNote.error ? s.errorText : s.hint} accessibilityRole="alert">{t(boardNote.key)}</Text>
            )}
          </>
        )}
        {isAdmin && (
          <BottomSheet visible={rotateOpen} onClose={() => setRotateOpen(false)} sheetStyle={s.sheet}>
            <Text style={s.sheetTitle} accessibilityRole="header">{t('league.share.settings.rotateTitle')}</Text>
            <Text style={s.sheetText}>{t('league.share.settings.rotateBody')}</Text>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => {
                setRotateOpen(false);
                boardAction(() => rotateLeaguePublicBoard(leagueId), 'league.share.settings.rotated');
              }}
              accessibilityRole="button"
            >
              <Text style={s.primaryText}>{t('league.share.settings.rotateConfirm')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.secondaryBtn, { marginTop: 10 }]} onPress={() => setRotateOpen(false)} accessibilityRole="button">
              <Text style={s.secondaryText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </BottomSheet>
        )}

        {/* Notification preferences. The switches save to profiles.settings
            (notifications.league) through settingsStore; send-push reads the push
            column. send-email (P10) does not read the email column yet. */}
        <Text style={s.sectionLabel}>{t('league.notifPrefs.section')}</Text>
        <View style={s.card}>
          <View style={[s.adminHead, s.rowDivider]}>
            <Text style={[s.colHead, { flex: 1 }]} />
            <Text style={s.colHead}>{t('league.notifPrefs.push')}</Text>
            <Text style={s.colHead}>{t('league.notifPrefs.email')}</Text>
          </View>
          {LEAGUE_NOTIFICATION_ROWS.map((row, i) => (
            <View key={row.type} style={[s.adminRow, i < LEAGUE_NOTIFICATION_ROWS.length - 1 && s.rowDivider]}>
              <Text style={s.memberName}>{t(row.labelKey)}</Text>
              {['push', 'email'].map((channel) => (
                <Switch
                  key={channel}
                  value={prefs[channel][row.type]}
                  onValueChange={(v) => updateAppSettings(leaguePrefsPatch(appSettings, channel, row.type, v))}
                  accessibilityLabel={t('league.notifPrefs.a11y', { label: t(row.labelKey), channel: t(channel === 'push' ? 'league.notifPrefs.chPush' : 'league.notifPrefs.chEmail') })}
                  trackColor={{ true: theme.accent.primary }}
                />
              ))}
            </View>
          ))}
        </View>
        <Text style={s.hint}>{t('league.notifPrefs.hint')}</Text>

        <Text style={s.sectionLabel}>{t('league.settings.sectionSeason')}</Text>
        {isAdmin && !archived && (
          <TouchableOpacity style={s.dangerRow} onPress={confirmArchive} disabled={busy} activeOpacity={0.7}>
            <Text style={s.dangerTitle}>{t('league.settings.archiveRow')}</Text>
            <Text style={s.dangerSub}>{t('league.settings.archiveRowSub')}</Text>
          </TouchableOpacity>
        )}
        {isAdmin && (
          <TouchableOpacity style={s.dangerRow} onPress={openDelete} disabled={busy} activeOpacity={0.7} accessibilityRole="button">
            <Text style={s.dangerTitle}>{t('league.settings.deleteRow')}</Text>
            <Text style={s.dangerSub}>{t('league.settings.deleteRowSub')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.dangerRow} onPress={confirmLeave} disabled={busy} activeOpacity={0.7}>
          <Text style={s.dangerTitle}>{t('league.settings.leaveRow')}</Text>
          <Text style={s.dangerSub}>{t('league.settings.leaveRowSub')}</Text>
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
      {confirmSheet}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 16, paddingBottom: 40 },
    emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18, lineHeight: 24, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },

    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 10, letterSpacing: 1.5,
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
    hint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginVertical: 8 },

    linkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 12 },
    pill: { backgroundColor: theme.accent.light, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6 },
    pillText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11 },
    readRow: { paddingVertical: 12 },
    readLabel: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    readValue: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
    linkValue: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 13 },
    retryBtn: {
      minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.border.default,
      paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
    },
    sheet: { padding: 20 },
    sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary, marginBottom: 8 },
    sheetText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, lineHeight: 20, color: theme.text.secondary, marginBottom: 16 },

    adminHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, gap: 12 },
    colHead: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 10, letterSpacing: 1,
      textTransform: 'uppercase', width: 52, textAlign: 'center',
    },
    adminRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
    memberName: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },

    primaryBtn: { ...btn.primaryBtn, marginTop: 8 },
    primaryText: btn.primaryText,
    secondaryBtn: { ...btn.secondaryBtn, paddingHorizontal: 28 },
    secondaryText: btn.secondaryText,

    dangerRow: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 10,
    },
    dangerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 14 },
    dangerSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },
  });
}
