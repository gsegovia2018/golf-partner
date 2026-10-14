import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import IconButton from '../components/ui/IconButton';
import PersonAvatar from '../components/ui/PersonAvatar';
import { ScorecardTable } from '../components/scorecard/GridView';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { fetchTournament } from '../store/tournamentRepo';
import { readLocal } from '../store/tournamentStore';
import {
  submitLeagueCard, confirmLeagueCardByPartner, getLeagueMarkerCandidates, requestLeagueMarker,
  remindLeagueMarker, cancelLeagueMarkerRequest, getLeagueCard,
} from '../store/leagueStore';
import { scoreCard, cardMonth } from '../store/leagueRules';
import {
  monthName, formatNetDiffSigned, firstName, markerAskedLine,
} from '../store/leagueView';
import { UNRATED_TEE_PROBLEM } from '../store/leagueOffApp';
import { leagueCardsOf } from '../store/leagueSetup';
import { useT, tr } from '../i18n';
import { leagueErrorText } from '../lib/leagueErrorText';

// Catalogue keys for confirm_league_card_by_partner's refusals.
export const PARTNER_REASONS = {
  no_partner: 'league.validate.reason.noPartner',
  not_settled: 'league.validate.reason.notSettled',
  snapshot_mismatch: 'league.validate.reason.snapshotMismatch',
  not_your_player: 'league.validate.reason.notYourPlayer',
};

// Who to preselect as the marker: the only candidate, else whoever scored most
// of my holes; 'else' (Someone else) when there is nobody to ask.
function defaultPick(candidates) {
  if (candidates.length === 0) return 'else';
  return [...candidates].sort((a, b) => b.marked - a.marked)[0].userId;
}

