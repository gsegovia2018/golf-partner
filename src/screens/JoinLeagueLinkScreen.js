import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { supabase } from '../lib/supabase';
import { signInAnonymously } from '../lib/oauth';
import { attachEmailToGuest, isEmailTakenError } from '../lib/guestAccount';
import {
  holdLeagueJoin, releaseLeagueJoin, markJustJoined, consumeLoginTab,
} from '../lib/leagueJoinHandoff';
import { getLeagueInvitePreview, joinLeague } from '../store/leagueStore';
import { parseMemberHandicap } from '../store/leagueDraft';
import { formatEuros, monthName, currentMonthKey } from '../store/leagueView';
import AuthForm from '../components/AuthForm';
import GuestIdentityFields, { LabeledField, guestIdentityErrors } from '../components/league/GuestIdentityFields';
import AuthScreen from './AuthScreen';

// Shown pre-session when someone opens a /league/CODE invite. One screen:
// the league in a hero, then "I'm new" (name + email + handicap: a guest
// session gets the email attached, which sends the link that keeps the
// account, and joins) or "I have an account" (sign in; the navigator then
// routes the same URL to JoinLeagueScreen's handicap confirm).
//
// The "I'm new" path holds the auth gate (leagueJoinHandoff) so App.js keeps
// this screen mounted after the guest session appears, until the join lands.
export default function JoinLeagueLinkScreen({ code }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [preview, setPreview] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | notfound | error
  const [tab, setTab] = useState(() => (consumeLoginTab() ? 'account' : 'new'));
  const [showSignIn, setShowSignIn] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [hcpText, setHcpText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // null | { kind: 'taken' } | { kind: 'other', text }
  // Steps already done in this attempt, so a retry after a failed join reuses
  // the guest session instead of creating another one.
  const stepsRef = useRef({ guest: false, email: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getLeagueInvitePreview(code);
        if (cancelled) return;
        if (!p) { setState('notfound'); return; }
        setPreview(p);
        setState('ready');
      } catch {
        // The preview is a nicety; joining still works without it.
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (showSignIn) return <AuthScreen />;

  const cap = preview?.handicapCap ?? 30;
  const hcpValue = parseMemberHandicap(hcpText, cap);
  const { nameError, emailError } = guestIdentityErrors({ name, email });
  const hcpError = hcpText.trim() === '' ? 'Enter your handicap' : (hcpValue == null ? 'Enter a number like 18.4' : null);
  const formValid = !nameError && !emailError && !hcpError;
  const archived = !!preview?.archived;
  const leagueName = preview?.name ?? 'the league';

  async function dropGuest() {
    stepsRef.current = { guest: false, email: false };
    try { await supabase.auth.signOut(); } catch { /* already signed out */ }
  }

  async function handleJoin() {
    setSubmitted(true);
    if (busy || !formValid || archived) return;
    setBusy(true);
    setError(null);
    holdLeagueJoin();
    let keepHold = false;
    try {
      if (!stepsRef.current.guest) {
        await signInAnonymously();
        stepsRef.current.guest = true;
      }
      if (!stepsRef.current.email) {
        try {
          await attachEmailToGuest({ email, name });
        } catch (e) {
          if (isEmailTakenError(e)) {
            await dropGuest();
            if (mountedRef.current) setError({ kind: 'taken' });
            return;
          }
          throw e;
        }
        stepsRef.current.email = true;
      }
      await joinLeague(code, hcpValue, name.trim());
      markJustJoined(code);
      // Releasing the hold below lets App.js swap in the navigator, which
      // opens /league/CODE and forwards to the board.
    } catch (e) {
      // With a guest session already made, stay here (hold kept) so a retry
      // reuses it; without one there is nothing to hold.
      keepHold = stepsRef.current.guest;
      if (mountedRef.current) setError({ kind: 'other', text: e?.message || 'Could not join. Please try again.' });
    } finally {
      if (mountedRef.current) setBusy(false);
      if (!keepHold) releaseLeagueJoin();
    }
  }

  async function switchTab(next) {
    if (next === tab || busy) return;
    setError(null);
    // A guest made by a failed "I'm new" attempt must not linger under a login.
    if (next === 'account' && stepsRef.current.guest) {
      await dropGuest();
      releaseLeagueJoin();
    }
    setTab(next);
  }

  if (state === 'loading') {
    return (
      <View style={s.screen}>
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      </View>
    );
  }

  if (state === 'notfound') {
    return (
      <View style={s.screen}>
        <View style={s.center}>
          <Feather name="help-circle" size={40} color={theme.text.muted} />
          <Text style={s.emptyTitle}>{"This invite code isn't valid"}</Text>
          <Text style={s.emptyText}>Check the code or ask for the link again.</Text>
          <TouchableOpacity style={s.secondaryBtn} onPress={() => setShowSignIn(true)} activeOpacity={0.8}>
            <Text style={s.secondaryText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const meta = preview
    ? [
      `${preview.memberCount} member${preview.memberCount === 1 ? '' : 's'}`,
      `${monthName(currentMonthKey())} open`,
      preview.entryFeeCents > 0 ? `entry ${formatEuros(preview.entryFeeCents)}` : 'no entry fee',
    ].join(' · ')
    : null;
  const admin = preview?.adminFirstName;
  const hcpHelp = `League cap ${cap.toFixed(1)}. ${admin ?? 'The admin'} confirms it; a different number goes to a group vote.`;
  const showErr = (msg) => (submitted ? msg : null);

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <Text style={s.heroOverline}>{admin ? `${admin.toUpperCase()} INVITED YOU` : "YOU'RE INVITED"}</Text>
          <Text style={s.heroName}>{preview?.name ?? 'League invite'}</Text>
          {!!meta && <Text style={s.heroMeta}>{meta}</Text>}
        </View>

        <View style={s.segment} accessibilityRole="tablist">
          {[['new', "I'm new"], ['account', 'I have an account']].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[s.segmentBtn, tab === key && s.segmentBtnActive]}
              onPress={() => switchTab(key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
            >
              <Text style={[s.segmentText, tab === key && s.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.card}>
          {tab === 'account' ? (
            <AuthForm mode="signin" />
          ) : (
            <>
              <GuestIdentityFields
                name={name}
                onChangeName={setName}
                email={email}
                onChangeEmail={setEmail}
                nameError={showErr(nameError)}
                emailError={showErr(emailError)}
              />
              <LabeledField
                label="Handicap"
                placeholder="e.g. 18.4"
                value={hcpText}
                onChangeText={setHcpText}
                keyboardType="decimal-pad"
                error={showErr(hcpError)}
              />
              <Text style={s.help}>{hcpHelp}</Text>

              {error?.kind === 'taken' && (
                <Text style={s.errorText}>
                  That email already has a Golf Partner account.{' '}
                  <Text style={s.errorLink} onPress={() => switchTab('account')} accessibilityRole="link">
                    Log in instead
                  </Text>
                </Text>
              )}
              {error?.kind === 'other' && <Text style={s.errorText}>{error.text}</Text>}
              {archived && <Text style={s.errorText}>{"This league is archived and can't be joined."}</Text>}

              <TouchableOpacity
                style={[s.primaryBtn, (busy || archived) && { opacity: 0.5 }]}
                onPress={handleJoin}
                disabled={busy || archived}
                activeOpacity={0.8}
              >
                {busy && <ActivityIndicator color={theme.text.inverse} style={{ marginRight: 8 }} />}
                <Text style={s.primaryText}>{`Join ${leagueName}`}</Text>
              </TouchableOpacity>
              <Text style={s.note}>We email you a link to keep the account and sign in on other devices.</Text>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 20, paddingBottom: 40, width: '100%', maxWidth: 460, alignSelf: 'center' },
    emptyTitle: { fontFamily: 'PlayfairDisplay-Bold', color: theme.text.primary, fontSize: 22, marginTop: 14, textAlign: 'center' },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginTop: 6, marginBottom: 18, textAlign: 'center' },

    hero: { backgroundColor: theme.bg.deep, borderRadius: 20, padding: 20, marginBottom: 16 },
    heroOverline: { fontFamily: 'PlusJakartaSans-Bold', color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: 1.6 },
    heroName: { fontFamily: 'PlayfairDisplay-Bold', color: '#ffffff', fontSize: 26, letterSpacing: -0.3, marginTop: 6 },
    heroMeta: { fontFamily: 'PlusJakartaSans-SemiBold', color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 10 },

    segment: {
      flexDirection: 'row', backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 4,
      marginBottom: 16, borderWidth: 1, borderColor: theme.border.default,
    },
    segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
    segmentBtnActive: { backgroundColor: theme.bg.card, ...(theme.isDark ? {} : theme.shadow?.card) },
    segmentText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 13 },
    segmentTextActive: { color: theme.text.primary },

    card: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder, padding: 16,
    },
    help: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17,
      marginTop: -4, marginBottom: 16,
    },
    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, lineHeight: 17, marginBottom: 10 },
    errorLink: { color: theme.accent.primary, textDecorationLine: 'underline' },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.primary, borderRadius: 14, paddingVertical: 15,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 14 },
    note: {
      fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, lineHeight: 17,
      textAlign: 'center', marginTop: 12,
    },
    secondaryBtn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 28,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
  });
}
