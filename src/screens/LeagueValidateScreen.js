import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import { ScorecardTable } from '../components/scorecard/GridView';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { fetchTournament } from '../store/tournamentRepo';
import { readLocal } from '../store/tournamentStore';
import { submitLeagueCard, confirmLeagueCardByPartner } from '../store/leagueStore';
import { scoreCard, cardMonth } from '../store/leagueRules';
import { monthName } from '../store/leagueView';

// Plain words for confirm_league_card_by_partner's refusals.
export const PARTNER_REASONS = {
  no_partner: 'Nobody else signed in to the app marked all 18 of your holes.',
  not_settled: 'Some of your holes have not reached the server yet. Wait a moment and check again.',
  snapshot_mismatch: 'The scores on the server changed since you submitted. Check again to resubmit them.',
  not_your_player: 'Your player in this game is not linked to your account.',
};

// A route another build item adds later (P7 marker QR, P8 proof upload).
function hasRoute(navigation, name) {
  return !!navigation.getState?.()?.routeNames?.includes(name);
}

// Server first (game_scores are what the partner check reads), local copy
// when offline so the card can still be looked at.
async function loadTournament(id) {
  try {
    const t = await fetchTournament(id);
    if (t) return t;
  } catch { /* offline: fall back to the local copy */ }
  return readLocal(id);
}