// A refusal that sends the player to Check again instead of asking a marker.
const RESUBMIT_REASONS = ['not_settled', 'snapshot_mismatch'];

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
// Reopened from the board with `submitted: true` (the card was submitted but
// never confirmed), it skips Submit and runs the partner check straight away.
export default function LeagueValidateScreen({ navigation, route }) {
  const { theme } = useTheme();
  const t = useT();
  const s = makeStyles(theme);
  const { user } = useAuth();
  const {
    leagueId, cardId, tournamentId, roundId, submitted = false,
  } = route?.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // null (not submitted yet) | { confirmed, reason, partnerName, settled }
  const [result, setResult] = useState(null);
  // True while the server already holds this card as 'submitted': the
  // partner check runs without submitting it again.
  const [alreadySubmitted, setAlreadySubmitted] = useState(!!submitted);
  // Pick your marker: candidates the server offers, my open request
  // ({ userId, name, requestedAt, expiresAt, failed? }), and the chip chosen
  // ('else' = Someone else, undefined = not chosen, so the default applies).
  const [candidates, setCandidates] = useState([]);
  const [markersLoaded, setMarkersLoaded] = useState(false);
  const [pending, setPending] = useState(null);
  const [selected, setSelected] = useState(undefined);
  // After "Ask someone else": the picker shows again inside the fallbacks.
  const [markerNote, setMarkerNote] = useState(null);
  const autoChecked = useRef(false);

  const load = useCallback(async () => {
    const loaded = await loadTournament(tournamentId);
    setTournament(loaded);
    setLoading(false);
    return loaded;
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  const card = useMemo(() => {
    const round = tournament?.rounds?.find((r) => r.id === roundId);
    if (!round) return null;
    const players = tournament.players ?? [];
    // This card's player (R16: every member has their own card, any round),
    // then my linked player, then the legacy single link of older games.
    const entry = leagueCardsOf(tournament).find((e) => e.cardId === cardId) ?? null;
    const legacy = tournament.league ?? tournament.props?.league ?? null;
    const player = (entry?.playerId ? players.find((p) => p.id === entry.playerId) : null)
      ?? players.find((p) => p.user_id && p.user_id === user?.id)
      ?? players.find((p) => p.id === legacy?.playerId)
      ?? null;
    if (!player) return null;
    const strokes = round.scores?.[player.id] ?? {};
    const holes = [...(round.holes ?? [])].sort((a, b) => a.number - b.number);
    const override = round.playerIndexes?.[player.id];
    const leagueHandicap = override != null && override !== '' ? Number(override) : player.handicap;
    const {
      gross, points, playingHandicap, rated, adjustedGross, differential, netDifferential,
    } = scoreCard({
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
    return {
      round, roundNumber, player, strokes, gross, points, playingHandicap, snapshot, missing,
      rated, adjustedGross, differential, netDifferential, leagueHandicap: Number(leagueHandicap) || 0,
    };
  }, [tournament, roundId, cardId, user?.id]);

  const checkPartner = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await confirmLeagueCardByPartner(cardId));
    } catch (e) {
      setError(leagueErrorText(e) || t('league.validate.checkFailed'));
    } finally {
      setBusy(false);
    }
  }, [cardId, t]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getLeagueMarkerCandidates(cardId);
        if (!alive) return;
        setCandidates(m?.candidates ?? []);
        setPending(m?.pending ?? null);
      } catch { /* no picker: Someone else is the only chip */ }
      if (alive) setMarkersLoaded(true);
    })();
    return () => { alive = false; };
  }, [cardId]);

  // The note a marker left when they sent the card back (it was only in the
  // push). A failed read just means no note.
  const [returnNote, setReturnNote] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await getLeagueCard(cardId);
        if (alive && c?.status === 'submitted' && c.markerNote) setReturnNote(c.markerNote);
      } catch { /* no note shown */ }
    })();
    return () => { alive = false; };
  }, [cardId]);

  // Reopened for a submitted card: straight to the partner check, unless a
  // marker is already asked (the waiting card is the state to show then).
  useEffect(() => {
    if (!submitted || !markersLoaded || autoChecked.current) return;
    autoChecked.current = true;
    if (!pending) checkPartner();
  }, [submitted, markersLoaded, pending, checkPartner]);

  const pick = selected ?? (markersLoaded ? defaultPick(candidates) : null);
  const picked = candidates.find((c) => c.userId === pick) ?? null;

  // true when the marker was asked; on failure the waiting card says so and
  // Remind tries again.
  async function ask(userId, name) {
    try {
      const r = await requestLeagueMarker(cardId, userId);
      setPending({
        userId, name: r?.markerName ?? name, requestedAt: new Date().toISOString(), expiresAt: r?.expiresAt ?? null,
      });
      return true;
    } catch {
      setPending({ userId, name, requestedAt: null, expiresAt: null, failed: true });
      return false;
    }
  }

  async function remind() {
    setMarkerNote(null);
    setBusy(true);
    try {
      if (pending.failed) {
        if (!(await ask(pending.userId, pending.name))) {
          setMarkerNote({ error: true, text: t('league.validate.askFailed', { name: firstName(pending.name) }) });
        }
      } else {
        const r = await remindLeagueMarker(cardId);
        setPending((p) => ({ ...p, remindedAt: r?.remindedAt ?? null }));
        setMarkerNote({ text: t('league.validate.reminded', { name: firstName(pending.name) }) });
      }
    } catch (e) {
      setMarkerNote({ error: true, text: leagueErrorText(e) || t('league.validate.remindFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function askSomeoneElse() {
    setMarkerNote(null);
    setBusy(true);
    try {
      if (!pending.failed) await cancelLeagueMarkerRequest(cardId);
      setSelected(defaultPick(candidates.filter((c) => c.userId !== pending.userId)));
      setPending(null);
      // Reopened without a check result: show the not-confirmed state.
      setResult((r) => r ?? { confirmed: false, reason: 'no_partner', settled: 18 });
    } catch (e) {
      setMarkerNote({ error: true, text: leagueErrorText(e) || t('league.validate.cancelFailed') });
    } finally {
      setBusy(false);
    }
  }

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
      const r = await confirmLeagueCardByPartner(cardId);
      setResult(r);
      if (!r.confirmed && picked && !RESUBMIT_REASONS.includes(r.reason)) await ask(picked.userId, picked.name);
    } catch (e) {
      setError(leagueErrorText(e) || t('league.validate.submitFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Not settled / changed: read the server again, then resubmit (allowed
  // while the card is 'submitted') and re-run the partner check.
  async function checkAgain() {
    setResult(null);
    setAlreadySubmitted(false);
    await load();
  }

  const month = monthName(cardMonth(new Date()));
  const goBoard = () => navigation.replace('LeagueBoard', { leagueId });

  const header = (
    <View style={s.header}>
      <IconButton icon="chevron-left" size={24} color={theme.accent.primary} onPress={goBoard} accessibilityLabel={t('common.back')} />
      <Text style={s.headerTitle} numberOfLines={1}>{t('league.validate.headerTitle', { month })}</Text>
    </View>
  );

  if (loading || !card) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {header}
        <View style={s.center}>
          {loading ? <ActivityIndicator color={theme.accent.primary} /> : (
            <>
              <Text style={s.emptyText}>{t('league.validate.loadFailed')}</Text>
              <TouchableOpacity style={s.secondaryBtn} onPress={load} activeOpacity={0.8}>
                <Text style={s.secondaryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const {
    round, roundNumber, player, strokes, playingHandicap, missing, rated, netDifferential,
  } = card;
  const confirmed = !!result?.confirmed;
  const waiting = !!pending && !confirmed;
  const notConfirmed = !!result && !confirmed;
  const markerFirst = pending ? firstName(pending.name) : '';
  // The server refuses to submit an unrated tee (P0001); say so up front.
  const unrated = !rated && !alreadySubmitted && !result;

  // Fix a hole in the game's own scorecard, then come back and Check again.
  const editInScorecard = (
    <TouchableOpacity
      style={s.secondaryBtn}
      onPress={() => navigation.navigate('Scorecard', { tournamentId, roundIndex: roundNumber - 1 })}
      accessibilityRole="button"
      activeOpacity={0.8}
    >
      <Text style={s.secondaryText}>{t('league.validate.editScorecard')}</Text>
    </TouchableOpacity>
  );

  const fallback = (icon, title, sub, routeName, params) => (
    <TouchableOpacity
      key={routeName + title}
      style={s.fallbackRow}
      onPress={() => navigation.navigate(routeName, params)}
      accessibilityRole="button"
    >
      <Feather name={icon} size={18} color={theme.accent.primary} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.fallbackTitle}>{title}</Text>
        <Text style={s.fallbackSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.text.muted} />
    </TouchableOpacity>
  );

  // "Who marked you?" chips: one per candidate, then Someone else.
  const picker = (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('league.validate.pickerTitle')}>
      <Text style={s.overline}>{t('league.validate.pickerOverline')}</Text>
      <View style={s.chips}>
        {candidates.map((c) => (
          <TouchableOpacity
            key={c.userId}
            style={[s.chip, pick === c.userId && s.chipOn]}
            onPress={() => setSelected(c.userId)}
            accessibilityRole="radio"
            accessibilityState={{ checked: pick === c.userId }}
            accessibilityLabel={c.name}
            activeOpacity={0.8}
          >
            <Text style={[s.chipText, pick === c.userId && s.chipTextOn]} numberOfLines={1}>{c.name}</Text>
          </TouchableOpacity>
        ))}
        {!markersLoaded && <View style={[s.chip, s.chipSkeleton]} testID="marker-chip-skeleton" />}
        <TouchableOpacity
          style={[s.chip, pick === 'else' && s.chipOn]}
          onPress={() => setSelected('else')}
          accessibilityRole="radio"
          accessibilityState={{ checked: pick === 'else' }}
          activeOpacity={0.8}
        >
          <Text style={[s.chipText, pick === 'else' && s.chipTextOn]} numberOfLines={1}>{t('league.validate.someoneElse')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const fallbacks = (
    <>
      <Text style={s.overline}>{t('league.validate.fallbacksOverline')}</Text>
      <View style={s.fallbackList}>
        {fallback('maximize', t('league.validate.qrTitle'), t('league.validate.qrSub'),
          'LeagueMarkerQR', { leagueId, cardId })}
        {/* The card is already submitted: AddProof only uploads and attaches. */}
        {fallback('camera', t('league.validate.uploadTitle'), t('league.validate.uploadSub'),
          'LeagueAddProof', { leagueId, cardId, source: 'app', kind: 'photo' })}
        {fallback('award', t('league.validate.officialTitle'), t('league.validate.officialSub'),
          'LeagueAddProof', { leagueId, cardId, source: 'app', kind: 'official' })}
      </View>
    </>
  );

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={s.content}>
        {confirmed && (
          <View style={s.statusCard}>
            <Feather name="check-circle" size={18} color={theme.accent.primary} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>
                {t('league.validate.confirmedTitle', { partner: result.partnerName || t('league.validate.yourPartner'), settled: result.settled ?? 18 })}
              </Text>
              <Text style={s.statusSub}>{t('league.validate.confirmedSub')}</Text>
            </View>
          </View>
        )}

        {waiting && (
          <>
            <View style={s.statusCard}>
              <View style={{ marginRight: 12 }}>
                <PersonAvatar person={{ displayName: pending.name }} theme={theme} size={36} />
              </View>
              <View style={{ flex: 1 }}>
                {pending.failed ? (
                  <Text style={s.statusTitle}>
                    {t('league.validate.notAsked', { name: markerFirst })}
                  </Text>
                ) : (
                  <>
                    <Text style={s.statusTitle}>{t('league.validate.waiting', { name: markerFirst })}</Text>
                    <Text style={s.statusSub}>{markerAskedLine(pending.requestedAt, pending.expiresAt).map(tr).join(' · ')}</Text>
                  </>
                )}
              </View>
            </View>
            {rated && card.points != null && (
              <Text style={s.waitingNet}>
                <Text style={{ fontFamily: 'PlusJakartaSans-ExtraBold' }}>{t('league.scoring.pts', { points: card.points })}</Text>
                {t('league.validate.countsOnceConfirmed')}
              </Text>
            )}
            <View style={s.btnRow}>
              <TouchableOpacity style={[s.rowBtn, busy && s.disabled]} onPress={remind} disabled={busy} accessibilityRole="button">
                <Text style={s.secondaryText} numberOfLines={1}>{t('league.validate.remind', { name: markerFirst })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.rowBtn, busy && s.disabled]} onPress={askSomeoneElse} disabled={busy} accessibilityRole="button">
                <Text style={s.secondaryText} numberOfLines={1}>{t('league.validate.askElse')}</Text>
              </TouchableOpacity>
            </View>
            {!!markerNote && (
              <Text style={markerNote.error ? s.errorText : s.noteText}>{markerNote.text}</Text>
            )}
          </>
        )}

        {!!returnNote && !confirmed && (
          <>
            <View style={[s.statusCard, s.statusWarn]}>
              <Feather name="message-circle" size={18} color={theme.text.secondary} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.statusTitle}>{t('league.validate.sentBack')}</Text>
                <Text style={s.statusSub}>{returnNote}</Text>
              </View>
            </View>
            <View style={{ marginBottom: 16 }}>{editInScorecard}</View>
          </>
        )}

        {notConfirmed && !waiting && (
          <View style={[s.statusCard, s.statusWarn]}>
            <Feather name="alert-circle" size={18} color={theme.text.secondary} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>{t('league.validate.notConfirmedTitle')}</Text>
              <Text style={s.statusSub}>{t(PARTNER_REASONS[result.reason] ?? 'league.validate.notConfirmedFallback')}</Text>
            </View>
          </View>
        )}

        {confirmed && rated && netDifferential != null && (
          <View style={s.resultCard}>
            <View style={s.resultHead}>
              <Text style={[s.resultValue, { color: theme.text.primary }]}>{card.points}</Text>
              <Text style={s.resultKey}>{t('league.card.stableford')}</Text>
            </View>
            <Text style={s.resultSub}>
              {t('league.validate.resultSub', { gross: card.gross, adjusted: card.adjustedGross, diff: formatNetDiffSigned(netDifferential) })}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('LeagueCard', { leagueId, month: cardMonth(new Date()), userId: user?.id })}
              activeOpacity={0.7}
              accessibilityRole="link"
            >
              <Text style={s.resultLink}>{t('league.validate.howWorked')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {unrated && (
          <View style={[s.statusCard, s.statusWarn]}>
            <Feather name="alert-circle" size={18} color={theme.text.secondary} style={{ marginRight: 12 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitle}>{t('league.validate.unratedTitle')}</Text>
              <Text style={s.statusSub}>{tr(UNRATED_TEE_PROBLEM)}</Text>
            </View>
          </View>
        )}

        <Text style={s.courseTitle} numberOfLines={1}>{t('league.validate.courseRound', { course: round.courseName, round: roundNumber })}</Text>
        <ScorecardTable
          round={round}
          players={[player]}
          scores={{ [player.id]: strokes }}
          editable={() => false}
          mode="stableford"
          meId={player.id}
          handicapsOverride={{ [player.id]: playingHandicap }}
        />

        {missing.length > 0 && !result && !alreadySubmitted && (
          <Text style={s.errorText}>
            {t('league.validate.missing', { holes: missing.join(', ') })}
          </Text>
        )}
        {missing.length > 0 && !result && !alreadySubmitted && editInScorecard}
        {!!error && <Text style={s.errorText}>{error}</Text>}

        {(notConfirmed || waiting) && (
          <>
            {!waiting && RESUBMIT_REASONS.includes(result.reason) && (
              <TouchableOpacity style={s.secondaryBtn} onPress={checkAgain} activeOpacity={0.8}>
                <Text style={s.secondaryText}>{t('league.validate.checkAgain')}</Text>
              </TouchableOpacity>
            )}
            {/* Nobody asked, or the last ask was sent back or expired: pick again. */}
            {!waiting && !RESUBMIT_REASONS.includes(result.reason) && candidates.length > 0 && (
              <>
                {picker}
                {picked && (
                  <TouchableOpacity
                    style={[s.secondaryBtn, busy && s.disabled]}
                    onPress={async () => { setBusy(true); await ask(picked.userId, picked.name); setBusy(false); }}
                    disabled={busy}
                    accessibilityRole="button"
                  >
                    <Text style={s.secondaryText}>{t('league.validate.ask', { name: firstName(picked.name) })}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {fallbacks}
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        {confirmed || waiting || (notConfirmed && !RESUBMIT_REASONS.includes(result.reason)) ? (
          <TouchableOpacity style={s.primaryBtn} onPress={goBoard} activeOpacity={0.8}>
            <Text style={s.primaryText}>{confirmed ? t('common.done') : t('league.validate.backToLeague')}</Text>
          </TouchableOpacity>
        ) : alreadySubmitted && !result ? (
          <TouchableOpacity
            style={[s.primaryBtn, busy && s.disabled]}
            onPress={checkPartner}
            disabled={busy}
            activeOpacity={0.8}
          >
            {busy
              ? <ActivityIndicator color={theme.text.inverse} />
              : <Text style={s.primaryText}>{t('league.validate.checkPartner')}</Text>}
          </TouchableOpacity>
        ) : (
          <>
            {picker}
            {picked
              ? <Text style={s.footnote}>{t('league.validate.footnotePicked', { name: firstName(picked.name) })}</Text>
              : !result && <Text style={s.footnote}>{t('league.validate.footnote')}</Text>}
            <TouchableOpacity
              style={[s.primaryBtn, (busy || missing.length > 0 || unrated) && s.disabled]}
              onPress={submitAndConfirm}
              disabled={busy || missing.length > 0 || unrated}
              activeOpacity={0.8}
            >
              {busy
                ? <ActivityIndicator color={theme.text.inverse} />
                : <Text style={s.primaryText}>{result ? t('league.validate.submitAgain') : picked ? t('league.validate.submitAndAsk', { name: firstName(picked.name) }) : t('league.validate.submit')}</Text>}
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

    resultCard: {
      backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1, borderColor: cardBorder,
      padding: 14, marginBottom: 16,
    },
    resultHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
    resultValue: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 24 },
    resultKey: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 13 },
    resultSub: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
    resultLink: { fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 13, marginTop: 8 },

    courseTitle: {
      fontFamily: 'PlayfairDisplay-Bold', color: theme.accent.primary, fontSize: 16, letterSpacing: -0.3, marginBottom: 12,
    },
    errorText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.destructive, fontSize: 12, marginTop: 12 },

    overline: {
      fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary, fontSize: 11, letterSpacing: 1.8,
      marginTop: 20, marginBottom: 8,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: {
      minHeight: 40, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20,
      borderWidth: 1, borderColor: theme.border.default, backgroundColor: theme.bg.card,
    },
    chipOn: { borderColor: theme.accent.primary, backgroundColor: theme.accent.primary },
    chipText: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary, fontSize: 13 },
    chipTextOn: { color: theme.text.inverse },
    chipSkeleton: { width: 88, backgroundColor: theme.bg.secondary, borderColor: theme.bg.secondary },
    waitingNet: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },
    btnRow: { flexDirection: 'row', gap: 10 },
    rowBtn: {
      flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, paddingVertical: 12, paddingHorizontal: 8, minHeight: 48,
    },
    noteText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12, marginTop: 10 },
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
