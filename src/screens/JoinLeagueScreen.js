import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../theme/ThemeContext';
import { loadProfile } from '../store/profileStore';
import { getLeagueByCode, joinLeague } from '../store/leagueStore';
import { defaultMemberHandicap, parseMemberHandicap } from '../store/leagueDraft';
import { formatEuros, monthName, currentMonthKey } from '../store/leagueView';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { attachEmailToGuest, isEmailTakenError } from '../lib/guestAccount';
import { consumeJustJoined, requestLoginTab } from '../lib/leagueJoinHandoff';
import GuestIdentityFields, { guestIdentityErrors } from '../components/league/GuestIdentityFields';

// /league/:code. Shows the league, the rules in brief and the league handicap
// the admin proposed (the member can propose another), then Join. A guest
// (anonymous session, e.g. from a tournament guest link) must also give a
// name and an email: the server refuses a nameless guest, and the email sends
// the link that keeps the account.
export default function JoinLeagueScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
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
        const cap = summary.handicapCap;
        setProfileHcp(profile?.handicap ?? null);
        const start = summary.proposedHandicap ?? defaultMemberHandicap(profile?.handicap, cap);
        setHcpText(start == null ? '' : String(start));
        setLeague(summary);
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorText(e?.message || 'Could not load this league.');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code, navigation]);

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
      const { leagueId } = isGuest
        ? await joinLeague(code, proposed, guestName.trim())
        : await joinLeague(code, proposed);
      navigation.replace('LeagueBoard', { leagueId });
    } catch (e) {
      joiningRef.current = false;
      setJoinError(e?.message || 'Could not join. Please try again.');
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
          <Text style={s.emptyTitle}>{notFound ? "This invite code isn't valid" : "Couldn't load the league"}</Text>
          <Text style={s.emptyText}>
            {notFound ? 'Check the code or ask for the link again.' : errorText}
          </Text>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={s.secondaryText}>Go back</Text>
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

  const proposedBy = league.adminName ? `Proposed by ${league.adminName}.` : 'Proposed by the admin.';
  const hcpValue = parseMemberHandicap(hcpText, league.handicapCap);
  const canJoin = !league.archived && !busy;

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} accessibilityLabel="Go back">
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Join league</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <Text style={s.heroOverline}>
            {league.adminName ? `${league.adminName.toUpperCase()} INVITED YOU` : 'YOU ARE INVITED'}
          </Text>
          <Text style={s.heroName}>{league.name}</Text>
          <View style={s.chipRow}>
            <View style={s.chip}>
              <Text style={s.chipText}>{`${league.memberCount} member${league.memberCount === 1 ? '' : 's'}`}</Text>
            </View>
            <View style={s.chip}><Text style={s.chipText}>{`${monthName(currentMonthKey())} open`}</Text></View>
          </View>
        </View>

        <Text style={s.overline}>HOW IT WORKS</Text>
        <View style={s.card}>
          {rule('calendar', 'One card a month', 'Declare before the first shot. That card counts.')}
          {rule('target', 'Net Stableford, league handicap', `Max ${league.handicapCap}. The group can lower it by vote.`)}
          {rule('check-circle', 'A marker confirms every card', 'In the app, by QR, or a photo of the signed card.')}
          {rule('award', league.entryFeeCents > 0 ? `Entry ${formatEuros(league.entryFeeCents)}` : 'No entry fee',
            league.entryFeeCents > 0 ? `Paid to ${league.adminName ?? 'the admin'}. Pot to the top of the season.` : 'Just play.', true)}
        </View>

        {league.isMember ? (
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => navigation.replace('LeagueBoard', { leagueId: league.id })}
            activeOpacity={0.8}
          >
            <Text style={s.primaryText}>You're in. Open the league</Text>
          </TouchableOpacity>
        ) : (
          <>
            <View style={s.hcpCard}>
              <Text style={s.overline}>YOUR LEAGUE HANDICAP</Text>
              {proposing ? (
                <TextInput
                  style={s.hcpInput}
                  value={hcpText}
                  onChangeText={setHcpText}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 22.5"
                  placeholderTextColor={theme.text.muted}
                  keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                  selectionColor={theme.accent.primary}
                  accessibilityLabel="Proposed league handicap"
                />
              ) : (
                <Text style={s.hcpValue}>{hcpValue == null ? 'Not set' : hcpValue.toFixed(1)}</Text>
              )}
              <Text style={s.hcpSub}>
                {`${league.proposedHandicap != null ? proposedBy : 'The admin will set it.'}${profileHcp != null ? ` Your index is ${profileHcp}.` : ''}`}
              </Text>
              {!proposing && (
                <TouchableOpacity onPress={() => setProposing(true)} activeOpacity={0.7}>
                  <Text style={s.proposeLink}>Propose another</Text>
                </TouchableOpacity>
              )}
            </View>

            {isGuest && (
              <View style={s.hcpCard}>
                <Text style={s.overline}>{"WHO'S JOINING"}</Text>
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
                <Text style={s.hcpSub}>We email you a link to keep the account and sign in on other devices.</Text>
              </View>
            )}

            {emailTaken && (
              <Text style={s.errorText}>
                That email already has a Golf Partner account.{' '}
                <Text
                  style={s.errorLink}
                  accessibilityRole="link"
                  onPress={() => { requestLoginTab(); supabase.auth.signOut().catch(() => {}); }}
                >
                  Log in instead
                </Text>
              </Text>
            )}
            {!!joinError && <Text style={s.errorText}>{joinError}</Text>}
            {league.archived && <Text style={s.errorText}>This league is archived and can't be joined.</Text>}

            <TouchableOpacity
              style={[s.primaryBtn, !canJoin && { opacity: 0.5 }]}
              onPress={handleJoin}
              disabled={!canJoin}
              activeOpacity={0.8}
            >
              {busy && <ActivityIndicator color={theme.text.inverse} style={{ marginRight: 8 }} />}
              <Text style={s.primaryText}>{`Join ${league.name}`}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 },
    backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 15 },
    content: { padding: 20, paddingBottom: 40 },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },

    hero: { backgroundColor: theme.bg.deep, borderRadius: 20, padding: 20, marginBottom: 20 },
    heroOverline: { fontFamily: 'PlusJakartaSans-Bold', color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: 1.6 },
    heroName: { fontFamily: 'PlayfairDisplay-Bold', color: '#ffffff', fontSize: 26, letterSpacing: -0.3, marginTop: 6 },
    chipRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    chip: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', color: '#ffffff', fontSize: 11 },

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

    hcpCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 16, marginBottom: 16, alignItems: 'flex-start',
    },
    hcpValue: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 34 },
    hcpInput: {
      alignSelf: 'stretch', color: theme.text.primary, borderRadius: 10, borderWidth: 1,
      borderColor: theme.border.default, backgroundColor: theme.bg.secondary, padding: 12,
      fontSize: 18, fontFamily: 'PlusJakartaSans-Bold',
    },
    hcpSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
    proposeLink: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13, marginTop: 10 },

    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginBottom: 10 },
    errorLink: { color: theme.accent.primary, textDecorationLine: 'underline' },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 15,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    secondaryBtn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 28,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
