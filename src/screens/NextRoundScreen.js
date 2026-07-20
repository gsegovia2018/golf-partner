import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';
import {
  loadTournament, subscribeTournamentChanges,
  roundScoringMode, pairsForNextRound,
} from '../store/tournamentStore';
import { mutate } from '../store/mutate';
import { scoringModeUsesTeams, needsManualTeamSetup } from '../components/scoringModes';
import { useTheme } from '../theme/ThemeContext';
import { semantic } from '../theme/tokens';
import { shouldHandleStoreChange } from '../lib/navigationFocus';

export default function NextRoundScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { revealOnly = false, roundIndex: paramRoundIndex } = route?.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [nextPairs, setNextPairs] = useState(null);
  const [phase, setPhase] = useState('initial');
  const [countdownNum, setCountdownNum] = useState(3);
  // 'loading' until the first load resolves; 'error' if it returned null (or
  // threw); 'ready' once a tournament is in hand.
  const [loadState, setLoadState] = useState('loading');
  // Bumped to re-run the load effect when the user taps Retry.
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Guards handleConfirm/reshuffle against double-fire while a mutation is
  // in flight, and is always reset in a finally so a rejected mutation
  // leaves the button retryable instead of stuck disabled.
  const [busy, setBusy] = useState(false);

  const countdownOpacity = useRef(new Animated.Value(0)).current;
  const countdownScale = useRef(new Animated.Value(1.4)).current;
  const pairAnimsRef = useRef([]);
  const actionsOpacity = useRef(new Animated.Value(0)).current;
  const actionsTranslateY = useRef(new Animated.Value(20)).current;

  function ensurePairAnims(count) {
    while (pairAnimsRef.current.length < count) {
      pairAnimsRef.current.push({
        opacity: new Animated.Value(0),
        scale: new Animated.Value(1.5),
      });
    }
  }

  const phaseRef = useRef('initial');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Individual Stableford and Match Play don't use random partners — every
  // player is their own "pair" so the existing pair-based scorecard /
  // leaderboard machinery ranks them solo. Build single-member pairs for
  // those modes; everything else still randomises partners each round.
  //
  // When fixedTeams is on, reuse the most recent round whose pairs cover
  // exactly the current roster (same member ids) instead of randomising —
  // that keeps the same partnerships for the whole tournament. Falls back
  // to a fresh build when no such round exists yet (e.g. the very first
  // round, or a roster change with no matching history).
  const buildPairsForRound = (t) => {
    const idx = revealOnly ? paramRoundIndex : (t?.currentRound ?? 0) + 1;
    return pairsForNextRound(t, t?.rounds?.[idx]);
  };

  useEffect(() => {
    let cancelled = false;
    async function load({ initial }) {
      let t;
      try {
        t = await loadTournament();
      } catch (e) {
        console.warn('NextRoundScreen: loadTournament failed', e);
        t = null;
      }
      if (cancelled) return;
      if (!t) {
        // Only flip to the error state if nothing is on screen yet — a
        // transient subscription-driven reload should not blank the reveal.
        if (initial && !tournament) setLoadState('error');
        return;
      }
      setLoadState('ready');
      setTournament(t);
      if (!initial) {
        if (phaseRef.current !== 'initial') return;
        const idx = revealOnly ? paramRoundIndex : t.currentRound + 1;
        // Refresh nextPairs from the persisted round whenever it's already
        // revealed — covers the revealOnly reveal-teams entry point AND a
        // manual-teams save (EditTeamsScreen sets pairs + revealed=true,
        // then goBack() lands back here while still in 'initial' phase).
        // Without this, nextPairs would keep the stale randomly-built teams
        // from the initial mount and silently overwrite the user's manual
        // choice on confirm.
        if (revealOnly || t.rounds[idx]?.revealed) setNextPairs(t.rounds[idx].pairs);
        return;
      }
      if (revealOnly) setNextPairs(t.rounds[paramRoundIndex].pairs);
      else setNextPairs(buildPairsForRound(t));
    }
    load({ initial: true });
    const unsub = subscribeTournamentChanges(() => {
      if (shouldHandleStoreChange(navigation)) load({ initial: false });
    });
    return () => { cancelled = true; unsub(); };
  }, [navigation, revealOnly, paramRoundIndex, loadAttempt]);

  // Retry handler for the "couldn't load" error state.
  function retryLoad() {
    setLoadState('loading');
    setLoadAttempt((n) => n + 1);
  }

  // Explicit load failure — never a blank screen. Keep a working back button.
  if (loadState === 'error' && !tournament) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={22} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Next Round</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={s.loadingBody}>
          <Feather name="alert-circle" size={44} color={theme.text.muted} />
          <Text style={s.errorTitle}>Couldn't load the next round</Text>
          <Text style={s.loadingText}>Check your connection and try again.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={retryLoad} activeOpacity={0.8}>
            <Feather name="rotate-ccw" size={15} color={theme.text.inverse} />
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  // Loading state — never a blank screen. Keep a working back button.
  if (!tournament || !nextPairs) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="chevron-left" size={22} color={theme.accent.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Next Round</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={s.loadingBody}>
          <ActivityIndicator color={theme.accent.primary} />
          <Text style={s.loadingText}>Loading…</Text>
        </View>
      </ScreenContainer>
    );
  }

  const roundIndex = revealOnly ? paramRoundIndex : tournament.currentRound + 1;
  const round = tournament.rounds[roundIndex];

  // Teams (assigned/revealed partners) only exist in team modes. Solo modes
  // (Stableford, Match Play) build single-member "pairs", so there is nothing
  // to re-shuffle and the screen avoids "Teams" wording for them.
  const mode = roundScoringMode(tournament, round);
  const usesTeams = scoringModeUsesTeams(mode, tournament?.players?.length);
  // Reshuffle is disabled when teams are fixed for the tournament — they
  // were locked in at creation (or the last roster change), not re-rolled
  // per round.
  const canReshuffle = usesTeams && !tournament?.settings?.fixedTeams;
  // Manual teams: skip the random-draw reveal ceremony for a round that
  // hasn't been set yet — send the user straight to the team editor. Once
  // fixedTeams is also on, later rounds already carry the locked-in teams
  // (buildPairsForRound reuses them), so the normal reveal is fine again.
  const manualTeamsPending = needsManualTeamSetup(
    mode,
    tournament?.players?.length,
    tournament?.settings?.manualTeams,
  ) && !tournament?.settings?.fixedTeams && !round?.revealed;

  function startReveal() {
    setPhase('countdown');
    runCountdown(3);
  }

  function runCountdown(n) {
    if (n === 0) {
      setPhase('reveal');
      revealPairs();
      return;
    }
    setCountdownNum(n);
    countdownOpacity.setValue(0);
    countdownScale.setValue(1.6);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(countdownOpacity, { toValue: 1, duration: 45, useNativeDriver: true }),
        Animated.spring(countdownScale, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]),
      Animated.delay(165),
      Animated.timing(countdownOpacity, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => runCountdown(n - 1));
  }

  // Snap straight to the fully-revealed state — used by the Skip control and
  // by tap-to-complete during the reveal animation.
  function finishRevealInstant() {
    ensurePairAnims(nextPairs.length);
    countdownOpacity.stopAnimation();
    nextPairs.forEach((_, i) => {
      pairAnimsRef.current[i].opacity.stopAnimation();
      pairAnimsRef.current[i].scale.stopAnimation();
      pairAnimsRef.current[i].opacity.setValue(1);
      pairAnimsRef.current[i].scale.setValue(1);
    });
    actionsOpacity.stopAnimation();
    actionsTranslateY.stopAnimation();
    actionsOpacity.setValue(1);
    actionsTranslateY.setValue(0);
    setPhase('reveal');
  }

  function revealPairs() {
    ensurePairAnims(nextPairs.length);
    nextPairs.forEach((_, i) => {
      pairAnimsRef.current[i].opacity.setValue(0);
      pairAnimsRef.current[i].scale.setValue(1.5);
    });
    actionsOpacity.setValue(0);
    actionsTranslateY.setValue(20);

    const sequence = [];
    nextPairs.forEach((_, i) => {
      sequence.push(
        Animated.parallel([
          Animated.timing(pairAnimsRef.current[i].opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.spring(pairAnimsRef.current[i].scale, {
            toValue: 1,
            damping: 12,
            stiffness: 100,
            useNativeDriver: true,
          }),
        ]),
      );
      if (i < nextPairs.length - 1) sequence.push(Animated.delay(700));
    });
    sequence.push(Animated.delay(500));
    sequence.push(
      Animated.parallel([
        Animated.timing(actionsOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(actionsTranslateY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
    );
    Animated.sequence(sequence).start();
  }

  // Surfaces a mutation failure to the user (mirrors SetupScreen.handleStart's
  // Platform-branch alert convention) so a rejected mutation never leaves the
  // button looking dead with no feedback.
  function showMutationError(err, fallbackMessage) {
    const msg = err?.message ?? fallbackMessage;
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('Error', msg);
  }

  async function reshuffle() {
    if (busy) return;
    // Individual / match-play tournaments have nothing to reshuffle — every
    // pair has one player. Re-running buildPairsForRound keeps the structure
    // valid (same solo-pairs) so the button is a no-op rather than a crash.
    const newPairs = buildPairsForRound(tournament);
    setNextPairs(newPairs);
    setBusy(true);
    try {
      if (revealOnly) {
        await mutate(tournament, {
          type: 'round.reveal', roundId: tournament.rounds[roundIndex].id, pairs: newPairs,
        });
      }
      setPhase('reveal');
      revealPairs();
    } catch (err) {
      showMutationError(err, 'Could not reshuffle teams. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await mutate(tournament, {
        type: 'round.reveal', roundId: tournament.rounds[roundIndex].id, pairs: nextPairs,
      });
      if (!revealOnly) {
        await mutate(updated, { type: 'tournament.advanceRound', roundIndex });
      }
      navigation.replace('Home');
    } catch (err) {
      showMutationError(err, 'Could not start the round. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  /* ─── Countdown phase ─── */
  if (phase === 'countdown') {
    return (
      <ScreenContainer style={s.fullscreen} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity
            activeOpacity={1}
            style={s.countdownTapTarget}
            onPress={finishRevealInstant}
            accessibilityLabel="Skip the countdown"
          >
            <View style={s.countdownCircle}>
              <Animated.Text
                style={[
                  s.countdownNum,
                  {
                    opacity: countdownOpacity,
                    transform: [{ scale: countdownScale }],
                  },
                ]}
              >
                {countdownNum}
              </Animated.Text>
            </View>
            <Text style={s.skipHint}>Tap to skip</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  /* ─── Reveal phase ─── */
  if (phase === 'reveal') {
    ensurePairAnims(nextPairs.length);
    const pairColors = [theme.pairA, theme.pairB, theme.accent.primary, theme.accent.primary];
    return (
      <ScreenContainer style={s.revealContainer} edges={['top', 'bottom']}>
        <View style={s.pairsContainer}>
          {nextPairs.map((pair, i) => {
            const anim = pairAnimsRef.current[i];
            const color = pairColors[i] ?? theme.accent.primary;
            const isLast = i === nextPairs.length - 1;
            return (
              <React.Fragment key={i}>
              {i > 0 && (
                <Text style={s.vsDivider}>vs</Text>
              )}
              <Animated.View
                style={[
                  s.revealPairCard,
                  isLast && s.revealPairCard2,
                  {
                    opacity: anim?.opacity ?? 1,
                    transform: [{ scale: anim?.scale ?? 1 }],
                    borderLeftColor: color,
                  },
                ]}
              >
                <Text style={[s.revealPairLabel, { color }]}>
                  {pair.length === 1 ? `SOLO ${i + 1}` : `PAIR ${i + 1}`}
                </Text>
                {pair.map((p, j) => {
                  const live = tournament.players?.find((x) => x.id === p.id);
                  const displayName = live?.name ?? p.name;
                  return (
                    <React.Fragment key={p.id}>
                      <Text style={s.revealPairNames}>{displayName}</Text>
                      {j < pair.length - 1 && <Text style={s.revealAmpersand}>&</Text>}
                    </React.Fragment>
                  );
                })}
              </Animated.View>
              </React.Fragment>
            );
          })}
        </View>

        <View
          style={[
            s.revealActions,
            {
              opacity: actionsOpacity,
              transform: [{ translateY: actionsTranslateY }],
            },
          ]}
        >
          {canReshuffle && (
            <TouchableOpacity style={s.btnSecondary} onPress={reshuffle} disabled={busy}>
              <Feather name="shuffle" size={18} color={theme.accent.primary} style={{ marginRight: 8 }} />
              <Text style={s.btnSecondaryText}>Re-shuffle</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.btnPrimary} onPress={handleConfirm} disabled={busy}>
            <Feather
              name="play"
              size={18}
              color={theme.isDark ? theme.accent.primary : theme.text.inverse}
              style={{ marginRight: 8 }}
            />
            <Text style={s.btnPrimaryText}>
              {revealOnly ? "Let's Play!" : `Start Round ${roundIndex + 1}`}
            </Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  /* ─── Initial phase ─── */
  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color={theme.accent.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Next Round</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={s.body}>
        <Text style={s.roundLabel}>Round {roundIndex + 1}</Text>
        <Text style={s.course}>{round.courseName}</Text>

        {manualTeamsPending ? (
          <TouchableOpacity
            style={s.revealBtn}
            onPress={() => navigation.navigate('EditTeams', { roundIndex, tournamentId: tournament.id })}
          >
            <Text style={s.revealBtnText}>Set Teams</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={s.revealBtn} onPress={startReveal}>
              <Text style={s.revealBtnText}>{usesTeams ? 'Reveal Teams' : 'Reveal Round'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.skipBtn}
              onPress={finishRevealInstant}
              accessibilityLabel="Skip the reveal animation"
            >
              <Text style={s.skipBtnText}>Skip</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

/* ─── Styles ─── */
function makeStyles(theme) {
  return StyleSheet.create({
    /* Shared fullscreen for countdown + reveal */
    fullscreen: {
      flex: 1,
      backgroundColor: theme.bg.primary,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    revealContainer: {
      flex: 1,
      flexDirection: 'column',
      backgroundColor: theme.bg.primary,
      padding: 32,
    },
    pairsContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* Initial phase */
    container: {
      flex: 1,
      backgroundColor: theme.bg.primary,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.primary,
    },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    },
    roundLabel: {
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    course: {
      fontSize: 24,
      fontFamily: 'PlayfairDisplay-Bold',
      color: theme.text.primary,
      marginBottom: 48,
      textAlign: 'center',
    },
    revealBtn: {
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
      borderRadius: 16,
      paddingVertical: 20,
      paddingHorizontal: 48,
      ...theme.shadow.accent,
    },
    revealBtnText: {
      color: theme.isDark ? theme.accent.primary : theme.text.inverse,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: 1,
    },

    /* Countdown */
    countdownCircle: {
      width: 200,
      height: 200,
      borderRadius: 100,
      backgroundColor: 'rgba(0,103,71,0.3)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    countdownNum: {
      fontSize: 140,
      fontFamily: 'PlayfairDisplay-Black',
      color: theme.isDark ? semantic.winner.dark : semantic.winner.light,
    },
    countdownTapTarget: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    skipHint: {
      marginTop: 28,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },

    /* Loading / error states */
    loadingBody: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 32,
    },
    loadingText: {
      fontFamily: 'PlusJakartaSans-Regular',
      fontSize: 13,
      color: theme.text.muted,
      textAlign: 'center',
    },
    errorTitle: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 18,
      color: theme.text.primary,
      textAlign: 'center',
    },
    retryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.accent.primary,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 22,
      marginTop: 6,
    },
    retryBtnText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.inverse,
      fontSize: 14,
    },

    /* Skip control on the initial phase */
    skipBtn: {
      marginTop: 20,
      paddingVertical: 12,
      paddingHorizontal: 28,
    },
    skipBtnText: {
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 14,
      color: theme.text.muted,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },

    /* VS divider */
    vsDivider: {
      fontFamily: 'PlayfairDisplay-Regular',
      fontStyle: 'italic',
      fontSize: 16,
      color: theme.text.muted,
      textAlign: 'center',
      marginVertical: 8,
    },

    /* Reveal pairs */
    revealPairCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      borderLeftWidth: 6,
      alignItems: 'center',
      paddingVertical: 24,
      paddingHorizontal: 32,
      marginBottom: 24,
      alignSelf: 'stretch',
      ...theme.shadow.card,
    },
    revealPairCard2: {
      marginBottom: 0,
    },
    revealPairLabel: {
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: 3,
      marginBottom: 12,
    },
    revealPairNames: {
      color: theme.text.primary,
      fontSize: 30,
      fontFamily: 'PlusJakartaSans-Bold',
      textAlign: 'center',
    },
    revealAmpersand: {
      color: theme.text.muted,
      fontSize: 20,
      fontFamily: 'PlusJakartaSans-Medium',
      marginVertical: 4,
    },

    /* Action buttons */
    revealActions: {
      marginTop: 24,
      gap: 12,
      alignSelf: 'stretch',
    },
    btnPrimary: {
      backgroundColor: theme.isDark ? theme.accent.light : theme.accent.primary,
      borderRadius: 16,
      padding: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      ...theme.shadow.accent,
    },
    btnPrimaryText: {
      color: theme.isDark ? theme.accent.primary : theme.text.inverse,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 16,
    },
    btnSecondary: {
      backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.primary,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border.default,
      padding: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    btnSecondaryText: {
      color: theme.accent.primary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 16,
    },
  });
}
