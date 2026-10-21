import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import Reveal from '../ui/Reveal';
import CountUpText from './CountUpText';
import { fmtDelta } from './reportCardView';
import { verdictKey } from './reportKeys';
import { toneSurface } from '../../theme/tone';

// Filled verdict hero (hybrid option B): tone-colored card, inverse Playfair
// verdict, count-up points top-right, chips for per-hole / vs-avg /
// benchmark / partial-round.
export default function ReportVerdictHero({ headline, round, hasHistory, durationLabel = null }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const reduced = useReducedMotion();
  const bg = toneSurface(theme, headline.tone ?? 'neutral');

  const mark = formatNumber(2, { decimals: 1 });
  const chips = [t('stats.my.report.perHole', { value: formatNumber(headline.perHole) })];
  if (headline.vsAvg != null) chips.push(t('stats.my.report.vsAvgChip', { delta: fmtDelta(headline.vsAvg) }));
  chips.push(t(headline.clearedBenchmark ? 'stats.my.report.aboveMark' : 'stats.my.report.belowMark', { mark }));
  if (!round.complete) chips.push(t('stats.my.report.through', { count: round.holesPlayed }));
  if (durationLabel) chips.push(t('stats.my.report.onCourse', { duration: durationLabel }));
  const verdict = verdictKey(headline.verdict) ? t(verdictKey(headline.verdict)) : headline.verdict;

  return (
    <View testID="report-card-verdict" style={[s.hero, { backgroundColor: bg }]}>
      <View style={s.topRow}>
        <View style={s.topCopy}>
          <Text style={s.ov}>{t('stats.my.report.roundVerdict')}</Text>
          <Reveal dy={9} duration={400}>
            <Text testID="report-card-verdict-phrase" style={s.verdict}>
              {verdict}.
            </Text>
          </Reveal>
        </View>
        <Reveal delay={80} dy={9} duration={400}>
          <View style={s.bignum}>
            <Text style={s.bignumN}>
              <CountUpText value={headline.points} duration={500} disabled={reduced} />
            </Text>
            <Text style={s.bignumU}>{t('stats.my.report.points')}</Text>
          </View>
        </Reveal>
      </View>
      <View style={s.chips}>
        {chips.map((c) => (
          <View key={c} style={s.chip}><Text style={s.chipText}>{c}</Text></View>
        ))}
      </View>
      {!hasHistory && (
        <Text style={s.note}>{t('stats.my.report.noHistory')}</Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    hero: { borderRadius: theme.radius.lg + 2, padding: 16, overflow: 'hidden' },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    topCopy: { flex: 1 },
    ov: {
      fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.4,
      textTransform: 'uppercase', color: theme.text.inverse, opacity: 0.75,
    },
    verdict: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 28, letterSpacing: -0.4,
      color: theme.text.inverse, marginTop: 4,
    },
    bignum: { alignItems: 'flex-end' },
    bignumN: {
      fontSize: 38, lineHeight: 40, fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: -1.5, color: theme.text.inverse, fontVariant: ['tabular-nums'],
    },
    bignumU: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.2,
      textTransform: 'uppercase', color: theme.text.inverse, opacity: 0.75,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 13 },
    chip: {
      backgroundColor: theme.isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)',
      borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
    },
    chipText: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse,
      fontVariant: ['tabular-nums'],
    },
    note: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.inverse, opacity: 0.75, marginTop: 10,
    },
  });
}
