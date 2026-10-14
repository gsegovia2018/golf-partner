import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import ScreenHeader from '../components/ui/ScreenHeader';
import LeagueHero from '../components/league/LeagueHero';
import { useTheme } from '../theme/ThemeContext';
import { useT, formatNumber, formatDate } from '../i18n';
import { loadProfile } from '../store/profileStore';
import { getLeagueByCode, getLeagueInvitee, joinLeague } from '../store/leagueStore';
import { defaultMemberHandicap, parseMemberHandicap } from '../store/leagueDraft';
import { formatEuros, currentMonthKey } from '../store/leagueView';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { attachEmailToGuest, isEmailTakenError } from '../lib/guestAccount';
import { consumeJustJoined, requestLoginTab } from '../lib/leagueJoinHandoff';
import GuestIdentityFields, { guestIdentityErrors } from '../components/league/GuestIdentityFields';
import InitialsAvatar from '../components/league/InitialsAvatar';
import { leagueErrorText } from '../lib/leagueErrorText';
import { useConfirmSheet } from '../components/league/ConfirmSheet';

// /league/:code. Shows the league, the rules in brief and the league handicap
// the admin proposed (the member can propose another), then Join. When the
// admin saved spots for people outside the app, "Are you one of these?" lets
// the member claim theirs and keep the handicap set for it. A guest
// (anonymous session, e.g. from a tournament guest link) must also give a
// name and an email: the server refuses a nameless guest, and the email sends
// the link that keeps the account.
export default function JoinLeagueScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const t = useT();
  const { ask, sheet: confirmSheet } = useConfirmSheet();
  const code = route?.params?.code ?? '';
  const authUser = useAuth()?.user ?? null;
  const isGuest = !!authUser?.is_anonymous;
  // An email already attached (awaiting confirmation) is not sent again.
  const pendingEmail = authUser?.new_email ?? '';

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [league, setLeague] = useState(null);
  const [profileHcp, setProfileHcp] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | notfound | error
  const [errorText, setErrorText] = useState('');
  const [proposing, setProposing] = useState(false);
  const [hcpText, setHcpText] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [emailTaken, setEmailTaken] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState(pendingEmail);
  const [submitted, setSubmitted] = useState(false);
  const [myName, setMyName] = useState('');
  const [spot, setSpot] = useState(null); // the reserved spot claimed, null = none of these
  const [spotBusyId, setSpotBusyId] = useState(null);
  const defaultHcpRef = useRef('');
  const joiningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summary, profile] = await Promise.all([
          getLeagueByCode(code),
          loadProfile().catch(() => null),
        ]);
        if (cancelled) return;
        if (!summary) { setState('notfound'); return; }
        // Just joined from the signed-out invite screen: straight to the board.
        if (summary.isMember && consumeJustJoined(code)) {
          navigation.replace('LeagueBoard', { leagueId: summary.id });
          return;
        }
        setGuestName((n) => n || profile?.displayName || '');
        setMyName(profile?.displayName || '');
        const cap = summary.handicapCap;
        setProfileHcp(profile?.handicap ?? null);
        const start = summary.proposedHandicap ?? defaultMemberHandicap(profile?.handicap, cap);
        defaultHcpRef.current = start == null ? '' : String(start);
        setHcpText(defaultHcpRef.current);
        setLeague(summary);
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorText(leagueErrorText(e) || '');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigation]);

  // Logging in from a guest session signs the guest out, and whatever they
  // did as a guest stays with that session, so ask first.
  async function confirmLogIn() {
    const yes = await ask({
      title: t('league.join.loginTitle'),
      message: t('league.join.loginBody'),
      confirmLabel: t('league.join.logIn'),
      cancelLabel: t('league.join.stayGuest'),
    });
    if (yes) { requestLoginTab(); supabase.auth.signOut().catch(() => {}); }
  }

  // Claim one of the admin's reserved spots (or back to none): its handicap
  // replaces the field, and a guest's name is prefilled from it.
  async function chooseSpot(invitee) {
    if (spotBusyId || joiningRef.current) return;
    if (!invitee) {
      setSpot(null);
      setHcpText(defaultHcpRef.current);
      setProposing(false);
      return;
    }
    setSpotBusyId(invitee.id);
    setJoinError('');
    try {
      const found = await getLeagueInvitee(code, invitee.id);
      if (!mountedRef.current) return;
      if (!found || found.claimed) {
        setLeague((l) => ({ ...l, invitees: l.invitees.filter((i) => i.id !== invitee.id) }));
        setJoinError(t('league.join.spotTaken', { name: invitee.name }));
        return;
      }
      setSpot(found);
      if (found.handicap != null) setHcpText(String(found.handicap));
      setProposing(false);
      // A guest who already has a name keeps it; the spot name only fills a blank.
      if (isGuest) setGuestName((n) => n || found.name);
    } catch (e) {
      if (mountedRef.current) setJoinError(leagueErrorText(e) || t('league.join.spotLoadFailed'));
    } finally {
      if (mountedRef.current) setSpotBusyId(null);
    }
  }

  const { nameError, emailError } = guestIdentityErrors({ name: guestName, email: guestEmail });

  async function handleJoin() {
    if (joiningRef.current || !league) return;
    setSubmitted(true);
    if (isGuest && (nameError || emailError)) return;
    joiningRef.current = true;
    setBusy(true);
    setJoinError('');
    setEmailTaken(false);
    try {
      const proposed = parseMemberHandicap(hcpText, league.handicapCap);
      if (isGuest && guestEmail.trim().toLowerCase() !== pendingEmail.toLowerCase()) {
        try {
          await attachEmailToGuest({ email: guestEmail, name: guestName });
        } catch (e) {
          if (!isEmailTakenError(e)) throw e;
          joiningRef.current = false;
          setEmailTaken(true);
          return;
        }
      }
      // Extra args only when they apply, so a plain join keeps its plain call.
      const extra = spot ? [isGuest ? guestName.trim() : null, spot.id] : (isGuest ? [guestName.trim()] : []);
      const { leagueId } = await joinLeague(code, proposed, ...extra);
      navigation.replace('LeagueBoard', { leagueId });
    } catch (e) {
      joiningRef.current = false;
      setJoinError(leagueErrorText(e) || t('league.join.joinFailed'));
      // Someone else took the spot meanwhile: drop it from the list.
      if (spot && /^Someone already joined as/.test(e?.message ?? '')) {
        const gone = spot.id;
        setLeague((l) => ({ ...l, invitees: l.invitees.filter((i) => i.id !== gone) }));
        setSpot(null);
        setHcpText(defaultHcpRef.current);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      </ScreenContainer>
    );
  }

  if (state !== 'ready') {
    const notFound = state === 'notfound';
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.center}>
          <Feather name={notFound ? 'help-circle' : 'cloud-off'} size={40} color={theme.text.muted} />
          <Text style={s.emptyTitle}>{notFound ? t('league.join.invalidCode') : t('league.join.couldntLoad')}</Text>
          <Text style={s.emptyText}>
            {notFound ? t('league.join.checkCode') : (errorText || t('league.join.loadFailed'))}
          </Text>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={s.secondaryText}>{t('league.join.goBack')}</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const rule = (icon, title, sub, last) => (
    <View style={[s.ruleRow, !last && s.divider]}>
      <Feather name={icon} size={16} color={theme.accent.primary} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.ruleTitle}>{title}</Text>
        <Text style={s.ruleSub}>{sub}</Text>
      </View>
    </View>
  );

  const proposedBy = league.adminName ? t('league.join.proposedBy', { name: league.adminName }) : t('league.join.proposedByAdmin');
  const hcpValue = parseMemberHandicap(hcpText, league.handicapCap);
  const canJoin = !league.archived && !busy;

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <ScreenHeader onBack={() => navigation.goBack()} backLabel={t('league.join.goBack')} title={t('league.join.title')} />

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <LeagueHero
          overline={league.adminName ? t('league.join.invitedYou', { name: league.adminName.toUpperCase() }) : t('league.join.youAreInvited')}
          name={league.name}
          chips={[
            t('league.join.members', { count: league.memberCount }),
            t('league.join.monthOpen', { month: formatDate(`${currentMonthKey()}-01`, 'monthName') }),
          ]}
        />

        <Text style={s.overline}>{t('league.join.howItWorks')}</Text>
        <View style={s.card}>
          {rule('calendar', t('league.join.ruleOneCard'), t('league.join.ruleOneCardSub'))}
          {rule('target', t('league.join.ruleNet'), t('league.join.ruleNetSub', { cap: formatNumber(league.handicapCap) }))}
          {rule('check-circle', t('league.join.ruleMarker'), t('league.join.ruleMarkerSub'))}
          {rule('award', league.entryFeeCents > 0 ? t('league.join.ruleFee', { fee: formatEuros(league.entryFeeCents) }) : t('league.join.ruleNoFee'),
            league.entryFeeCents > 0
              ? (league.adminName ? t('league.join.rulePaid', { name: league.adminName }) : t('league.join.rulePaidAdmin'))
              : t('league.join.ruleJustPlay'), true)}
        </View>

        {league.isMember ? (
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => navigation.replace('LeagueBoard', { leagueId: league.id })}
            activeOpacity={0.8}
          >
            <Text style={s.primaryText}>{t('league.join.youreIn')}</Text>
          </TouchableOpacity>
        ) : (
          <>
            {(league.invitees ?? []).length > 0 && (
              <View style={s.spotBlock}>
                <Text style={s.overline}>{t('league.join.spotsTitle')}</Text>
                <Text style={s.spotHint}>{league.adminName ? t('league.join.spotHint', { name: league.adminName }) : t('league.join.spotHintAdmin')}</Text>
                <View style={s.spotCard}>
                  {league.invitees.map((i) => {
                    const on = spot?.id === i.id;
                    return (
                      <TouchableOpacity
                        key={i.id}
                        style={[s.spotRow, s.divider, on && s.spotRowOn]}
                        onPress={() => chooseSpot(i)}
                        disabled={!!spotBusyId}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={i.name}
                      >
                        <InitialsAvatar name={i.name} />
                        <Text style={s.spotName} numberOfLines={1}>{i.name}</Text>
                        {spotBusyId === i.id
                          ? <ActivityIndicator color={theme.accent.primary} />
                          : <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[s.spotRow, !spot && s.spotRowOn]}
                    onPress={() => chooseSpot(null)}
                    disabled={!!spotBusyId}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: !spot }}
                  >
                    <Text style={s.spotName} numberOfLines={2}>
                      {myName ? t('league.join.noneOfThese', { name: myName }) : t('league.join.noneOfTheseBare')}
                    </Text>
                    <View style={[s.radio, !spot && s.radioOn]}>{!spot && <View style={s.radioDot} />}</View>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={s.hcpCard}>
              <Text style={s.overline}>{t('league.join.hcpTitle')}</Text>
              {proposing ? (
                <TextInput
                  style={s.hcpInput}
                  value={hcpText}
                  onChangeText={setHcpText}
                  keyboardType="decimal-pad"
                  placeholder={t('league.join.hcpPh')}
                  placeholderTextColor={theme.text.muted}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  accessibilityLabel={t('league.join.hcpProposedA11y')}
                />
              ) : (
                <Text style={s.hcpValue}>{hcpValue == null ? t('league.join.hcpNotSet') : formatNumber(hcpValue, { decimals: 1 })}</Text>
              )}
              <Text style={s.hcpSub}>
                {[
                  spot?.handicap != null
                    ? (league.adminName ? t('league.join.savedBy', { name: league.adminName }) : t('league.join.savedByAdmin'))
                    : league.proposedHandicap != null ? proposedBy : t('league.join.adminWillSet'),
                  profileHcp != null ? t('league.join.yourIndex', { hcp: formatNumber(profileHcp) }) : null,
                ].filter(Boolean).join(' ')}
              </Text>
              {!proposing && (
                <TouchableOpacity onPress={() => setProposing(true)} activeOpacity={0.7}>
                  <Text style={s.proposeLink}>{t('league.join.proposeAnother')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {isGuest && (
              <View style={s.hcpCard}>
                <Text style={s.overline}>{t('league.join.whoJoining')}</Text>
                <View style={{ alignSelf: 'stretch' }}>
                  <GuestIdentityFields
                    name={guestName}
                    onChangeName={setGuestName}
                    email={guestEmail}
                    onChangeEmail={setGuestEmail}
                    nameError={submitted ? nameError : null}
                    emailError={submitted ? emailError : null}
                  />
                </View>
                <Text style={s.hcpSub}>{t('league.join.emailLinkLong')}</Text>
                <TouchableOpacity onPress={confirmLogIn} activeOpacity={0.7}>
                  <Text style={s.proposeLink}>{t('league.join.haveAccountLogIn')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {emailTaken && (
              <Text style={s.errorText}>
                {t('league.join.emailTaken')}{' '}
                <Text
                  style={s.errorLink}
                  accessibilityRole="link"
                  onPress={confirmLogIn}
                >
                  {t('league.join.logInInstead')}
                </Text>
              </Text>
            )}
            {!!joinError && <Text style={s.errorText}>{joinError}</Text>}
            {league.archived && <Text style={s.errorText}>{t('league.join.archived')}</Text>}

            <TouchableOpacity
              style={[s.primaryBtn, !canJoin && { opacity: 0.5 }]}
              onPress={handleJoin}
              disabled={!canJoin}
              activeOpacity={0.8}
            >
              {busy && <ActivityIndicator color={theme.text.inverse} style={{ marginRight: 8 }} />}
              <Text style={s.primaryText}>{t('league.join.joinNamed', { name: league.name })}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
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
    content: { padding: 20, paddingBottom: 40 },
    emptyTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 18, lineHeight: 24, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },


    overline: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11,
      letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 8,
    },
    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      overflow: 'hidden', marginBottom: 16, ...(theme.isDark ? {} : theme.shadow.card),
    },
    divider: { borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
    ruleRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    ruleTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    ruleSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },

    spotBlock: { marginBottom: 16 },
    spotHint: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, lineHeight: 18, marginBottom: 10 },
    spotCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder, overflow: 'hidden',
    },
    spotRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
    spotRowOn: { backgroundColor: theme.accent.light },
    spotName: { flex: 1, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    radio: {
      width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: theme.border.default,
      alignItems: 'center', justifyContent: 'center', marginLeft: 8,
    },
    radioOn: { borderColor: theme.accent.primary },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.accent.primary },
    hcpCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 16, alignItems: 'flex-start',
    },
    hcpValue: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 34, fontVariant: ['tabular-nums'] },
    hcpInput: {
      alignSelf: 'stretch', color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, backgroundColor: theme.bg.secondary, padding: 12,
      fontSize: 18, fontFamily: 'PlusJakartaSans-Bold',
    },
    hcpSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
    proposeLink: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13, marginTop: 10 },

    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginBottom: 10 },
    errorLink: { color: theme.accent.primary, textDecorationLine: 'underline' },
    primaryBtn: btn.primaryBtn,
    primaryText: btn.primaryText,
    secondaryBtn: { ...btn.secondaryBtn, paddingHorizontal: 28 },
    secondaryText: btn.secondaryText,
  });
}
