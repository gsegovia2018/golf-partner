import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import CountUpText from './CountUpText';

// Career-wide feats as an "honours board" — the Clubhouse dark-green hero
// surface IS the card (same constants as CoachHero.js / ShotDashboard.js,
// copied locally by convention rather than imported). See `careerMilestones`
// in personalStats.js. bestNine/bestRound show '-' when there is no complete
// round yet; birdies/eagles/longestParStreak are always a count (0 is a real
// value, not "no data" — it renders dimmed, waiting to be earned). Everything
// here is NET (handicap-adjusted) — the Strokes Gained tab's scoring-mix
// benchmark counts gross — so the footnote discloses the basis rather than
// silently disagreeing with that tab.
const GREEN = '#0f3d2c';
const CREAM = '#f3efe6';
const CREAM_85 = 'rgba(243,239,230,0.85)';
const CREAM_70 = 'rgba(243,239,230,0.7)';
const CREAM_65 = 'rgba(243,239,230,0.65)';
const CREAM_60 = 'rgba(243,239,230,0.6)';
const CREAM_55 = 'rgba(243,239,230,0.55)';
const HAIRLINE = 'rgba(243,239,230,0.14)';

const STAGGER_MS = 60;
const COUNT_MS = 500;

// Order matters: the gold "Best round" cell is last so its count-up lands
// last in the stagger.
const CELLS = [
  { key: 'birdies', label: 'Birdies', get: (m) => m.birdies ?? 0 },
  { key: 'eagles', label: 'Eagles', get: (m) => m.eagles ?? 0 },
  { key: 'par-streak', label: 'Best par streak', get: (m) => m.longestParStreak ?? 0 },
  { key: 'best-nine', label: 'Best nine', get: (m) => m.bestNine, suffix: ' pts' },
  { key: 'best-round', label: 'Best round', get: (m) => m.bestRound, suffix: ' pts', gold: true },
];

export default function CareerMilestonesCard({ milestones, onInfo }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const m = milestones ?? {};

  return (
    <View style={s.board} testID="career-milestones-board">
      <View style={s.head}>
        <Text style={s.kicker}>Career Milestones</Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('careerMilestones')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="What is Career Milestones"
          >
            <Feather name="info" size={14} color={CREAM_85} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={s.grid}>
        {CELLS.map((cell, i) => {
          const value = cell.get(m);
          const has = Number.isFinite(value);
          return (
            <View
              key={cell.key}
              style={[s.cell, has && value === 0 && s.cellZero]}
              accessible
              accessibilityLabel={`${cell.label}: ${has ? `${value}${cell.suffix ?? ''}` : 'no complete round yet'}`}
              testID={`milestone-${cell.key}`}
            >
              <Text style={[s.number, cell.gold && s.numberGold]} testID={`milestone-${cell.key}-value`}>
                {has
                  ? <CountUpText value={value} duration={COUNT_MS} delay={i * STAGGER_MS} disabled={reduced} />
                  : '-'}
                {has && cell.suffix ? <Text style={s.suffix}>{cell.suffix}</Text> : null}
              </Text>
              <Text style={s.label}>{cell.label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={s.footnote}>
        Net (handicap-adjusted) results — the Strokes Gained tab counts gross.
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    board: {
      backgroundColor: GREEN,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    kicker: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: CREAM_70,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: theme.spacing.md,
      columnGap: theme.spacing.sm,
    },
    // flexBasis 30% + grow → three columns, wrapping to a second row for the
    // last two cells.
    cell: { flexBasis: '30%', flexGrow: 1, gap: 2 },
    cellZero: { opacity: 0.55 },
    number: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 30,
      lineHeight: 36,
      color: CREAM,
    },
    numberGold: { color: semantic.winner.dark },
    suffix: { fontSize: 13, fontFamily: 'PlusJakartaSans-SemiBold', color: CREAM_60 },
    label: {
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: CREAM_65,
    },
    footnote: {
      fontSize: 10.5,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: CREAM_55,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: HAIRLINE,
      paddingTop: 10,
      marginTop: theme.spacing.xs,
    },
  });
}
