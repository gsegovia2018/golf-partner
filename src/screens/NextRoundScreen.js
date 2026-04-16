import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadTournament, randomPairs, saveTournament } from '../store/tournamentStore';

export default function NextRoundScreen({ navigation, route }) {
  const { revealOnly = false, roundIndex: paramRoundIndex } = route?.params ?? {};

  const [tournament, setTournament] = useState(null);
  const [nextPairs, setNextPairs] = useState(null);
  const [phase, setPhase] = useState('initial');
  const [countdownNum, setCountdownNum] = useState(3);

  const countdownOpacity = useRef(new Animated.Value(0)).current;
  const countdownScale = useRef(new Animated.Value(1.4)).current;
  const pair1Opacity = useRef(new Animated.Value(0)).current;
  const pair1Scale = useRef(new Animated.Value(1.4)).current;
  const pair2Opacity = useRef(new Animated.Value(0)).current;
  const pair2Scale = useRef(new Animated.Value(1.4)).current;
  const actionsOpacity = useRef(new Animated.Value(0)).current;

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
    pair1Opacity.setValue(0);
    pair1Scale.setValue(1.5);
    pair2Opacity.setValue(0);
    pair2Scale.setValue(1.5);
    actionsOpacity.setValue(0);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(pair1Opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(pair1Scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]),
      Animated.delay(700),
      Animated.parallel([
        Animated.timing(pair2Opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(pair2Scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]),
      Animated.delay(500),
      Animated.timing(actionsOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }

  async function reshuffle() {
    const newPairs = randomPairs(tournament.players);
    setNextPairs(newPairs);
    if (revealOnly) {
      const updated = { ...tournament };
      updated.rounds[roundIndex].pairs = newPairs;
      await saveTournament(updated);
    }
    setPhase('reveal');
    revealPairs();
  }

  async function handleConfirm() {
    const updated = { ...tournament };
    updated.rounds[roundIndex].pairs = nextPairs;
    if (!revealOnly) {
      updated.currentRound = roundIndex;
    }
    await saveTournament(updated);
    navigation.replace('Home');
  }

  if (phase === 'countdown') {
    return (
      <View style={styles.fullscreen}>
        <Animated.Text
          style={[styles.countdownNum, { opacity: countdownOpacity, transform: [{ scale: countdownScale }] }]}
        >
          {countdownNum}
        </Animated.Text>
      </View>
    );
  }

  if (phase === 'reveal') {
    return (
      <View style={styles.fullscreen}>
        <Animated.View style={[styles.revealPairCard, { opacity: pair1Opacity, transform: [{ scale: pair1Scale }] }]}>
          <Text style={styles.revealPairLabel}>PAIR 1</Text>
          <Text style={styles.revealPairNames}>{nextPairs[0][0].name}</Text>
          <Text style={styles.revealAmpersand}>&</Text>
          <Text style={styles.revealPairNames}>{nextPairs[0][1].name}</Text>
        </Animated.View>

        <Animated.View style={[styles.revealPairCard, styles.revealPairCard2, { opacity: pair2Opacity, transform: [{ scale: pair2Scale }] }]}>
          <Text style={styles.revealPairLabel}>PAIR 2</Text>
          <Text style={styles.revealPairNames}>{nextPairs[1][0].name}</Text>
          <Text style={styles.revealAmpersand}>&</Text>
          <Text style={styles.revealPairNames}>{nextPairs[1][1].name}</Text>
        </Animated.View>

        <Animated.View style={[styles.revealActions, { opacity: actionsOpacity }]}>
          <TouchableOpacity style={styles.btnSecondary} onPress={reshuffle}>
            <Text style={styles.btnText}>Re-shuffle</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={handleConfirm}>
            <Text style={styles.btnText}>
              {revealOnly ? `Let's Play!` : `Start Round ${roundIndex + 1}`}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.initialContainer}>
      <Text style={styles.roundLabel}>Round {roundIndex + 1}</Text>
      <Text style={styles.course}>{round.courseName}</Text>
      <TouchableOpacity style={styles.revealBtn} onPress={startReveal}>
        <Text style={styles.revealBtnText}>Reveal Teams</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  initialContainer: {
    flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 40,
  },
  roundLabel: { fontSize: 18, color: '#6e7681', fontWeight: '600', marginBottom: 8 },
  course: { fontSize: 24, fontWeight: '800', color: '#f0f6fc', marginBottom: 48, textAlign: 'center' },
  revealBtn: {
    backgroundColor: '#2ea043', borderRadius: 14, paddingVertical: 20, paddingHorizontal: 48,
  },
  revealBtnText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 1 },

  fullscreen: {
    flex: 1, backgroundColor: '#0d1117', alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  countdownNum: { fontSize: 140, fontWeight: '900', color: '#4caf50' },

  revealPairCard: { alignItems: 'center', marginBottom: 32 },
  revealPairCard2: { marginBottom: 0 },
  revealPairLabel: { color: '#4caf50', fontSize: 12, fontWeight: '800', letterSpacing: 3, marginBottom: 12 },
  revealPairNames: { color: '#f0f6fc', fontSize: 34, fontWeight: '800', textAlign: 'center' },
  revealAmpersand: { color: '#30363d', fontSize: 22, fontWeight: '700', marginVertical: 4 },

  revealActions: { position: 'absolute', bottom: 60, left: 32, right: 32, gap: 12 },
  btn: { backgroundColor: '#2ea043', borderRadius: 10, padding: 16, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#21262d', borderRadius: 10, borderWidth: 1, borderColor: '#30363d', padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
