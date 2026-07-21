import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import PressableScale from '../ui/PressableScale';
import { semantic } from '../../theme/tokens';
import { formatConfidence, formatSample, formatPointsPerRound } from './CoachInsightRow';

const GROUP_LABELS = {
  fixFirst: 'Fix first',
  keepDoing: 'Keep doing',
  gettingBetter: 'Getting better',
  gettingWorse: 'Getting worse',
  nextGain: 'Next gain',
  nextGains: 'Next gain',
  watch: 'Watch',
};

// The coach hero is a plain white card — advice is information, so it wears
// the card surface with info-blue chrome, not a hero color. Masters red is
// reserved for the one group that reports a change for the worse
// (gettingWorse) — red is earned, never permanent; that state keeps the
// cream-on-red treatment. Fix first is marked as "the work" by a gold badge.
const RED = semantic.masters.red;
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_85 = 'rgba(243,239,230,0.85)';

const RED_SURFACE_GROUPS = new Set(['gettingWorse']);

export default function CoachHero({ insight, onCommitFocus, focusActive = false }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const proofs = [insight?.basis, formatSample(insight?.sample), formatConfidence(insight?.confidence)].filter(Boolean);
  const isRedSurface = Boolean(insight && RED_SURFACE_GROUPS.has(insight.group));
  const isFixFirst = insight?.group === 'fixFirst';
  const goldOnCard = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  const areaColor = areaAccentColor(insight?.tone, isRedSurface, isFixFirst, theme);
  const red = isRedSurface;

  if (!insight) {
    return (
      <View style={s.card} testID="coach-hero-surface">
        <Text style={s.kicker}>Coach</Text>
        <Text style={s.title}>No coach insight yet</Text>
        <Text style={s.reason}>Play more scored rounds to unlock a useful practice priority.</Text>
      </View>
    );
  }

  return (
    <View style={[s.card, red && s.cardRed]} testID="coach-hero-surface">
      <View style={s.topRow}>
        {isFixFirst ? (
          <View style={s.fixFirstBadge} testID="fix-first-badge">
            <Feather name="target" size={10} color={goldOnCard} />
            <Text style={s.fixFirstBadgeText}>{GROUP_LABELS.fixFirst}</Text>
          </View>
        ) : (
          <Text style={[s.kicker, red && s.kickerRed]}>{GROUP_LABELS[insight.group] ?? 'Coach'}</Text>
        )}
        <Text style={[s.area, { color: areaColor }]}>{insight.areaLabel ?? insight.area}</Text>
      </View>
      <Text style={[s.title, red && s.titleRed]}>{insight.title}</Text>
      {insight.reason ? <Text style={[s.reason, red && s.reasonRed]}>{insight.reason}</Text> : null}
      <View style={s.bottomRow}>
        {insight.metric ? (
          <View style={{ flexShrink: 1 }}>
            <Text style={[s.metric, red && s.titleRed]}>{insight.metric}</Text>
            {Number.isFinite(insight.pointsPerRound) ? (
              <Text style={[s.pointsCaption, red && s.kickerRed]}>{formatPointsPerRound(insight.pointsPerRound)}</Text>
            ) : null}
          </View>
        ) : null}
        <View style={s.chips}>
          {proofs.map((proof) => (
            <View key={proof} style={[s.chip, red && s.chipRed]}>
              <Feather name="check-circle" size={14} color={red ? CREAM_85 : theme.text.muted} />
              <Text style={[s.chipText, red && s.chipTextRed]}>{proof}</Text>
            </View>
          ))}
        </View>
      </View>
      {onCommitFocus && insight && !focusActive ? (
        <PressableScale
          onPress={() => onCommitFocus(insight)}
          accessibilityRole="button"
          accessibilityLabel="Make this my focus"
          style={[s.focusBtn, red && s.focusBtnRed]}
        >
          <Feather name="target" size={14} color={red ? RED : theme.text.inverse} />
          <Text style={[s.focusBtnText, red && s.focusBtnTextRed]}>Make this my focus</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

// On the white card, tone accents use the normal light/dark semantic colors.
// On the Masters-red surface a red area label would vanish, so a 'bad' area
// label renders in winner gold there instead. Fix first always carries a bad
// tone, so its area label stays muted — the gold badge already marks it.
function areaAccentColor(tone, isRedSurface, isFixFirst, theme) {
  if (isRedSurface) {
    if (tone === 'bad' || tone === 'good') return semantic.winner.dark;
    return CREAM_70;
  }
  if (isFixFirst) return theme.text.muted;
  if (tone === 'bad') return theme.destructive;
  if (tone === 'good') return theme.scoreColor('good');
  return theme.text.muted;
}

function makeStyles(theme) {
  const kicker = {
    color: theme.text.muted,
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Bold',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  };
  const goldOnCard = theme.isDark ? semantic.winner.dark : semantic.winner.light;
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.border.default,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    cardRed: { backgroundColor: RED, borderColor: RED },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
    kicker,
    kickerRed: { color: CREAM_70 },
    fixFirstBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.isDark ? 'rgba(255,215,0,0.16)' : 'rgba(169,130,30,0.12)',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    fixFirstBadgeText: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: goldOnCard,
    },
    area: kicker,
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: theme.text.primary },
    titleRed: { color: CREAM },
    reason: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary },
    reasonRed: { color: CREAM_85 },
    bottomRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.spacing.md },
    metric: { fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, flexShrink: 1 },
    pointsCaption: { fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted },
    chips: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: theme.spacing.xs, flex: 1 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: theme.bg.secondary,
    },
    chipRed: { backgroundColor: 'rgba(243,239,230,0.12)' },
    chipText: { fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.secondary },
    chipTextRed: { color: CREAM_85 },
    // Tappable ⇒ Masters green. On the red surface the button flips to cream
    // so it does not fight the alarm color.
    focusBtn: {
      backgroundColor: theme.accent.primary,
      borderRadius: 999,
      paddingVertical: 9,
      paddingHorizontal: 14,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: theme.spacing.xs,
    },
    focusBtnRed: { backgroundColor: CREAM },
    focusBtnText: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.inverse },
    focusBtnTextRed: { color: RED },
  });
}

export { GROUP_LABELS };
