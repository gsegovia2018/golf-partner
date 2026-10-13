import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PersonAvatar from '../components/ui/PersonAvatar';
import { useTheme } from '../theme/ThemeContext';
import { getMarkerCard, confirmMarkerCard } from '../store/markerCardStore';
import { monthName } from '../store/leagueView';
import { formatPlayedOn } from './MarkerCardScreen';

// Plain words for the single-word errors the marker RPCs raise.
export const MARKER_STATE_COPY = {
  invalid: 'This request was cancelled or the card changed. Nothing to do.',
  changed: 'This request was cancelled or the card changed. Nothing to do.',
  expired: 'This request expired.',
  used: 'Already answered.',
};

// A member opens "<owner> asks you to confirm a card" (push or inbox): the
// 18 holes, one tap to confirm as the signed-in account, or a tap on a hole
// to send it back with a correction. Route params: { token }.
export default function LeagueMarkerConfirmScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const token = route?.params?.token;

  // phase: 'loading' | 'error' (offline) | 'ready' | 'flag' | a MARKER_STATE_COPY key | 'confirmed' | 'returned'
  const [phase, setPhase] = useState('loading');
  const [card, setCard] = useState(null);
  const [hole, setHole] = useState(null);
  const [fix, setFix] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    if (!token) { setPhase('invalid'); return; }
    setPhase('loading');
    try {
      const data = await getMarkerCard(token);
      if (!mountedRef.current) return;
      setCard(data);
      setPhase('ready');
    } catch (e) {
      if (!mountedRef.current) return;
      setPhase(MARKER_STATE_COPY[e?.reason] ? e.reason : 'error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const owner = card?.playerFirstName || 'Player';
  const me = card?.signedInName || '';

  async function send(ok, note = null) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      const { status } = await confirmMarkerCard(token, me, ok, note);
      if (mountedRef.current) setPhase(status === 'returned' ? 'returned' : 'confirmed');
    } catch (e) {
      if (!mountedRef.current) return;
      if (MARKER_STATE_COPY[e?.reason]) setPhase(e.reason);
      else setSubmitError(e?.message || 'Something went wrong. Try again.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const close = () => (navigation.canGoBack?.() ? navigation.goBack() : navigation.navigate('Main'));
  const openHole = (h) => { setHole(h); setFix(h.strokes ?? h.par); setSubmitError(null); setPhase('flag'); };
  const closeFlag = () => { setPhase('ready'); setSubmitError(null); };

  const header = (
    <View style={s.header}>
      <IconButton icon="x" size={22} color={theme.accent.primary} onPress={close} accessibilityLabel="Close" />
    </View>
  );

  const message = (icon, title, extra) => (
    <View style={s.center}>
      <Feather name={icon} size={28} color={theme.text.muted} />
      <Text style={s.messageTitle}>{title}</Text>
      {extra}
    </View>
  );
  const doneBtn = (
    <TouchableOpacity style={[s.primaryBtn, s.wide]} onPress={close} accessibilityRole="button">
      <Text style={s.primaryText}>Done</Text>
    </TouchableOpacity>
  );

  let body;
  if (phase === 'loading') {
    body = <View style={s.center}><ActivityIndicator size="large" color={theme.accent.primary} /></View>;
  } else if (phase === 'error') {
    body = message('wifi-off', "Couldn't load this card. Check your connection and try again.", (
      <TouchableOpacity style={[s.secondaryBtn, s.wide]} onPress={load} accessibilityRole="button">
        <Text style={s.secondaryText}>Try again</Text>
      </TouchableOpacity>
    ));
  } else if (MARKER_STATE_COPY[phase]) {
    body = message('alert-circle', MARKER_STATE_COPY[phase], doneBtn);
  } else if (phase === 'confirmed') {
    body = message('check-circle', `Confirmed. ${owner}'s card counts now.`, doneBtn);
  } else if (phase === 'returned') {
    body = message('send', `Sent back to ${owner}.`, doneBtn);
  } else if (phase === 'flag' && hole) {
    const changed = fix !== hole.strokes;
    body = (
      <View style={s.content}>
        <Text style={s.title}>{`Hole ${hole.n} · par ${hole.par}`}</Text>
        <Text style={s.meta}>{`${owner} wrote ${hole.strokes ?? '—'}. It should be`}</Text>
        <View style={s.stepper}>
          <TouchableOpacity
            style={s.stepBtn}
            onPress={() => setFix((v) => Math.max(1, v - 1))}
            accessibilityRole="button"
            accessibilityLabel="One stroke less"
          >
            <Feather name="minus" size={20} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.stepValue} accessibilityLabel={`Strokes ${fix}`}>{fix}</Text>
          <TouchableOpacity
            style={s.stepBtn}
            onPress={() => setFix((v) => Math.min(20, v + 1))}
            accessibilityRole="button"
            accessibilityLabel="One stroke more"
          >
            <Feather name="plus" size={20} color={theme.accent.primary} />
          </TouchableOpacity>
        </View>
        {!!submitError && <Text style={s.error}>{submitError}</Text>}
        <TouchableOpacity
          style={[s.primaryBtn, (!changed || busy) && s.disabled]}
          onPress={() => send(false, `Hole ${hole.n}: should be ${fix} (card says ${hole.strokes})`)}
          disabled={!changed || busy}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={theme.text.inverse} />
            : <Text style={s.primaryText}>{`Send back to ${owner}`}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.secondaryBtn} onPress={closeFlag} disabled={busy} accessibilityRole="button">
          <Text style={s.secondaryText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    const holes = (card?.holes ?? []).filter((h) => h.par != null);
    const month = monthName(card?.month ?? card?.date);
    const meta = [card?.leagueName, card?.course, card?.tee, formatPlayedOn(card?.date)].filter(Boolean).join(' · ');
    const nines = [holes.slice(0, 9), holes.slice(9, 18)].filter((n) => n.length > 0);
    body = (
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.ownerRow}>
          <PersonAvatar person={{ displayName: owner }} theme={theme} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{`Confirm ${owner}'s ${month ? `${month} ` : ''}card`}</Text>
            {!!meta && <Text style={s.meta}>{meta}</Text>}
          </View>
        </View>
        {nines.map((nine) => (
          <View key={nine[0].n} style={s.nine}>
            {nine.map((h, i) => (
              <TouchableOpacity
                key={h.n}
                style={[s.cell, i > 0 && s.cellEdge]}
                onPress={() => openHole(h)}
                accessibilityRole="button"
                accessibilityLabel={`Hole ${h.n}, par ${h.par}, ${h.strokes ?? 'no score'}. Tap if it's wrong`}
              >
                <Text style={s.holeNo}>{h.n}</Text>
                <Text style={s.strokes}>{h.strokes ?? '–'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <Text style={s.meta}>{`Gross ${card?.gross ?? '—'}. Tap a hole if it's wrong.`}</Text>
        {!!submitError && <Text style={s.error}>{submitError}</Text>}
        <TouchableOpacity
          style={[s.primaryBtn, (busy || !me) && s.disabled]}
          onPress={() => send(true)}
          disabled={busy || !me}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={theme.text.inverse} />
            : <Text style={s.primaryText}>{me ? `Confirm as ${me}` : 'Confirm'}</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      {body}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const line = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    header: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
    content: { padding: 14, paddingBottom: 32, gap: 12 },
    ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, lineHeight: 28, color: theme.text.primary },
    meta: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17, color: theme.text.secondary },
    messageTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, lineHeight: 26, color: theme.text.primary, textAlign: 'center' },
    nine: {
      flexDirection: 'row', borderWidth: 1, borderColor: line, borderRadius: 12,
      overflow: 'hidden', backgroundColor: theme.bg.card,
    },
    cell: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 6, gap: 2 },
    cellEdge: { borderLeftWidth: 1, borderLeftColor: line },
    holeNo: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 10 },
    strokes: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, fontSize: 16 },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginVertical: 8 },
    stepBtn: {
      width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: theme.border.default,
      backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center',
    },
    stepValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 40, color: theme.text.primary, minWidth: 56, textAlign: 'center' },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.destructive },
    wide: { alignSelf: 'stretch' },
    primaryBtn: {
      minHeight: 52, borderRadius: 14, backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center', padding: 14,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15, color: theme.text.inverse },
    secondaryBtn: {
      minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
      backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center', padding: 14,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.accent.primary },
    disabled: { opacity: 0.5 },
  });
}
