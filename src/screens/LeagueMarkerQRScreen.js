// "Show QR to marker" — docs/superpowers/plans/2026-10-04-league.md §1 L5,
// §4.3 Validate. The member's submitted card gets a one-time, 2 h marker code;
// the QR opens the public marker page (/m/<token>, MarkerCardScreen) in the
// marker's phone browser. A new code voids the previous one server-side.
// Route `LeagueMarkerQR`, params `{ cardId, leagueId }` (from LeagueValidate).
// While open it polls the card; once the marker confirms, the QR gives way to
// the confirmed state and a way back to the board. If the marker sends it back
// instead, their note shows with a way to Validate (fix it, submit again).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ScreenContainer from '../components/ScreenContainer';
import { buttonStyles } from '../components/ui/Buttons';
import ScreenHeader from '../components/ui/ScreenHeader';
import { useTheme } from '../theme/ThemeContext';
import { createMarkerToken, getLeagueCard } from '../store/leagueStore';
import { needsApproval } from '../store/leagueRules';
import { shareOrigin } from '../lib/shareOrigin';
import { useT } from '../i18n';
import { leagueErrorText } from '../lib/leagueErrorText';

export function markerLink(token) {
  return `${shareOrigin()}/m/${encodeURIComponent(token)}`;
}

// Countdown label: m:ss under an hour, h:mm:ss above it (codes last 2 h).
export const POLL_MS = 5000;

