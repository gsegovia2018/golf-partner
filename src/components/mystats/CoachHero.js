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

// Clubhouse hero surface — cream-on-green, matches LiveRoundCard.js. Tone no
// longer drives the whole card; the insight group picks the surface (problem
// groups go burgundy) and tone only accents the small `area` label.
const GREEN = '#0f3d2c';
// Deep Clubhouse burgundy — same value range as GREEN so cream text keeps
// identical contrast on the "fix first" / "getting worse" surface.
const BURGUNDY = '#4a1d1d';
const CREAM = '#f3efe6';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_85 = 'rgba(243,239,230,0.85)';

const RED_SURFACE_GROUPS = new Set(['fixFirst', 'gettingWorse']);

export default function CoachHero({ insight, onCommitFocus, focusActive = false }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const proofs = [insight?.basis, formatSample(insight?.sample), formatConfidence(insight?.confidence)].filter(Boolean);
  const isRedSurface = Boolean(insight && RED_SURFACE_GROUPS.has(insight.group));
  const surfaceColor = isRedSurface ? BURGUNDY : GREEN;
  const areaColor = areaAccentColor(insight?.tone, isRedSurface);

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
    <View style={[s.card, isRedSurface && { backgroundColor: BURGUNDY }]} testID="coach-hero-surface">
      <View style={s.topRow}>
        <Text style={s.kicker}>{GROUP_LABELS[insight.group] ?? 'Coach'}</Text>
        <Text style={[s.area, { color: areaColor }]}>{insight.areaLabel ?? insight.area}</Text>
      </View>
      <Text style={s.title}>{insight.title}</Text>
      {insight.reason ? <Text style={s.reason}>{insight.reason}</Text> : null}
      <View style={s.bottomRow}>
        {insight.metric ? (
          <View style={{ flexShrink: 1 }}>
            <Text style={s.metric}>{insight.metric}</Text>
            {Number.isFinite(insight.pointsPerRound) ? (
              <Text style={s.pointsCaption}>{formatPointsPerRound(insight.pointsPerRound)}</Text>
            ) : null}
          </View>
        ) : null}
        <View style={s.chips}>
          {proofs.map((proof) => (
            <View key={proof} style={s.chip}>
              <Feather name="check-circle" size={12} color={CREAM_85} />
              <Text style={s.chipText}>{proof}</Text>
            </View>
          ))}
        </View>
      </View>
      {onCommitFocus && insight && !focusActive ? (
        <PressableScale
          onPress={() => onCommitFocus(insight)}
          accessibilityRole="button"
          accessibilityLabel="Make this my focus"
          style={s.focusBtn}
        >
          <Feather name="target" size={14} color={surfaceColor} />
          <Text style={[s.focusBtnText, { color: surfaceColor }]}>Make this my focus</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

// Hero surface is a fixed dark color in both themes, so tone accents always
// use the dark-surface variants regardless of the active app theme. On the
// burgundy surface the light destructive red would vanish, so a 'bad' area
// label renders in winner gold there instead.
function areaAccentColor(tone, isRedSurface) {
  if (tone === 'bad') return isRedSurface ? semantic.winner.dark : semantic.destructive.dark;
  if (tone === 'good') return semantic.winner.dark;
  return CREAM_70;
}

function makeStyles(theme) {
  const kicker = {
    color: CREAM_70,
    fontSize: 10,
    fontFamily: 'PlusJakartaSans-Bold',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  };
  return StyleSheet.create({
    card: {
      backgroundColor: GREEN,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
    kicker,
    area: kicker,
    title: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 20, color: CREAM },
    reason: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_85 },
    bottomRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.spacing.md },
    metric: { fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: CREAM, flexShrink: 1 },
    pointsCaption: { fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_70 },
    chips: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: theme.spacing.xs, flex: 1 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: 'rgba(243,239,230,0.12)',
    },
    chipText: { fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', color: CREAM_85 },
    focusBtn: {
      backgroundColor: CREAM,
      borderRadius: 999,
      paddingVertical: 9,
      paddingHorizontal: 14,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: theme.spacing.xs,
    },
    focusBtnText: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-ExtraBold', color: GREEN },
  });
}

export { GROUP_LABELS };
