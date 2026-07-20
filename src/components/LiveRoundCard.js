import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { loadTournament, subscribeTournamentChanges } from '../store/tournamentStore';
import { liveRoundSummary } from '../lib/liveRoundSummary';

// Home "jump back in" hero — renders nothing unless there's a live round to
// resume. Subscription pattern mirrors FloatingTabBar.js:18-39.
export default function LiveRoundCard({ onOpen }) {
  const { theme } = useTheme();
  const [summary, setSummary] = React.useState(null);

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

  if (!summary) return null;
  const s = styles(theme);

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={s.livePill}><View style={s.liveDot} /><Text style={s.liveText}>LIVE</Text></View>
        <Text style={s.overline}>{summary.roundLabel.toUpperCase()}</Text>
      </View>
      <Text style={s.name} numberOfLines={1}>{summary.name}</Text>
      <Text style={s.meta} numberOfLines={1}>
        {summary.courseName}
        {summary.thru > 0 ? ` · ${summary.myPoints} pts thru ${summary.thru}` : ''}
      </Text>
      <TouchableOpacity style={s.cta} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open scorecard">
        <Feather name="clipboard" size={15} color="#0f3d2c" />
        <Text style={s.ctaText}>Open scorecard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = (t) => StyleSheet.create({
  card: {
    backgroundColor: '#0f3d2c', borderRadius: 16, padding: 16, marginBottom: 16,
    ...(t.isDark ? {} : t.shadow.elevated),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#b3392e', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff' },
  liveText: { color: '#ffffff', fontFamily: 'PlusJakartaSans-Bold', fontSize: 11 },
  overline: { color: 'rgba(243,239,230,0.7)', fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.4 },
  name: { color: '#f3efe6', fontFamily: 'PlayfairDisplay-Bold', fontSize: 21 },
  meta: { color: 'rgba(243,239,230,0.82)', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13, marginTop: 2 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    backgroundColor: '#f3efe6', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginTop: 12,
  },
  ctaText: { color: '#0f3d2c', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13 },
});
