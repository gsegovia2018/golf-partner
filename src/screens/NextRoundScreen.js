import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { loadTournament, randomPairs, saveTournament } from '../store/tournamentStore';
import { useTheme } from '../theme/ThemeContext';

export default function NextRoundScreen({ navigation, route }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  const { revealOnly = false, roundIndex: paramRoundIndex } = route?.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [nextPairs, setNextPairs] = useState(null);
  const [phase, setPhase] = useState('initial');
  const [countdownNum, setCountdownNum] = useState(3);

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

  useEffect(() => {
    (async () => {
      const t = await loadTournament();
      setTournament(t);
      if (revealOnly) {
        setNextPairs(t.rounds[paramRoundIndex].pairs);
      } else {
        setNextPairs(randomPairs(t.players));
      }
    })();
  }, []);

  if (!tournament || !nextPairs) return null;

  const roundIndex = revealOnly ? paramRoundIndex : tournament.currentRound + 1;
  const round = tournament.rounds[roundIndex];

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

  async function reshuffle() {
    const newPairs = randomPairs(tournament.players);
    setNextPairs(newPairs);
    if (revealOnly) {
      const updated = { ...tournament };
      updated.rounds[roundIndex].pairs = newPairs;
      updated.rounds[roundIndex].revealed = true;
      await saveTournament(updated);
    }
    setPhase('reveal');
    revealPairs();
  }

  async function handleConfirm() {
    const updated = { ...tournament };
    updated.rounds[roundIndex].pairs = nextPairs;
    updated.rounds[roundIndex].revealed = true;
    if (!revealOnly) {
      updated.currentRound = roundIndex;
    }
    await saveTournament(updated);
    navigation.replace('Home');
  }

  /* ─── Countdown phase ─── */
  if (phase === 'countdown') {
    return (
      <View style={s.fullscreen}>
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
    );
  }

  /* ─── Reveal phase ─── */
  if (phase === 'reveal') {
    ensurePairAnims(nextPairs.length);
    const pairColors = [theme.pairA, theme.pairB, theme.accent.primary, theme.accent.primary];
    return (
      <View style={s.revealContainer}>
        <View style={s.pairsContainer}>
          {nextPairs.map((pair, i) => {
            const anim = pairAnimsRef.current[i];
            const color = pairColors[i] ?? theme.accent.primary;
            const isLast = i === nextPairs.length - 1;
            return (
              <Animated.View
                key={i}
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
                {pair.map((p, j) => (
                  <React.Fragment key={p.id}>
                    <Text style={s.revealPairNames}>{p.name}</Text>
                    {j < pair.length - 1 && <Text style={s.revealAmpersand}>&</Text>}
                  </React.Fragment>
                ))}
              </Animated.View>
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
          <TouchableOpacity style={s.btnSecondary} onPress={reshuffle}>
            <Feather name="shuffle" size={18} color={theme.accent.primary} style={{ marginRight: 8 }} />
            <Text style={s.btnSecondaryText}>Re-shuffle</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnPrimary} onPress={handleConfirm}>
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
      </View>
    );
  }

  /* ─── Initial phase ─── */
  return (
    <View style={s.container}>
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

        <TouchableOpacity style={s.revealBtn} onPress={startReveal}>
          <Text style={s.revealBtnText}>Reveal Teams</Text>
        </TouchableOpacity>
      </View>
    </View>
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
      fontFamily: 'PlusJakartaSans-ExtraBold',
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
    countdownNum: {
      fontSize: 140,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.accent.primary,
    },

    /* Reveal pairs */
    revealPairCard: {
      backgroundColor: theme.bg.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
      borderLeftWidth: 4,
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