export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export default function LeagueMarkerQRScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const cardId = route?.params?.cardId;
  const leagueId = route?.params?.leagueId;

  const [code, setCode] = useState(null); // { token, expiresAt }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmedCard, setConfirmedCard] = useState(null);
  const [returnedCard, setReturnedCard] = useState(null);
  // The card's returnedAt before this code was shown (Validate passes it; else
  // the first read sets it): a different one is a new send-back.
  const knownReturn = useRef(route?.params?.returnedAt);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const newCode = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await createMarkerToken(cardId);
      if (!mountedRef.current) return;
      setCode(next);
      setNow(Date.now());
    } catch (e) {
      if (mountedRef.current) setError(leagueErrorText(e) || t('league.markerQr.createFailed'));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [cardId, t]);

  useEffect(() => { newCode(); }, [newCode]);

  const settled = !!confirmedCard || !!returnedCard;
  useEffect(() => {
    if (!code || settled) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code, settled]);

  // Watch for the marker's answer: confirmed, or sent back (a new returnedAt
  // on a still-submitted card). A failed read (no signal) is simply tried
  // again on the next tick.
  useEffect(() => {
    if (!cardId || settled) return undefined;
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const c = await getLeagueCard(cardId);
        if (!mountedRef.current || !c) return;
        if (c.status === 'confirmed') setConfirmedCard(c);
        else if (knownReturn.current === undefined) knownReturn.current = c.returnedAt ?? null;
        else if (c.status === 'submitted' && c.returnedAt && c.returnedAt !== knownReturn.current) setReturnedCard(c);
      } catch { /* next tick */ } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [cardId, settled]);

  // The same one-time link as the QR, for a marker who is not next to me.
  async function sendLink() {
    if (!code || expired) return;
    try {
      await Share.share({ message: t('league.markerQr.shareMessage', { link: markerLink(code.token) }) });
    } catch (e) {
      setError(e?.message || t('league.markerQr.shareFailed'));
    }
  }

  const goBoard = () => navigation.navigate('LeagueBoard', { leagueId: leagueId ?? confirmedCard?.leagueId });
  // A fresh Validate on the submitted card: it shows the note, Edit in
  // scorecard and the ways to get it confirmed again.
  const openValidate = () => navigation.replace('LeagueValidate', {
    leagueId: leagueId ?? returnedCard?.leagueId,
    cardId,
    tournamentId: returnedCard?.tournamentId,
    roundId: returnedCard?.roundId,
    submitted: true,
  });

  const expiresAtMs = code ? new Date(code.expiresAt).getTime() : null;
  const remaining = expiresAtMs != null ? expiresAtMs - now : 0;
  const expired = code != null && remaining <= 0;

  let body;
  if (confirmedCard) {
    body = (
      <View style={s.confirmedBlock}>
        <Feather name="check-circle" size={40} color={theme.accent.primary} />
        <Text style={s.errorTitle}>{t('league.markerQr.confirmedTitle')}</Text>
        <Text style={s.errorText}>
          {needsApproval(confirmedCard) ? t('league.validate.confirmedAwaitingAdmin')
            : confirmedCard.confirmedByName
              ? t('league.markerQr.confirmedBy', { name: confirmedCard.confirmedByName })
              : t('league.markerQr.confirmedByMarker')}
        </Text>
        <TouchableOpacity style={s.primaryBtn} onPress={goBoard} accessibilityRole="button" activeOpacity={0.8}>
          <Text style={s.primaryText}>{t('league.markerQr.backToLeague')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (returnedCard) {
    body = (
      <View style={s.confirmedBlock}>
        <Feather name="message-circle" size={40} color={theme.text.secondary} />
        <Text style={s.errorTitle}>{t('league.markerQr.returnedTitle')}</Text>
        <Text style={s.errorText}>{returnedCard.markerNote || t('league.markerQr.returnedNoNote')}</Text>
        <TouchableOpacity style={s.primaryBtn} onPress={openValidate} accessibilityRole="button" activeOpacity={0.8}>
          <Text style={s.primaryText}>{t('league.markerQr.reviewCard')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (loading && !code) {
    body = <ActivityIndicator style={s.spinner} color={theme.accent.primary} />;
  } else if (!code) {
    body = (
      <View style={s.errorBlock}>
        <Text style={s.errorTitle}>{t('league.markerQr.couldntCreate')}</Text>
        <Text style={s.errorText}>{error}</Text>
      </View>
    );
  } else {
    body = (
      <>
        <View style={[s.qrWrap, expired && s.qrExpired]} accessibilityLabel={t('league.markerQr.qrLabel')}>
          <QRCode value={markerLink(code.token)} size={208} backgroundColor="#ffffff" color="#000000" />
        </View>
        <Text style={s.expiry}>
          {expired ? t('league.markerQr.expired') : t('league.markerQr.expires', { time: formatCountdown(remaining) })}
        </Text>
        <TouchableOpacity
          style={[s.secondaryBtn, expired && s.disabled]}
          onPress={sendLink}
          disabled={expired}
          accessibilityRole="button"
        >
          <Text style={s.secondaryText}>{t('league.markerQr.sendLink')}</Text>
        </TouchableOpacity>
        {error ? <Text style={s.inlineError}>{error}</Text> : null}
      </>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <ScreenHeader onBack={() => navigation.goBack()} title={t('league.markerQr.title')} />
      <ScrollView contentContainerStyle={s.content}>
        {!returnedCard && (
          <>
            <View style={s.titleRow}>
              <Feather name="smartphone" size={18} color={theme.text.primary} />
              <Text style={s.title}>{t('league.markerQr.heading')}</Text>
            </View>
            <Text style={s.subtitle}>{t('league.markerQr.subtitle')}</Text>
          </>
        )}
        {body}
        {!settled && (
          <TouchableOpacity
            style={[s.secondaryBtn, loading && s.disabled]}
            onPress={newCode}
            disabled={loading}
            accessibilityRole="button"
          >
            {loading && code ? <ActivityIndicator color={theme.accent.primary} />
              : <Text style={s.secondaryText}>{t('league.markerQr.newCode')}</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const btn = buttonStyles(theme);
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    content: { padding: 16, paddingBottom: 40, gap: 12, width: '100%', maxWidth: 480, alignSelf: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary },
    subtitle: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, lineHeight: 18, color: theme.text.secondary, marginBottom: 4,
    },
    spinner: { paddingVertical: 100 },
    qrWrap: {
      alignSelf: 'center', padding: 16, backgroundColor: '#ffffff',
      borderWidth: 1, borderColor: theme.border.default, borderRadius: 16,
    },
    qrExpired: { opacity: 0.25 },
    expiry: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.secondary, textAlign: 'center',
    },
    inlineError: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.destructive, textAlign: 'center' },
    errorBlock: { paddingVertical: 32, alignItems: 'center', gap: 6 },
    confirmedBlock: { paddingVertical: 32, alignItems: 'center', gap: 10 },
    primaryBtn: { ...btn.primaryBtn, alignSelf: 'stretch', marginTop: 12 },
    primaryText: btn.primaryText,
    errorTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 18, lineHeight: 24, color: theme.text.primary, textAlign: 'center' },
    errorText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.secondary, textAlign: 'center' },
    secondaryBtn: { ...btn.secondaryBtn, backgroundColor: theme.bg.card },
    secondaryText: btn.secondaryTextAccent,
    disabled: { opacity: 0.5 },
  });
}
