import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useT } from '../../i18n';
import { renderMsg, metricValueText } from '../mystats/msg';
import PressableScale from '../ui/PressableScale';

const TONE = {
  improving: 'good', resolved: 'good', worse: 'bad', flat: 'neutral', 'needs-more-rounds': 'neutral',
};

// "Your focus" on the round summary (round focus loop spec §2.4, canvas option
// B): this round against the committed baseline as two bars, then the verdict
// since the commit. Renders only when the round touched the focus.
//   target   focusTarget(focus)      summary  roundFocusSummary(...)
//   verdict  focusVerdict(...) | null
export default function RoundFocusCard({ target, summary, verdict = null, onOpenCoach }) {
  const { theme } = useTheme();
  const t = useT();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!target || !summary?.touched) return null;

  const valueText = (v) => {
    if (!v) return null;
    if (v.kind === 'count') return t('rounds.summary.focus.count', { count: v.count, total: v.total });
    if (v.kind === 'lie') {
      const encounters = t('rounds.summary.focus.encounters', {
        shots: t('rounds.summary.focus.shots', { count: v.shots }),
        greens: t('rounds.summary.focus.greens', { count: v.greens }),
      });
      return t('rounds.summary.focus.lie', { count: v.count, total: v.total, encounters });
    }
    return v.value == null ? '–' : metricValueText(v.unit, v.value);
  };
  // A count before the focus reads plain ("7 of 10"): the label above names it.
  const beforeText = summary.before?.kind === 'count'
    ? t('rounds.summary.focus.beforeCount', { count: summary.before.count, total: summary.before.total })
    : valueText(summary.before);
  const nowText = valueText(summary.thisRound);

  const state = verdict?.state;
  let verdictText = null;
  if (state === 'needs-more-rounds') {
    verdictText = verdict.noData
      ? t('rounds.summary.focus.noData')
      : t('stats.my.focus.needMore', { count: verdict.roundsNeeded });
  } else if (state) {
    const base = t(`stats.my.focus.${state}`);
    verdictText = `${base} · ${t('stats.my.coach.ui.fix.level', { level: verdict.level ?? 1, max: 3 })}`;
  }
  const tone = TONE[state] ?? 'neutral';
  const toneColor = tone === 'good' ? theme.accent.primary
    : tone === 'bad' ? theme.destructive : theme.text.primary;

  const bars = [
    { id: 'now', label: t('rounds.summary.focus.thisRound'), text: nowText, pct: summary.nowPct, color: theme.accent.primary },
    summary.before
      ? { id: 'before', label: t('rounds.summary.focus.before'), text: beforeText, pct: summary.beforePct, color: theme.text.muted }
      : null,
  ].filter(Boolean);
  const a11y = bars.map((b) => `${b.label}: ${b.text}`).join('. ');

  return (
    <View style={s.card} testID="round-focus-card">
      <View style={s.overlineRow}>
        <Feather name="target" size={14} color={theme.accent.primary} />
        <Text style={s.overline}>{t('rounds.summary.focus.title')}</Text>
      </View>
      <Text style={s.title}>{renderMsg(target.title)}</Text>
      <View style={s.bars} accessible accessibilityLabel={a11y}>
        {bars.map((b) => (
          <View key={b.id}>
            <View style={s.barLabelRow}>
              <Text style={s.barLabel}>{b.label}</Text>
              <Text style={s.barValue}>{b.text}</Text>
            </View>
            {b.pct != null ? (
              <View style={s.track}>
                <View
                  testID={`round-focus-${b.id}-fill`}
                  style={[s.fill, { width: `${b.pct}%`, backgroundColor: b.color }]}
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {verdictText ? (
        <View style={s.verdictRow} testID="round-focus-verdict">
          <View style={[s.dot, { backgroundColor: toneColor }]} />
          <Text style={[s.verdictText, { color: toneColor }]}>{verdictText}</Text>
        </View>
      ) : null}
      <PressableScale
        onPress={onOpenCoach}
        accessibilityRole="link"
        accessibilityLabel={t('rounds.summary.focus.openCoach')}
        style={s.link}
      >
        <Text style={s.linkText}>{t('rounds.summary.focus.openCoach')}</Text>
      </PressableScale>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderColor: theme.border.default,
      borderRadius: 10,
      borderWidth: 1,
      gap: 8,
      padding: 14,
    },
    overlineRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    overline: {
      color: theme.text.secondary,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 11,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    title: {
      color: theme.text.primary,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 17,
      lineHeight: 22,
    },
    bars: { gap: 10, marginTop: 2 },
    barLabelRow: {
      alignItems: 'baseline', flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 4,
    },
    barLabel: { color: theme.text.secondary, fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 13 },
    barValue: {
      color: theme.text.primary,
      flexShrink: 1,
      fontFamily: 'PlusJakartaSans-Bold',
      fontSize: 13,
      textAlign: 'right',
    },
    track: { backgroundColor: theme.bg.secondary, borderRadius: 5, height: 10, overflow: 'hidden' },
    fill: { borderRadius: 5, height: 10 },
    verdictRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 2 },
    dot: { borderRadius: 4, height: 8, width: 8 },
    verdictText: { flexShrink: 1, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
    link: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
    linkText: { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-Bold', fontSize: 14 },
  });
}
