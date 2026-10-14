import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { loadTournament, subscribeTournamentChanges } from '../store/tournamentStore';
import { liveRoundSummary } from '../lib/liveRoundSummary';
import { useT } from '../i18n';

const ENTRANCE_DURATION = 250;
const ENTRANCE_EASING = Easing.bezier(0.23, 1, 0.32, 1);

// Home "jump back in" hero — renders nothing unless there's a live round to
// resume. Subscription pattern mirrors FloatingTabBar.js:18-39.
export default function LiveRoundCard({ onOpen }) {
  const { theme } = useTheme();
  const tl = useT();
  const reduced = useReducedMotion();
  const [summary, setSummary] = React.useState(null);
  // Entrance should only play the first time a summary appears (null → some
  // round), never on the subscription's later refreshes of an already-shown
  // card — this tracks whether the *previous* render had one.
  const hadSummaryRef = React.useRef(false);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    let cancelled = false;
    const check = () => {
      loadTournament({ refreshRemote: false, resolveIdentity: false })
        .then((t) => { if (!cancelled) setSummary(liveRoundSummary(t)); })
        .catch(() => {});
    };
    check();
    const unsub = subscribeTournamentChanges(check);
    return () => { cancelled = true; unsub(); };
  }, []);

  React.useEffect(() => {
    if (summary && !hadSummaryRef.current) {
      hadSummaryRef.current = true;
      opacity.setValue(0);
      const animations = [
        Animated.timing(opacity, {
          toValue: 1, duration: ENTRANCE_DURATION, easing: ENTRANCE_EASING, useNativeDriver: true,
        }),
      ];
      if (reduced) {
        translateY.setValue(0);
      } else {
        translateY.setValue(8);
        animations.push(Animated.timing(translateY, {
          toValue: 0, duration: ENTRANCE_DURATION, easing: ENTRANCE_EASING, useNativeDriver: true,
        }));
      }
      Animated.parallel(animations).start();
    } else if (!summary) {
      hadSummaryRef.current = false;
    }
  }, [summary, reduced, opacity, translateY]);

  if (!summary) return null;
  const s = styles(theme);

  return (
    <Animated.View style={[s.card, { opacity, transform: [{ translateY }] }]}>
      <View style={s.row}>
        <View style={s.liveMark}><View style={s.liveDot} /><Text style={s.liveText}>{tl('shared.live').toUpperCase()}</Text></View>
        <Text style={s.overline}>{(summary.roundNumber != null ? tl('shared.round.numbered', { n: summary.roundNumber }) : summary.roundLabel).toUpperCase()}</Text>
      </View>
      <Text style={s.name} numberOfLines={1}>{summary.name}</Text>
      <Text style={s.meta} numberOfLines={1}>{summary.courseName}</Text>
      <View style={s.footer}>
        <TouchableOpacity style={s.cta} onPress={onOpen} accessibilityRole="button" accessibilityLabel={tl('shared.liveRound.open')}>
          <Feather name="clipboard" size={14} color="#00553c" />
          <Text style={s.ctaText}>{tl('shared.liveRound.open')}</Text>
        </TouchableOpacity>
        {summary.thru > 0 ? (
          <Text style={s.progress}>{tl('shared.liveRound.thru', { points: summary.myPoints, thru: summary.thru })}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = (t) => StyleSheet.create({
  card: {
    backgroundColor: '#00553c', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff6b5e' },
  liveText: { color: '#ffffff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4 },
  overline: { color: 'rgba(243,239,230,0.7)', fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4 },
  name: { color: '#f3efe6', fontFamily: 'PlayfairDisplay-Bold', fontSize: 21 },
  meta: { color: 'rgba(243,239,230,0.82)', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40,
    backgroundColor: '#f3efe6', borderRadius: 10, paddingHorizontal: 14,
  },
  progress: {
    flexShrink: 1, textAlign: 'right', color: '#f3efe6',
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, fontVariant: ['tabular-nums'],
  },
  ctaText: { color: '#00553c', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13 },
});
