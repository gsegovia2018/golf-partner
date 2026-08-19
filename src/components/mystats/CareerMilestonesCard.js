import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import CountUpText from './CountUpText';

// Career-wide feats as an "honours board" — a plain white card with
// info-blue chrome: records are information, not performance. See
// `careerMilestones` in personalStats.js. bestNine/bestRound show '-' when
// there is no complete round yet; birdies/eagles/longestParStreak are always
// a count (0 is a real value, not "no data" — it renders dimmed, waiting to
// be earned).
//
// The per-hole feats are GROSS, matching the Strokes Gained tab's scoring
// mix: a net birdie was only ever a birdie because of the shot the stroke
// index handed over, so the count fell as the player improved. Best nine and
// best round stay NET point totals — they are the rounds that actually won a
// day — and carry the handicap they were scored off, so the number is read
// in its own era rather than against today's. Best differential is the
// handicap-free record beside them.

const STAGGER_MS = 60;
const COUNT_MS = 500;

// Order matters: the gold "Best round" cell is last so its count-up lands
// last in the stagger.
const CELLS = [
  { key: 'birdies', label: 'Birdies', get: (m) => m.birdies ?? 0 },
  { key: 'eagles', label: 'Eagles', get: (m) => m.eagles ?? 0 },
  { key: 'par-streak', label: 'Best par streak', get: (m) => m.longestParStreak ?? 0 },
  { key: 'best-nine', label: 'Best nine', get: (m) => m.bestNine, suffix: ' pts' },
  // The only non-integer cell — differentials are reported to one decimal,
  // so it counts up in tenths rather than flashing a rounded whole number.
  { key: 'best-diff', label: 'Best differential', get: (m) => m.bestDifferential, decimals: 1 },
  {
    key: 'best-round',
    label: 'Best round',
    get: (m) => m.bestRound,
    suffix: ' pts',
    gold: true,
    // The handicap that round was scored off — without it a career-best
    // point total silently invites comparison with rounds played off a
    // different handicap.
    note: (m) => (m.bestRoundHandicap == null ? null : `off ${m.bestRoundHandicap}`),
  },
];

// Matches what CountUpText renders, so the accessibility label and the
// visible number never disagree on precision.
const fmt = (value, cell) => (cell.decimals ? value.toFixed(cell.decimals) : `${value}`);

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
            <Feather name="info" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={s.grid}>
        {CELLS.map((cell, i) => {
          const value = cell.get(m);
          const has = Number.isFinite(value);
          const note = has && cell.note ? cell.note(m) : null;
          return (
            <View
              key={cell.key}
              style={[s.cell, has && value === 0 && s.cellZero]}
              accessible
              accessibilityLabel={`${cell.label}: ${has ? `${fmt(value, cell)}${cell.suffix ?? ''}${note ? ` ${note}` : ''}` : 'no complete round yet'}`}
              testID={`milestone-${cell.key}`}
            >
              <Text style={[s.number, cell.gold && s.numberGold]} testID={`milestone-${cell.key}-value`}>
                {has
                  ? (
                    <CountUpText
                      value={value}
                      duration={COUNT_MS}
                      delay={i * STAGGER_MS}
                      disabled={reduced}
                      decimals={cell.decimals ?? 0}
                    />
                  )
                  : '-'}
                {has && cell.suffix ? <Text style={s.suffix}>{cell.suffix}</Text> : null}
              </Text>
              <Text style={s.label}>{cell.label}</Text>
              {note ? (
                <Text style={s.note} testID={`milestone-${cell.key}-note`}>{note}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={s.footnote}>
        Birdies, eagles and streaks are gross — real strokes against par, no handicap shots.
        Best nine and best round are net points, shown with the handicap they were scored off.
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    board: {
      backgroundColor: theme.bg.card,
      borderWidth: 1,
      borderColor: theme.border.default,
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
      color: theme.text.muted,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: theme.spacing.md,
      columnGap: theme.spacing.sm,
    },
    // flexBasis 30% + grow → three columns; six cells fill exactly two rows.
    cell: { flexBasis: '30%', flexGrow: 1, gap: 2 },
    cellZero: { opacity: 0.55 },
    number: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 30,
      lineHeight: 36,
      color: theme.text.primary,
    },
    numberGold: { color: theme.isDark ? semantic.winner.dark : semantic.winner.light },
    suffix: { fontSize: 13, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted },
    label: {
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: theme.text.muted,
    },
    note: {
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
    },
    footnote: {
      fontSize: 10.5,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
      paddingTop: 10,
      marginTop: theme.spacing.xs,
    },
  });
}
