import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Share, Clipboard,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import ScreenHeader from '../components/ui/ScreenHeader';
import SheetHandle from '../components/ui/SheetHandle';
import PullToRefresh from '../components/PullToRefresh';
import BottomSheet from '../components/BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../hooks/useLeague';
import {
  castHandicapBallot, openHandicapVote, setLeagueHandicap, removeLeagueInvitee,
  removeLeagueMember, rotateLeagueInviteCode, releaseLeagueInvitee, getLeagueMemberEvents,
} from '../store/leagueStore';
import {
  activeSpotClaims, pendingSpotClaims, claimForUser, pastCardCount, memberAdminErrorKey,
  loadSeenClaims, markClaimsSeen, membershipHistory,
} from '../store/leagueMembersAdmin';
import { parseMemberHandicap, leagueJoinLink } from '../store/leagueDraft';
import {
  formatEuros, potCents, voteThreshold,
} from '../store/leagueView';
import { memberLabel, memberName, handicapEventLine } from '../lib/leagueNames';
import { shareOrigin } from '../lib/shareOrigin';
import InitialsAvatar from '../components/league/InitialsAvatar';
import MemberAdminSheet from '../components/league/MemberAdminSheet';
import { useT, formatDate, formatTime, formatNumber } from '../i18n';
import { leagueErrorText } from '../lib/leagueErrorText';
import { useConfirmSheet } from '../components/league/ConfirmSheet';

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
  // Admin actions: which confirm sheet is open, its busy/error, and the last result.
  const [confirm, setConfirm] = useState(null); // { kind: 'remove', member } | { kind: 'release', claim } | { kind: 'code' }
  const [alsoCode, setAlsoCode] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [events, setEvents] = useState([]);
  const [seen, setSeen] = useState([]);
  const [rotated, setRotated] = useState(null); // the code just made, until the snapshot catches up
  const t = useT();
  const { ask, sheet: confirmSheet } = useConfirmSheet();
  const fail = (e) => ask({ title: t('common.error'), message: leagueErrorText(e) || t('league.membersMisc.wrong') });
  const lastConfirm = useRef(null);

  const viewerIsAdmin = !!data?.members?.some((m) => m.userId === meId && m.role === 'admin' && !m.leftAt);
  useEffect(() => {
    if (!viewerIsAdmin) return undefined;
    let live = true;
    (async () => {
      try {
        const [log, dismissed] = await Promise.all([getLeagueMemberEvents(leagueId), loadSeenClaims(leagueId)]);
        if (live) { setEvents(log); setSeen(dismissed); }
      } catch {
        // The log is an extra: without it the screen is just the members.
      }
    })();
    return () => { live = false; };
  }, [viewerIsAdmin, leagueId, data]);
  useEffect(() => { setRotated(null); }, [data?.league?.inviteCode]);

  const header = (
    <ScreenHeader onBack={() => navigation.goBack()} title={t('league.membersMisc.title')} />
  );

  if (!data) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Text style={s.emptyTitle}>{t('league.membersMisc.loadError')}</Text>
              <Text style={s.emptyText}>{error}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={reload}><Text style={s.secondaryText}>{t('common.retry')}</Text></TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const { league, members, votes, handicapEvents } = data;
  const invitees = data.invitees ?? []; // absent in a cache written before invitees existed
  const active = members.filter((m) => !m.leftAt);
  const me = active.find((m) => m.userId === meId);
  const isAdmin = me?.role === 'admin';
  // R10: an admin sets their own handicap only when no other active admin
  // exists (set_league_handicap refuses 'own_handicap'); otherwise it's a vote.
  const otherAdmin = active.some((m) => m.role === 'admin' && m.userId !== meId);
  const archived = !!league.archivedAt;
  const needed = voteThreshold(active.length);
  const link = leagueJoinLink(shareOrigin(), rotated ?? league.inviteCode);
  const pot = potCents(members, league.entryFeeCents);
  const history = [...handicapEvents].reverse().slice(0, 8);
  const claims = isAdmin ? activeSpotClaims(events, members) : [];
  const pending = pendingSpotClaims(claims, seen);
  const nameOf = (id) => (id ? memberName(members, id, meId) : '');
  const membership = isAdmin ? membershipHistory(events, nameOf) : [];
  const whenOf = (iso) => `${formatDate(iso)} ${formatTime(iso)}`;

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

  async function confirmRemoveInvitee(invitee) {
    const yes = await ask({
      title: t('league.members.removeTitle', { name: invitee.name }),
      message: t('league.membersMisc.removeInviteeBody'),
      confirmLabel: t('league.membersMisc.remove'),
      destructive: true,
    });
    if (yes) run(() => removeLeagueInvitee(leagueId, invitee.id));
  }

  function openConfirm(next) {
    setTarget(null);
    setAlsoCode(false);
    setSheetError(null);
    setConfirm(next);
  }

  function closeConfirm() {
    if (!sheetBusy) setConfirm(null);
  }

  async function dismissClaims(list) {
    setSeen(await markClaimsSeen(leagueId, list.map((c) => c.eventId)));
  }

  async function confirmAction() {
    if (sheetBusy || !confirm) return;
    setSheetBusy(true);
    setSheetError(null);
    let name = '';
    try {
      if (confirm.kind === 'remove') {
        name = memberLabel(confirm.member, meId);
        await removeLeagueMember(leagueId, confirm.member.userId);
        let message = t('league.members.removed', { name });
        if (alsoCode) {
          try {
            setRotated((await rotateLeagueInviteCode(leagueId)).inviteCode);
            message = t('league.members.removedNewCode', { name });
          } catch (e) {
            message = t('league.members.removedCodeFailed', { name, error: leagueErrorText(e) || '' });
          }
        }
        setNotice(message);
      } else if (confirm.kind === 'release') {
        name = memberName(members, confirm.claim.userId, meId);
        await releaseLeagueInvitee(leagueId, confirm.claim.inviteeId);
        setNotice(t('league.members.released', { spot: confirm.claim.spotName }));
      } else {
        setRotated((await rotateLeagueInviteCode(leagueId)).inviteCode);
        setNotice(t('league.members.codeDone'));
      }
      setConfirm(null);
      await reload();
    } catch (e) {
      const key = memberAdminErrorKey(e);
      setSheetError(key ? t(key, { name }) : (leagueErrorText(e) || t('league.membersMisc.wrong')));
      if (e?.hint === 'not_claimed' || e?.hint === 'not_member') reload();
    } finally {
      setSheetBusy(false);
    }
  }

  async function shareLink() {
    try {
      await Share.share({ message: t('league.membersMisc.shareMessage', { league: league.name, link }) });
    } catch (e) {
      fail(e);
    }
  }

  function copyLink() {
    Clipboard.setString(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // The sheet keeps its text while it slides out, so it is built from the last confirm.
  const shown = confirm ?? lastConfirm.current;
  lastConfirm.current = shown;
  let confirmCopy = null;
  if (shown?.kind === 'remove') {
    const name = memberLabel(shown.member, meId);
    const n = pastCardCount(data.cards, shown.member.userId);
    confirmCopy = {
      title: t('league.members.removeTitle', { name }),
      lead: t('league.members.removeLead', { name }),
      lines: [n > 0 ? t('league.members.removeCards', { count: n }) : t('league.members.removeNoCards'), t('league.members.removeRejoin')],
      action: t('league.members.removeAction', { name }),
    };
  } else if (shown?.kind === 'release') {
    const c = shown.claim;
    confirmCopy = {
      title: t('league.members.releaseTitle', { spot: c.spotName }),
      lead: t('league.members.releaseLead', { when: whenOf(c.at), account: c.accountName }),
      lines: [
        c.handicap == null ? t('league.members.releaseBackNoHcp') : t('league.members.releaseBack', { handicap: formatNumber(c.handicap, { decimals: 1 }) }),
        t('league.members.releaseLeaves'),
      ],
      action: t('league.members.releaseAction'),
    };
  } else if (shown?.kind === 'code') {
    confirmCopy = {
      title: t('league.members.codeTitle'),
      lead: t('league.members.codeLead'),
      lines: [t('league.members.codeStops'), t('league.members.codeNeeds')],
      action: t('league.members.codeAction'),
    };
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <PullToRefresh style={{ flex: 1 }} contentContainerStyle={s.content} refreshing={refreshing} onRefresh={refresh}>
        {!!notice && (
          <TouchableOpacity style={s.notice} onPress={() => setNotice(null)} accessibilityRole="alert">
            <Feather name="check-circle" size={16} color={theme.accent.primary} />
            <Text style={s.noticeText}>{notice}</Text>
          </TouchableOpacity>
        )}
        {pending.length > 0 && (
          <View style={s.claimCard} accessibilityRole="summary">
            <Text style={s.claimOverline}>{t('league.members.claimOverline')}</Text>
            {pending.length === 1 ? (
              <>
                <Text style={s.voteTitle}>{t('league.members.claimTitle', { spot: pending[0].spotName })}</Text>
                <Text style={s.voteMeta}>
                  {pending[0].handicap == null
                    ? t('league.members.claimBodyNoHcp', { account: pending[0].accountName, when: whenOf(pending[0].at) })
                    : t('league.members.claimBody', { account: pending[0].accountName, when: whenOf(pending[0].at), handicap: formatNumber(pending[0].handicap, { decimals: 1 }) })}
                </Text>
              </>
            ) : (
              <>
                <Text style={s.voteTitle}>{t('league.members.claimsTitle', { count: pending.length })}</Text>
                {pending.map((c) => (
                  <View key={c.eventId} style={s.claimRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.memberName}>{c.spotName}</Text>
                      <Text style={s.memberSub}>{t('league.members.claimRow', { account: c.accountName, when: whenOf(c.at) })}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.chip}
                      onPress={() => openConfirm({ kind: 'release', claim: c })}
                      disabled={archived}
                      accessibilityRole="button"
                      accessibilityLabel={t('league.members.releaseA11y', { name: c.spotName })}
                    >
                      <Text style={s.chipText}>{t('league.members.release')}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
            <View style={s.voteBtns}>
              <TouchableOpacity style={[s.voteBtn, s.voteNo]} onPress={() => dismissClaims(pending)} activeOpacity={0.8} accessibilityRole="button">
                <Text style={s.voteNoText}>{pending.length === 1 ? t('league.members.looksRight') : t('league.members.allLookRight')}</Text>
              </TouchableOpacity>
              {pending.length === 1 && (
                <TouchableOpacity
                  style={[s.voteBtn, s.voteNo, { borderColor: theme.destructive }]}
                  onPress={() => openConfirm({ kind: 'release', claim: pending[0] })}
                  disabled={archived}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <Text style={[s.voteNoText, { color: theme.destructive }]}>{t('league.members.releaseAction')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        {votes.map((v) => {
          const subject = memberName(members, v.subjectUser, meId);
          const current = members.find((m) => m.userId === v.subjectUser)?.leagueHandicap;
          const myBallot = v.ballots.find((b) => b.voter === meId);
          const verb = current != null && v.proposed > current ? 'raise' : 'lower';
          return (
            <View key={v.id} style={s.voteCard}>
              <View style={s.voteHead}>
                <Text style={s.voteOverline}>{t('league.membersMisc.openVote')}</Text>
              </View>
              <Text style={s.voteTitle}>
                {current != null
                  ? t(`league.membersMisc.${verb}Title`, { subject, from: formatNumber(current, { decimals: 1 }), to: formatNumber(v.proposed, { decimals: 1 }) })
                  : t('league.membersMisc.setTitle', { subject, to: formatNumber(v.proposed, { decimals: 1 }) })}
              </Text>
              <Text style={s.voteMeta}>
                {t('league.membersMisc.voteMeta', {
                  name: memberName(members, v.openedBy, meId), yes: v.ballots.filter((b) => b.yes).length, total: active.length, needed, date: formatDate(v.closesAt),
                })}
              </Text>
              {myBallot ? (
                <Text style={s.voteMeta}>{t(myBallot.yes ? 'league.membersMisc.votedYes' : 'league.membersMisc.votedNo')}</Text>
              ) : (
                <View style={s.voteBtns}>
                  <TouchableOpacity style={[s.voteBtn, s.voteNo]} onPress={() => vote(v, false)} disabled={busy || archived} activeOpacity={0.8}>
                    <Text style={s.voteNoText}>{t('league.membersMisc.no')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.voteBtn, s.voteYes]} onPress={() => vote(v, true)} disabled={busy || archived} activeOpacity={0.8}>
                    <Text style={s.voteYesText}>{t(`league.membersMisc.yes.${verb}`)}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        <Text style={s.sectionLabel}>
          {league.entryFeeCents > 0
            ? t('league.membersMisc.membersPot', { count: active.length, pot: formatEuros(pot).toUpperCase() })
            : t('league.membersMisc.members', { count: active.length })}
        </Text>
        <View style={s.card}>
          {active.map((m, i) => {
            const hcp = m.leagueHandicap == null ? t('league.membersMisc.noHcp') : t('league.membersMisc.hcp', { value: formatNumber(m.leagueHandicap, { decimals: 1 }) });
            const atCap = m.leagueHandicap != null && m.leagueHandicap >= league.handicapCap;
            const claim = claimForUser(claims, m.userId);
            return (
              <TouchableOpacity
                key={m.userId}
                style={[s.memberRow, i < active.length - 1 && s.rowDivider]}
                onPress={() => !archived && openSheet(m)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('league.membersMisc.hcpA11y', { name: memberLabel(m, meId) })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.memberName} numberOfLines={1}>
                    {m.userId === meId ? t('league.membersMisc.youNamed', { name: m.displayName ?? t('league.membersMisc.me') }) : memberLabel(m, meId)}
                  </Text>
                  <Text style={s.memberSub}>
                    {[hcp, atCap ? t('league.membersMisc.atCap') : null].filter(Boolean).join(' · ')}
                  </Text>
                  {!!claim && <Text style={s.memberSub}>{t('league.members.claimedLineNoHcp', { when: formatDate(claim.at) })}</Text>}
                </View>
                {!!claim && !archived && (
                  <TouchableOpacity
                    style={s.chip}
                    onPress={() => openConfirm({ kind: 'release', claim })}
                    accessibilityRole="button"
                    accessibilityLabel={t('league.members.releaseA11y', { name: memberLabel(m, meId) })}
                  >
                    <Text style={s.chipText}>{t('league.members.release')}</Text>
                  </TouchableOpacity>
                )}
                {m.role === 'admin' && <View style={s.badge}><Text style={s.badgeText}>{t('league.membersMisc.admin')}</Text></View>}
                {league.entryFeeCents > 0 && (
                  <Text style={[s.fee, m.feePaid ? { color: theme.accent.primary } : { color: theme.destructive }]}>
                    {m.feePaid ? t('league.membersMisc.paid') : t('league.membersMisc.due', { amount: formatEuros(league.entryFeeCents) })}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {invitees.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{t('league.membersMisc.invited')}</Text>
            <View style={s.card}>
              {invitees.map((i, idx) => (
                <View key={i.id} style={[s.memberRow, s.invitedRow, idx < invitees.length - 1 && s.rowDivider]}>
                  <InitialsAvatar name={i.name} muted />
                  <View style={{ flex: 1 }}>
                    <Text style={s.memberName} numberOfLines={1}>{i.name}</Text>
                    <Text style={s.memberSub}>{t('league.membersMisc.notJoined')}</Text>
                  </View>
                  <Text style={s.memberSub}>{i.handicap == null ? '' : formatNumber(i.handicap, { decimals: 1 })}</Text>
                  {isAdmin && !archived && (
                    <TouchableOpacity
                      style={s.removeBtn}
                      onPress={() => confirmRemoveInvitee(i)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={t('league.members.removeAction', { name: i.name })}
                    >
                      <Feather name="x" size={18} color={theme.text.muted} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {history.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{t('league.membersMisc.hcpHistory')}</Text>
            <View style={s.card}>
              {history.map((ev, i) => (
                <View key={ev.id} style={[s.historyRow, i < history.length - 1 && s.rowDivider]}>
                  <Text style={s.historyText}>{handicapEventLine(ev, members, meId)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {membership.length > 0 && (
          <>
            <Text style={s.sectionLabel}>{t('league.members.history')}</Text>
            <View style={s.card}>
              {membership.map((h, i) => (
                <View key={h.id} style={[s.historyRow, i < membership.length - 1 && s.rowDivider]}>
                  <Text style={s.historyText}>{`${t(h.key, h.params)} · ${formatDate(h.at, 'day')}`}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={s.sectionLabel}>{t('league.membersMisc.invite')}</Text>
        <View style={s.card}>
          <Text style={s.link} selectable>{link}</Text>
          <View style={s.inviteBtns}>
            <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={copyLink} activeOpacity={0.8}>
              <Feather name={copied ? 'check' : 'link'} size={16} color={theme.accent.primary} style={{ marginRight: 8 }} />
              <Text style={s.secondaryText}>{t(copied ? 'league.membersMisc.copied' : 'league.membersMisc.copyLink')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1 }]} onPress={shareLink} activeOpacity={0.8}>
              <Feather name="share-2" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
              <Text style={s.primaryText}>{t('league.membersMisc.shareInvite')}</Text>
            </TouchableOpacity>
          </View>
          {isAdmin && !archived && (
            <TouchableOpacity style={s.codeLink} onPress={() => openConfirm({ kind: 'code' })} accessibilityRole="button">
              <Feather name="refresh-cw" size={15} color={theme.accent.primary} style={{ marginRight: 8 }} />
              <Text style={s.secondaryText}>{t('league.members.codeLink')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </PullToRefresh>

      <BottomSheet visible={!!target} onClose={() => setTarget(null)} sheetStyle={s.sheet}>
        <SheetHandle />
        <Text style={s.sheetTitle}>{target ? memberLabel(target, meId) : ''}</Text>
        <Text style={s.sheetSub}>{t('league.membersMisc.sheetSub', { cap: league.handicapCap })}</Text>
        <TextInput
          style={s.input}
          value={hcpText}
          onChangeText={setHcpText}
          keyboardType="decimal-pad"
          placeholder={t('league.membersMisc.hcpPlaceholder')}
          placeholderTextColor={theme.text.muted}
          keyboardAppearance={theme.isDark ? 'dark' : 'light'}
          selectionColor={theme.accent.primary}
          accessibilityLabel={t('league.membersMisc.newHcpA11y')}
        />
        {isAdmin && !(target?.userId === meId && otherAdmin) && (
          <TouchableOpacity
            style={[s.primaryBtn, (proposed == null || busy) && { opacity: 0.5 }]}
            disabled={proposed == null || busy}
            onPress={() => run(() => setLeagueHandicap(leagueId, target.userId, proposed))}
            activeOpacity={0.8}
          >
            <Text style={s.primaryText}>{t('league.membersMisc.setHandicap')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.secondaryBtn, { marginTop: 10 }, (proposed == null || busy) && { opacity: 0.5 }]}
          disabled={proposed == null || busy}
          onPress={() => run(() => openHandicapVote(leagueId, target.userId, proposed))}
          activeOpacity={0.8}
        >
          <Text style={s.secondaryText}>{t('league.membersMisc.openVoteBtn', { needed, total: active.length })}</Text>
        </TouchableOpacity>
        {isAdmin && !archived && target && target.userId !== meId && (
          <TouchableOpacity
            style={s.removeLink}
            onPress={() => openConfirm({ kind: 'remove', member: target })}
            disabled={busy}
            accessibilityRole="button"
          >
            <Feather name="user-minus" size={16} color={theme.destructive} style={{ marginRight: 8 }} />
            <Text style={[s.secondaryText, { color: theme.destructive }]}>{t('league.members.removeLink')}</Text>
          </TouchableOpacity>
        )}
      </BottomSheet>

      {confirmCopy && (
        <MemberAdminSheet
          visible={!!confirm}
          title={confirmCopy.title}
          lead={confirmCopy.lead}
          lines={confirmCopy.lines}
          danger={shown.kind !== 'code'}
          action={confirmCopy.action}
          busy={sheetBusy}
          error={sheetError}
          onConfirm={confirmAction}
          onCancel={closeConfirm}
        >
          {shown.kind === 'remove' && (
            <TouchableOpacity
              style={s.checkRow}
              onPress={() => setAlsoCode((v) => !v)}
              disabled={sheetBusy}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: alsoCode }}
            >
              <Feather name={alsoCode ? 'check-square' : 'square'} size={20} color={theme.accent.primary} />
              <Text style={s.checkText}>{t('league.members.removeAlsoCode')}</Text>
            </TouchableOpacity>
          )}
        </MemberAdminSheet>
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
    invitedRow: { opacity: 0.7 },
    removeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    fee: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },
    badge: { backgroundColor: theme.accent.light, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
    badgeText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11 },
    historyRow: { paddingVertical: 10 },
    historyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17 },

    voteCard: {
      backgroundColor: theme.accent.light, borderRadius: 16, borderWidth: 1, borderColor: theme.accent.primary + '40',
      padding: 16, marginBottom: 14,
    },
    voteHead: { flexDirection: 'row', marginBottom: 6 },
    voteOverline: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 10, letterSpacing: 1.6 },
    voteTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 16, lineHeight: 22 },
    voteMeta: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
    voteBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
    voteBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 12 },
    voteNo: { borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.bg.card },
    voteNoText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
    voteYes: { backgroundColor: theme.accent.primary },
    voteYesText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },

    notice: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.accent.light,
      borderRadius: 12, padding: 12, marginBottom: 14,
    },
    noticeText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 13, lineHeight: 18 },
    claimCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: theme.info ?? theme.accent.primary,
      padding: 16, marginBottom: 14,
    },
    claimOverline: { fontFamily: 'PlusJakartaSans-Bold', color: theme.info ?? theme.accent.primary, fontSize: 10, letterSpacing: 1.6, marginBottom: 6 },
    claimRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10 },
    chip: {
      minHeight: 32, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: theme.destructive,
      alignItems: 'center', justifyContent: 'center',
    },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.destructive, fontSize: 12 },
    codeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, marginBottom: 6 },
    removeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 14 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    checkText: { flex: 1, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary, fontSize: 14 },

    link: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, paddingVertical: 14 },
    inviteBtns: { flexDirection: 'row', gap: 10, paddingBottom: 14 },
    primaryBtn: btn.primaryBtn,
    primaryText: btn.primaryText,
    secondaryBtn: btn.secondaryBtn,
    secondaryText: btn.secondaryTextAccent,

    sheet: { padding: 20 },
    sheetTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, textAlign: 'center' },
    sheetSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 14 },
    input: {
      backgroundColor: theme.bg.secondary, color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, padding: 14, marginBottom: 12, fontSize: 16, fontFamily: 'PlusJakartaSans-Bold',
      textAlign: 'center',
    },
  });
}
