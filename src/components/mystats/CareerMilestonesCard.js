import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { useT, formatNumber } from '../../i18n';
import { semantic } from '../../theme/tokens';
import CountUpText from './CountUpText';
import { renderMsg } from './msg';

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
// day — and each carries the handicap it was scored off, so the number is
// read in its own era rather than against today's. Best differential is the
// handicap-free record beside them.

const STAGGER_MS = 60;
const COUNT_MS = 500;

// The era a net points record belongs to. The handicap INDEX is the number
// golfers think in, so it wins when the round carries its own frozen
// snapshot; older rounds have no recoverable index (players[].handicap was
// overwritten in place before tournamentStore started freezing it), and fall
// back to the playing handicap — labelled "shots" so it is never misread as
// an index.
const era = (index, handicap) => {
  if (index != null) return { key: 'stats.my.milestones.eraIndex', params: { index: formatNumber(index) } };
  if (handicap != null) return { key: 'stats.my.milestones.eraShots', params: { shots: formatNumber(handicap) } };
  return null;
};

// Order matters: the gold "Best round" cell is last so its count-up lands
// last in the stagger.
const CELLS = [
  { key: 'birdies', label: 'stats.my.milestones.birdies', get: (m) => m.birdies ?? 0 },
  { key: 'eagles', label: 'stats.my.milestones.eagles', get: (m) => m.eagles ?? 0 },
  { key: 'par-streak', label: 'stats.my.milestones.parStreak', get: (m) => m.longestParStreak ?? 0 },
  {
    key: 'best-nine',
    label: 'stats.my.milestones.bestNine',
    get: (m) => m.bestNine,
    suffix: 'stats.my.milestones.ptsSuffix',
    note: (m) => era(m.bestNineIndex, m.bestNineHandicap),
  },
  // The only non-integer cell — differentials are reported to one decimal,
  // so it counts up in tenths rather than flashing a rounded whole number.
  { key: 'best-diff', label: 'stats.my.milestones.bestDiff', get: (m) => m.bestDifferential, decimals: 1 },
  {
    key: 'best-round',
    label: 'stats.my.milestones.bestRound',
    get: (m) => m.bestRound,
    suffix: 'stats.my.milestones.ptsSuffix',
    gold: true,
    // The handicap that round was scored off — without it a career-best
    // point total silently invites comparison with rounds played off a
    // different handicap.
    note: (m) => era(m.bestRoundIndex, m.bestRoundHandicap),
  },
];

// Matches what CountUpText renders, so the accessibility label and the
// visible number never disagree on precision.
const fmt = (value, cell) => (cell.decimals ? formatNumber(value, { decimals: cell.decimals }) : formatNumber(value));

export default function CareerMilestonesCard({ milestones, onInfo }) {
  const { theme } = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const m = milestones ?? {};

  return (
    <View style={s.board} testID="career-milestones-board">
      <View style={s.head}>
        <Text style={s.kicker}>{t('stats.my.milestones.title')}</Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('careerMilestones')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('stats.my.whatIs', { name: t('stats.my.milestones.title') })}
          >
            <Feather name="info" size={14} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={s.grid}>
        {CELLS.map((cell, i) => {
          const value = cell.get(m);
          const has = Number.isFinite(value);
          const noteMsg = has && cell.note ? cell.note(m) : null;
          const note = noteMsg ? renderMsg(noteMsg) : null;
          const label = t(cell.label);
          const suffix = cell.suffix ? t(cell.suffix) : '';
          return (
            <View
              key={cell.key}
              style={[s.cell, has && value === 0 && s.cellZero]}
              accessible
              accessibilityLabel={!has
                ? t('stats.my.milestones.a11yNone', { label })
                : t(note ? 'stats.my.milestones.a11yNote' : 'stats.my.milestones.a11yPlain', {
                  label, value: fmt(value, cell), suffix, note,
                })}
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
                {has && cell.suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
              </Text>
              <Text style={s.label}>{label}</Text>
              {note ? (
                <Text style={s.note} testID={`milestone-${cell.key}-note`}>{note}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={s.footnote}>{t('stats.my.milestones.footnote')}</Text>
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
