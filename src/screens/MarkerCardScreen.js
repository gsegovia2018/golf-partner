// Public marker page (/m/<token>) — docs/superpowers/plans/2026-10-04-league.md
// §1 L5 and §4.3 "Marker page". A member's marker doesn't use the app: they
// scan a QR, see the card in the existing scorecard grid, type their name and
// confirm it (or send it back with a note).
//
// Rendered like SharedBoardScreen: bare and pre-session from App.js's
// `!session` branch with a `token` prop, or as the routed `MarkerCard` screen
// with `route.params.token` for a signed-in visitor. It never touches a
// navigation hook, and it talks to the network only through markerCardStore
// (the two anon-granted RPCs) — never the member store.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { ScorecardTable } from '../components/scorecard/GridView';
import { useTheme } from '../theme/ThemeContext';
import { getMarkerCard, confirmMarkerCard } from '../store/markerCardStore';

// Text on the green top bar. The bar is the brand accent in both themes, so
// its text can't come from theme.text (which flips per theme).
const ON_GREEN = '#ffffff';
const ON_GREEN_SOFT = '#e6f0eb';

const ROW_ID = 'marker-card';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// played_on is a calendar date ('2026-10-04'); parse it as local so the day
// never shifts with the viewer's time zone. "Sat 4 Oct".
export function formatPlayedOn(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The RPC always returns holes 1-18; a nine-hole card has no par past 9.
// Builds the `round`/`players`/`scores` ScorecardTable expects for one row.
export function buildMarkerTable(card) {
  const holes = (card.holes ?? [])
    .filter((h) => h.par != null)
    .map((h) => ({ number: h.n, par: h.par, strokeIndex: h.si }));
  const handicap = card.playingHandicap ?? 0;
  const scores = {};
  for (const h of card.holes ?? []) {
    if (h.par != null && h.strokes != null) scores[h.n] = h.strokes;
  }
  return {
    round: { holes, playerHandicaps: { [ROW_ID]: handicap } },
    players: [{ id: ROW_ID, name: card.playerFirstName || 'Player', handicap }],
    scores: { [ROW_ID]: scores },
  };
}

function metaLine(card) {
  return [
    card.course,
    formatPlayedOn(card.date),
    card.tee ? `${card.tee} tees` : null,
    card.slope != null && card.rating != null ? `slope ${card.slope} · CR ${card.rating}` : null,
    card.playingHandicap != null ? `Playing handicap ${card.playingHandicap}` : null,
  ].filter(Boolean).join(' · ');
}

// Dead-end states, keyed by the server's error word or the submit result.
const STATE_COPY = {
  invalid: {
    icon: 'link', tone: 'muted',
    title: "This code isn't valid",
    body: 'Check that the whole link came through, or ask the player to show their code again.',
  },
  expired: {
    icon: 'alert-circle', tone: 'warning',
    title: 'This code has expired',
    body: 'Marker codes last 2 hours and work once. Ask the player to show a new one from their card. It takes a second.',
  },
  used: {
    icon: 'check-circle', tone: 'muted',
    title: 'This code was already used.',
    body: "Codes work once. If you confirmed this card, you're done, thank you.",
  },
  changed: {
    icon: 'alert-circle', tone: 'warning',
    title: 'The card changed — ask for a new code',
    body: 'The player edited the card after showing this code, so it no longer matches what you would sign.',
  },
};

export default function MarkerCardScreen(props) {
  const token = props.token ?? props.route?.params?.token;
  const { theme } = useTheme();
  const s = makeStyles(theme);

  // phase: 'loading' | 'ready' | 'error' (network) | a STATE_COPY key |
  // 'confirmed' | 'returned'
  const [phase, setPhase] = useState('loading');
  const [card, setCard] = useState(null);
  const [name, setName] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
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
      setPhase(STATE_COPY[e?.reason] ? e.reason : 'error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const trimmedName = name.trim();

  const submit = async (ok) => {
    if (busyRef.current || !trimmedName) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      const { status } = await confirmMarkerCard(token, trimmedName, ok, ok ? null : (note.trim() || null));
      if (!mountedRef.current) return;
      setPhase(status === 'returned' ? 'returned' : 'confirmed');
    } catch (e) {
      if (!mountedRef.current) return;
      if (STATE_COPY[e?.reason]) setPhase(e.reason);
      else setSubmitError(e?.message || 'Something went wrong. Try again.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const topBar = (
    <View style={s.topBar}>
      <Text style={s.brand}>Golf Partner</Text>
      <Text style={s.topBarSub}>Marker confirmation</Text>
    </View>
  );

  const message = ({ icon, tone, title, body, action }) => (
    <View style={s.message}>
      <Feather
        name={icon}
        size={28}
        color={tone === 'warning' ? theme.semantic.conflict.base
          : tone === 'good' ? theme.accent.primary : theme.text.muted}
      />
      <Text style={s.messageTitle}>{title}</Text>
      {body ? <Text style={s.messageBody}>{body}</Text> : null}
      {action}
    </View>
  );

  let body;
  if (phase === 'loading') {
    body = (
      <View style={s.center}>
        <ActivityIndicator size="large" color={theme.accent.primary} />
      </View>
    );
  } else if (phase === 'error') {
    body = message({
      icon: 'wifi-off', tone: 'muted',
      title: "Couldn't load this card",
      body: 'Check your connection and try again.',
      action: (
        <TouchableOpacity style={[s.secondaryBtn, s.retryBtn]} onPress={load} accessibilityRole="button">
          <Text style={s.secondaryText}>Try again</Text>
        </TouchableOpacity>
      ),
    });
  } else if (STATE_COPY[phase]) {
    body = message(STATE_COPY[phase]);
  } else if (phase === 'confirmed') {
    body = message({
      icon: 'check-circle', tone: 'good',
      title: 'Thank you',
      body: `${card?.playerFirstName ? `${card.playerFirstName}'s card` : 'The card'} is confirmed with your name. You can close this page.`,
    });
  } else if (phase === 'returned') {
    body = message({
      icon: 'send', tone: 'good',
      title: 'Note sent',
      body: `The card went back to ${card?.playerFirstName || 'the player'} with your note. They can fix it and show you a new code.`,
    });
  } else {
    const table = buildMarkerTable(card);
    const firstName = card.playerFirstName || 'Player';
    body = (
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.heading}>
          <Text style={s.title}>{`Confirm ${firstName}'s card`}</Text>
          <Text style={s.meta}>{metaLine(card)}</Text>
        </View>

        <ScorecardTable
          round={table.round}
          players={table.players}
          scores={table.scores}
          onSetScore={() => {}}
          editable={() => false}
          mode="stableford"
          meId={ROW_ID}
          rowLabel={firstName.slice(0, 3).toUpperCase()}
        />

        <View style={s.form}>
          <Text style={s.label} nativeID="marker-name-label">Your name</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="First and last name"
            placeholderTextColor={theme.text.muted}
            accessibilityLabel="Your name"
            accessibilityLabelledBy="marker-name-label"
            autoCapitalize="words"
            autoComplete="name"
            maxLength={80}
            editable={!busy}
          />

          {noteOpen && (
            <>
              <Text style={s.label} nativeID="marker-note-label">{"What's wrong?"}</Text>
              <TextInput
                style={[s.input, s.noteInput]}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Hole 7 was a 6, not a 5"
                placeholderTextColor={theme.text.muted}
                accessibilityLabel="What's wrong?"
                accessibilityLabelledBy="marker-note-label"
                multiline
                maxLength={500}
                editable={!busy}
              />
            </>
          )}

          {submitError ? <Text style={s.error}>{submitError}</Text> : null}

          {noteOpen ? (
            <>
              <TouchableOpacity
                style={[s.primaryBtn, (!trimmedName || busy) && s.disabled]}
                onPress={() => submit(false)}
                disabled={!trimmedName || busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: !trimmedName || busy }}
              >
                {busy ? <ActivityIndicator color={theme.text.inverse} />
                  : <Text style={s.primaryText}>{`Send back to ${firstName}`}</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => { setNoteOpen(false); setSubmitError(null); }}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={s.secondaryText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[s.primaryBtn, (!trimmedName || busy) && s.disabled]}
                onPress={() => submit(true)}
                testID="marker-confirm"
                disabled={!trimmedName || busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: !trimmedName || busy }}
              >
                {busy ? <ActivityIndicator color={theme.text.inverse} />
                  : <Text style={s.primaryText}>Confirm card</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => { setNoteOpen(true); setSubmitError(null); }}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={s.secondaryText}>{"Something's wrong"}</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={s.footnote}>
            {`You're confirming the strokes shown; ${card.playerFirstName ? `${card.playerFirstName}'s` : 'the'} league result is worked out from them once you do. No account needed. This code works once.`}
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScreenContainer style={s.screen} edges={['top', 'bottom']}>
      {topBar}
      {body}
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const green = theme.isDark ? theme.bg.deep : theme.accent.primary;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg.primary },
    topBar: {
      backgroundColor: green, paddingHorizontal: 16, paddingVertical: 14,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    brand: { fontFamily: 'PlayfairDisplay-Black', fontSize: 18, color: ON_GREEN },
    topBarSub: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: ON_GREEN_SOFT },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 32, gap: 12 },
    heading: { paddingHorizontal: 2 },
    title: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 24, lineHeight: 30, color: theme.text.primary,
    },
    meta: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17,
      color: theme.text.secondary, marginTop: 4,
    },
    form: { gap: 10, marginTop: 4, width: '100%', maxWidth: 560, alignSelf: 'center' },
    label: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12, color: theme.text.primary },
    input: {
      minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: theme.border.default,
      borderRadius: 10, backgroundColor: theme.bg.card, color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-Regular', fontSize: 14,
    },
    noteInput: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
    error: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, color: theme.destructive },
    primaryBtn: {
      minHeight: 50, borderRadius: 14, backgroundColor: theme.accent.primary,
      alignItems: 'center', justifyContent: 'center', padding: 14, ...theme.shadow.accent,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.inverse },
    secondaryBtn: {
      minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: theme.border.default,
      backgroundColor: theme.bg.card, alignItems: 'center', justifyContent: 'center', padding: 14,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.accent.primary },
    retryBtn: { alignSelf: 'stretch', marginTop: 4 },
    disabled: { opacity: 0.5 },
    footnote: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, lineHeight: 17,
      color: theme.text.secondary, textAlign: 'center',
    },
    message: {
      paddingHorizontal: 20, paddingVertical: 28, gap: 14,
      width: '100%', maxWidth: 560, alignSelf: 'center',
    },
    messageTitle: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 24, lineHeight: 30, color: theme.text.primary,
    },
    messageBody: {
      fontFamily: 'PlusJakartaSans-Medium', fontSize: 14, lineHeight: 21, color: theme.text.primary,
    },
  });
}
