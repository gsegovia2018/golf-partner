// "Show QR to marker" — docs/superpowers/plans/2026-10-04-league.md §1 L5,
// §4.3 Validate. The member's submitted card gets a one-time, 2 h marker code;
// the QR opens the public marker page (/m/<token>, MarkerCardScreen) in the
// marker's phone browser. A new code voids the previous one server-side.
// Route `LeagueMarkerQR`, params `{ cardId, leagueId }` (from LeagueValidate).
// While open it polls the card; once the marker confirms, the QR gives way to
// the confirmed state and a way back to the board.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { useTheme } from '../theme/ThemeContext';
import { createMarkerToken, getLeagueCard } from '../store/leagueStore';
import { shareOrigin } from '../lib/shareOrigin';

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
  const s = makeStyles(theme);
  const cardId = route?.params?.cardId;
  const leagueId = route?.params?.leagueId;

  const [code, setCode] = useState(null); // { token, expiresAt }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmedCard, setConfirmedCard] = useState(null);
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
      if (mountedRef.current) setError(e?.message || 'Could not create a code.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [cardId]);

  useEffect(() => { newCode(); }, [newCode]);

  useEffect(() => {
    if (!code || confirmedCard) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code, confirmedCard]);

  // Watch for the marker's confirmation. A failed read (no signal) is simply
  // tried again on the next tick.
  useEffect(() => {
    if (!cardId || confirmedCard) return undefined;
    let inFlight = false;
    const id = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const c = await getLeagueCard(cardId);
        if (mountedRef.current && c?.status === 'confirmed') setConfirmedCard(c);
      } catch { /* next tick */ } finally {
        inFlight = false;
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [cardId, confirmedCard]);

  const goBoard = () => navigation.navigate('LeagueBoard', { leagueId: leagueId ?? confirmedCard?.leagueId });

  const expiresAtMs = code ? new Date(code.expiresAt).getTime() : null;
  const remaining = expiresAtMs != null ? expiresAtMs - now : 0;
  const expired = code != null && remaining <= 0;

  let body;
  if (confirmedCard) {
    body = (
      <View style={s.confirmedBlock}>
        <Feather name="check-circle" size={40} color={theme.accent.primary} />
        <Text style={s.errorTitle}>Card confirmed</Text>
        <Text style={s.errorText}>
          {confirmedCard.confirmedByName
            ? `${confirmedCard.confirmedByName} confirmed your card. It counts.`
            : 'Your marker confirmed your card. It counts.'}
        </Text>
        <TouchableOpacity style={s.primaryBtn} onPress={goBoard} accessibilityRole="button" activeOpacity={0.8}>
          <Text style={s.primaryText}>Back to the league</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (loading && !code) {
    body = <ActivityIndicator style={s.spinner} color={theme.accent.primary} />;
  } else if (!code) {
    body = (
      <View style={s.errorBlock}>
        <Text style={s.errorTitle}>{"Couldn't create a code"}</Text>
        <Text style={s.errorText}>{error}</Text>
      </View>
    );
  } else {
    body = (
      <>
        <View style={[s.qrWrap, expired && s.qrExpired]} accessibilityLabel="Marker QR code">
          <QRCode value={markerLink(code.token)} size={208} backgroundColor="#ffffff" color="#000000" />
        </View>
        <Text style={s.expiry}>
          {expired ? 'This code expired · get a new one' : `Expires in ${formatCountdown(remaining)} · works once`}
        </Text>
        {error ? <Text style={s.inlineError}>{error}</Text> : null}
      </>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={() => navigation.goBack()} accessibilityLabel="Back" />
        <Text style={s.headerTitle}>Show QR to marker</Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.titleRow}>
          <Feather name="smartphone" size={18} color={theme.text.primary} />
          <Text style={s.title}>Ask your marker to scan</Text>
        </View>
        <Text style={s.subtitle}>Ask your marker to scan this with their camera. No app needed.</Text>
        {body}
        {!confirmedCard && (
          <TouchableOpacity
            style={[s.secondaryBtn, loading && s.disabled]}
            onPress={newCode}
            disabled={loading}
            accessibilityRole="button"
          >
            {loading && code ? <ActivityIndicator color={theme.accent.primary} />
              : <Text style={s.secondaryText}>New code</Text>}
          </TouchableOpacity>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 4 },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3 },
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
    primaryBtn: {
      alignSelf: 'stretch', minHeight: 52, borderRadius: 14, backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center', padding: 14, marginTop: 12,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme.text.inverse },
    errorTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary, textAlign: 'center' },
    errorText: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 13, color: theme.text.secondary, textAlign: 'center' },
    secondaryBtn: {
      minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
      backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center', padding: 14,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.accent.primary },
    disabled: { opacity: 0.5 },
  });
}