// After Finish on a league round: my card in the existing grid, read-only,
// then Submit → partner confirmation, or the fallbacks when it can't be.
export default function LeagueValidateScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const { user } = useAuth();
  const { leagueId, cardId, tournamentId, roundId } = route?.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // null (not submitted yet) | { confirmed, reason, partnerName, settled }
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    const t = await loadTournament(tournamentId);
    setTournament(t);
    setLoading(false);
    return t;
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  const card = useMemo(() => {
    const round = tournament?.rounds?.find((r) => r.id === roundId);
    if (!round) return null;
    const players = tournament.players ?? [];
    const lg = tournament.league ?? tournament.props?.league ?? null;
    const player = players.find((p) => p.id === lg?.playerId)
      ?? players.find((p) => p.user_id && p.user_id === user?.id)
      ?? null;
    if (!player) return null;
    const strokes = round.scores?.[player.id] ?? {};
    const holes = [...(round.holes ?? [])].sort((a, b) => a.number - b.number);
    const override = round.playerIndexes?.[player.id];
    const leagueHandicap = override != null && override !== '' ? Number(override) : player.handicap;
    const { gross, points, playingHandicap } = scoreCard({
      holes: strokes,
      course: { holes },
      leagueHandicap,
      tee: round.playerTees?.[player.id] ?? null,
    });
    const snapshot = {};
    const missing = [];
    for (const h of holes) {
      const v = strokes[h.number];
      if (v == null || v === '') missing.push(h.number);
      else snapshot[String(h.number)] = Number(v);
    }
    const roundNumber = tournament.rounds.indexOf(round) + 1;
    return { round, roundNumber, player, strokes, gross, points, playingHandicap, snapshot, missing };
  }, [tournament, roundId, user?.id]);

  async function submitAndConfirm() {
    if (!card || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitLeagueCard({
        cardId,
        holes: card.snapshot,
        gross: card.gross,
        points: card.points,
        playingHandicap: card.playingHandicap,
        // The server keeps the date it stamped at the announce.
        playedOn: null,
      });
      setResult(await confirmLeagueCardByPartner(cardId));
    } catch (e) {
      setError(e?.message ?? 'Could not submit the card.');
    } finally {
      setBusy(false);
    }
  }

  // Not settled / changed: read the server again, then resubmit (allowed
  // while the card is 'submitted') and re-run the partner check.
  async function checkAgain() {
    setResult(null);
    await load();
  }

  const month = monthName(cardMonth(new Date()));
  const goBoard = () => navigation.replace('LeagueBoard', { leagueId });

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={goBoard} accessibilityLabel="Back" />
      <Text style={s.headerTitle} numberOfLines={1}>{`${month} card`}</Text>
    </View>
  );

  if (loading || !card) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Text style={s.emptyText}>This round could not be loaded.</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={load} activeOpacity={0.8}>
                <Text style={s.secondaryText}>Try again</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const { round, roundNumber, player, strokes, playingHandicap, missing } = card;
  const confirmed = !!result?.confirmed;

  const fallback = (icon, title, sub, routeName, params, todo) => {
    const ready = hasRoute(navigation, routeName);
    return (
      <TouchableOpacity
        key={routeName + title}
        style={[s.fallbackRow, !ready && s.disabled]}
        // TODO(P7/P8): routeName is registered by a later build item; until
        // then the row is shown but does nothing.
        onPress={ready ? () => navigation.navigate(routeName, params) : undefined}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
      >
        <Feather name={icon} size={18} color={theme.accent.primary} style={{ marginRight: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.fallbackTitle}>{title}</Text>
          <Text style={s.fallbackSub}>{ready ? sub : `${sub} · coming soon (${todo})`}</Text>
        </View>
        {ready && <Feather name="chevron-right" size={18} color={theme.text.muted} />}
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={s.content}>
        {confirmed && (
          <View style={s.statusCard}>
            <Feather name="check-circle" size={18} color={theme.accent.primary} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>
                {`${result.partnerName || 'Your partner'} confirmed ${result.settled ?? 18} of 18 holes in the app`}
              </Text>
              <Text style={s.statusSub}>Your card counts. The league has been told.</Text>
            </View>
          </View>
        )}

        {result && !confirmed && (
          <View style={[s.statusCard, s.statusWarn]}>
            <Feather name="alert-circle" size={18} color={theme.text.secondary} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>Submitted · not confirmed yet</Text>
              <Text style={s.statusSub}>{PARTNER_REASONS[result.reason] ?? 'The card could not be confirmed in the app.'}</Text>
            </View>
          </View>
        )}

        <Text style={s.courseTitle} numberOfLines={1}>{`${round.courseName} · Round ${roundNumber}`}</Text>
        <ScorecardTable
          round={round}
          players={[player]}
          scores={{ [player.id]: strokes }}
          editable={() => false}
          mode="stableford"
          meId={player.id}
          handicapsOverride={{ [player.id]: playingHandicap }}
        />

        {missing.length > 0 && !result && (
          <Text style={s.errorText}>
            {`Every hole needs a score before the card can be submitted. Missing: ${missing.join(', ')}.`}
          </Text>
        )}
        {!!error && <Text style={s.errorText}>{error}</Text>}

        {result && !confirmed && (
          <>
            {(result.reason === 'not_settled' || result.reason === 'snapshot_mismatch') && (
              <TouchableOpacity style={s.secondaryBtn} onPress={checkAgain} activeOpacity={0.8}>
                <Text style={s.secondaryText}>Check again</Text>
              </TouchableOpacity>
            )}
            <Text style={s.overline}>MARKER NOT IN THE APP?</Text>
            <View style={s.fallbackList}>
              {fallback('maximize', 'Show QR to your marker', 'They confirm in their phone browser',
                'LeagueMarkerQR', { leagueId, cardId }, 'P7')}
              {fallback('camera', 'Upload signed paper card', 'A photo of the card your marker signed',
                'LeagueAddProof', { leagueId, cardId, kind: 'photo' }, 'P8')}
              {fallback('award', 'Official tournament result', 'A screenshot or photo of the official result',
                'LeagueAddProof', { leagueId, cardId, kind: 'official' }, 'P8')}
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        {confirmed || (result && !confirmed && result.reason !== 'not_settled' && result.reason !== 'snapshot_mismatch') ? (
          <TouchableOpacity style={s.primaryBtn} onPress={goBoard} activeOpacity={0.8}>
            <Text style={s.primaryText}>{confirmed ? 'Done' : 'Back to the league'}</Text>
          </TouchableOpacity>
        ) : (
          <>
            {!result && <Text style={s.footnote}>Once you submit, the card counts straight away.</Text>}
            <TouchableOpacity
              style={[s.primaryBtn, (busy || missing.length > 0) && s.disabled]}
              onPress={submitAndConfirm}
              disabled={busy || missing.length > 0}
              activeOpacity={0.8}
            >
              {busy
                ? <ActivityIndicator color={theme.text.inverse} />
                : <Text style={s.primaryText}>{result ? 'Submit again' : 'Submit card'}</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

function makeStyles(theme) {
  const cardBorder = theme.isDark ? theme.glass?.border : theme.border.default;
  return StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
    headerTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 17, letterSpacing: -0.3, flexShrink: 1 },
    content: { padding: 14, paddingBottom: 24 },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 13, marginBottom: 16, textAlign: 'center' },

    statusCard: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.bg.card, borderRadius: 16,
      borderWidth: 1, borderColor: cardBorder, padding: 14, marginBottom: 16,
    },
    statusWarn: { backgroundColor: theme.bg.secondary },
    statusTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14, lineHeight: 19 },
    statusSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 16, marginTop: 2 },

    courseTitle: {
      fontFamily: 'PlayfairDisplay-Bold', color: theme.accent.primary, fontSize: 16, letterSpacing: -0.3, marginBottom: 12,
    },
    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginTop: 12 },

    overline: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11, letterSpacing: 1.8,
      marginTop: 20, marginBottom: 8,
    },
    fallbackList: { backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder, overflow: 'hidden' },
    fallbackRow: {
      flexDirection: 'row', alignItems: 'center', padding: 14, minHeight: 48,
      borderBottomWidth: 1, borderBottomColor: theme.border.subtle,
    },
    fallbackTitle: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary, fontSize: 14 },
    fallbackSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, marginTop: 2 },

    footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: theme.border.subtle },
    footnote: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 12, textAlign: 'center', marginBottom: 10 },
    primaryBtn: {
      alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary,
      borderRadius: 14, paddingVertical: 16, minHeight: 52,
    },
    primaryText: { fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse, fontSize: 15 },
    secondaryBtn: {
      alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 28, marginTop: 12,
    },
    secondaryText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 14 },
    disabled: { opacity: 0.5 },
  });
}
