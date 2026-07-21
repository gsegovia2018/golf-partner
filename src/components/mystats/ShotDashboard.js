import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import PressableScale from '../ui/PressableScale';
import SectionCard from './SectionCard';
import StatTile from './StatTile';
import { SGBarTrack } from './SGBars';
import {
  APPROACH_BUCKETS,
  MIN_SG_CATEGORY_SAMPLE,
  PUTT_BUCKETS,
  SG_CATEGORIES,
  formatSignedFixed,
  sampleText,
} from './shotMetrics';

// The target-gap hero is a quiet inset panel on the white card — analysis
// is information, so it wears info-blue chrome rather than a hero surface.
// It never turns red: a negative SG total vs the target is the standing
// state for most players, and a permanent red stops meaning anything. Red
// survives only as small-scale accents in the category board (negative
// values and down-deltas), never as a full card surface.

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const CATEGORY_ICONS = {
  offTheTee: 'flag',
  approach: 'crosshair',
  aroundGreen: 'target',
  putting: 'circle',
  penalties: 'alert-triangle',
};

// 4px progress-to-unlock bar for locked categories. Fills via scaleX from the
// left, 400ms ease-out, staggered 40ms per board row; reduced motion ⇒ static.
function LockProgress({ pct, index }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scale.value = withDelay(index * 40, withTiming(1, { duration: 400, easing: EASE_OUT }));
    }
  }, [reduced, scale, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scale.value }],
  }));

  return (
    <View testID="sg-lock-track" style={[styles.lockTrack, { backgroundColor: theme.bg.secondary }]}>
      <Animated.View
        testID="sg-lock-fill"
        style={[
          styles.lockFill,
          // Unlock progress is information, not performance — info blue.
          { width: `${pct}%`, backgroundColor: theme.info, transformOrigin: 'left center' },
          animatedStyle,
        ]}
      />
    </View>
  );
}

function CategoryIconDisc({ tone, icon }) {
  const { theme } = useTheme();
  const tint = tone === 'good' ? withAlpha(theme.accent.primary, 0.14)
    : tone === 'bad' ? withAlpha(theme.destructive, 0.12)
      : theme.bg.secondary;
  const color = tone === 'good' ? theme.accent.primary
    : tone === 'bad' ? theme.destructive
      : theme.text.muted;
  return (
    <View style={[styles.disc, { backgroundColor: tint }]}>
      <Feather name={icon} size={13} color={color} />
    </View>
  );
}

function BoardRow({ category, strokesGained, footnote, index }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const sample = strokesGained?.sampleHolesByCategory?.[category.key] ?? 0;

  if (sample < MIN_SG_CATEGORY_SAMPLE) {
    return (
      <View style={s.boardRow} testID={`sg-board-row-${category.key}`}>
        <CategoryIconDisc tone="locked" icon="lock" />
        <View style={s.boardBody}>
          <View style={s.nameLine}>
            <Text style={s.name}>{category.label}</Text>
            <Text style={s.lockNote}>{`needs ${MIN_SG_CATEGORY_SAMPLE - sample} more holes`}</Text>
          </View>
          <LockProgress pct={(sample / MIN_SG_CATEGORY_SAMPLE) * 100} index={index} />
        </View>
      </View>
    );
  }

  const value = strokesGained?.byCategory?.[category.key];
  const tone = value > 0 ? 'good' : value < 0 ? 'bad' : 'neutral';
  const valueColor = tone === 'good' ? theme.scoreColor('good')
    : tone === 'bad' ? theme.destructive
      : theme.text.muted;
  const delta = strokesGained?.personalDelta?.[category.key];
  const showDelta = delta?.delta != null && delta.delta !== 0;
  const up = delta?.direction === 'up';
  const deltaColor = up ? theme.scoreColor('good') : theme.destructive;

  return (
    <View style={s.boardRow} testID={`sg-board-row-${category.key}`}>
      <CategoryIconDisc tone={tone} icon={CATEGORY_ICONS[category.key] ?? 'circle'} />
      <View style={s.boardBody}>
        <View style={s.nameLine}>
          <Text style={s.name}>{category.label}</Text>
          <Text style={s.sample}>{sampleText(sample, 'holes')}</Text>
        </View>
        <SGBarTrack value={value ?? 0} style={s.boardTrack} />
        {footnote ? <Text style={s.footnote} numberOfLines={1}>{footnote}</Text> : null}
      </View>
      <View style={s.boardRight}>
        <Text style={[s.value, { color: valueColor }]}>{formatSignedFixed(value)}</Text>
        {showDelta ? (
          <View
            accessible
            style={[s.deltaChip, { backgroundColor: withAlpha(deltaColor, 0.1) }]}
            accessibilityLabel={`${up ? 'Up' : 'Down'} ${Math.abs(delta.delta)} strokes gained vs your previous rounds`}
          >
            <Feather name={up ? 'trending-up' : 'trending-down'} size={11} color={deltaColor} />
            <Text style={[s.deltaChipText, { color: deltaColor }]}>
              {`${delta.delta > 0 ? '+' : ''}${delta.delta}`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Weakest-category call-out: name the thinnest sample when anything is still
// gated, otherwise confirm the tracked base.
function evidenceMeta(strokesGained) {
  const samples = strokesGained?.sampleHolesByCategory;
  if (!samples) return 'Bucketed from logged shots.';
  const gated = SG_CATEGORIES
    .map((c) => ({ label: c.label, sample: samples[c.key] ?? 0 }))
    .filter((c) => c.sample < MIN_SG_CATEGORY_SAMPLE)
    .sort((a, b) => a.sample - b.sample);
  if (gated.length === 0) return 'All five categories sampled.';
  return `${gated[0].label}: needs ${MIN_SG_CATEGORY_SAMPLE - gated[0].sample} more holes`;
}

// Fold buildShotSignals output into the board: each category keeps its single
// strongest bucket-level signal as a row footnote (the `sg-` self-signals are
// skipped — the row already shows that number); anything that maps to no
// category surfaces as a compact footer line under the board (max 2).
function mapSignalsToBoard(signals) {
  const byCategory = {};
  const extras = [];
  [...signals.good, ...signals.bad].forEach((sig) => {
    if (sig.id.startsWith('sg-')) return;
    const cat = SG_CATEGORIES.find((c) => c.area === sig.area);
    if (!cat) {
      extras.push(sig);
      return;
    }
    const current = byCategory[cat.key];
    if (!current || Math.abs(sig.score) > Math.abs(current.score)) byCategory[cat.key] = sig;
  });
  return {
    footnotes: Object.fromEntries(
      Object.entries(byCategory).map(([key, sig]) => [key, `${sig.title}: ${sig.metric}`])
    ),
    extras: extras.slice(0, 2).map((sig) => `${sig.area} · ${sig.title}: ${sig.metric}`),
  };
}

export default function ShotDashboard({ stats, targetHandicap, onChangeTarget, onInfo, TargetNudge }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const strokesGained = stats?.strokesGained;
  const hasStrokesGained = strokesGained?.total != null;
  const signals = useMemo(() => buildShotSignals(stats), [stats]);
  const board = useMemo(() => mapSignalsToBoard(signals), [signals]);
  const targetCopy = targetTitle(targetHandicap);
  const sample = sampleText(strokesGained?.sampleHoles, 'holes') ?? trackedSample(stats);

  return (
    <SectionCard
      title={`Strokes gained · vs ${targetLabel(targetHandicap)}`}
      infoKey="strokesGained"
      onInfo={onInfo}
      right={
        onChangeTarget ? (
          <PressableScale
            onPress={onChangeTarget}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Change target handicap"
          >
            <Feather name="edit-2" size={14} color={theme.text.secondary} />
          </PressableScale>
        ) : null
      }
    >
      <View style={s.hero} testID="sg-hero-surface">
        <Text style={s.heroKicker}>Target gap</Text>
        <Text style={[s.heroValue, hasStrokesGained && { color: theme.isDark ? semantic.winner.dark : semantic.winner.light }]}>
          {hasStrokesGained ? `${formatSignedFixed(strokesGained.total)} / round` : '-'}
        </Text>
        <Text style={s.heroMeta}>{hasStrokesGained ? targetCopy : 'Log putt distance and regulation approach shots.'}</Text>
        <View style={s.heroGrid}>
          <StatTile surface="hero" value={sample ?? 'Tracked data'} caption="Evidence" />
        </View>
        <Text style={s.heroFootnote}>{evidenceMeta(strokesGained)}</Text>
      </View>

      {strokesGained?.byCategory ? (
        <View style={s.board}>
          {SG_CATEGORIES.map((category, index) => (
            <BoardRow
              key={category.key}
              category={category}
              strokesGained={strokesGained}
              footnote={board.footnotes[category.key]}
              index={index}
            />
          ))}
          {board.extras.map((line) => (
            <Text key={line} style={s.extraLine} numberOfLines={1}>{line}</Text>
          ))}
          {TargetNudge && strokesGained.sampleHoles >= 18
            && (targetHandicap == null || targetHandicap === 0)
            && <TargetNudge onTap={onChangeTarget} />}
        </View>
      ) : null}
    </SectionCard>
  );
}

// ~10% wash of a 6-digit hex theme color, for icon discs and delta chips.
function withAlpha(hex, alpha) {
  const m = /^#([a-f\d]{6})$/i.exec(hex ?? '');
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function targetTitle(targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return 'Strokes gained vs scratch';
  return `Strokes gained vs ${targetHandicap}-handicap target`;
}

// Short form for the card header, e.g. "12-hcp target" / "scratch target".
function targetLabel(targetHandicap) {
  if (targetHandicap == null || targetHandicap === 0) return 'scratch target';
  return `${targetHandicap}-hcp target`;
}

function trackedSample(stats) {
  if (stats?.shots?.putts?.holes != null) return sampleText(stats.shots.putts.holes, 'holes');
  if (stats?.teeShot?.fairway?.holes != null || stats?.teeShot?.missed?.holes != null) {
    return sampleText((stats.teeShot.fairway?.holes ?? 0) + (stats.teeShot.missed?.holes ?? 0), 'holes');
  }
  return undefined;
}

function buildShotSignals(stats) {
  const good = [];
  const bad = [];
  const push = (signal) => {
    if (signal.score >= 0) good.push(signal);
    else bad.push(signal);
  };

  SG_CATEGORIES.forEach((category) => {
    const value = stats?.strokesGained?.byCategory?.[category.key];
    if (value == null) return;
    push({
      id: `sg-${category.key}`,
      area: category.area,
      title: category.signalTitle ?? category.label,
      metric: `${formatSignedFixed(value)} SG/rnd`,
      detail: `${sampleText(stats?.strokesGained?.sampleHoles, 'holes') ?? 'Tracked holes'} against target.`,
      score: value,
    });
  });

  const puttingRounds = stats?.strokesGained?.roundsByCategory?.putting ?? 0;
  PUTT_BUCKETS.forEach((bucket) => {
    const row = stats?.puttingTarget?.buckets?.[bucket];
    if (!row || row.attempts === 0 || row.sgPerPutt == null || puttingRounds === 0) return;
    const perRound = (row.sgPerPutt * row.attempts) / puttingRounds;
    push({
      id: `putt-${bucket}`,
      area: 'Putting',
      title: `${bucket} m putts`,
      metric: `${formatSignedFixed(perRound)} SG/rnd`,
      detail: `${row.avgPutts} avg vs ${row.expectedPutts} target · ${sampleText(row.attempts, 'putts')}`,
      score: perRound,
    });
  });

  const approachRounds = stats?.strokesGained?.roundsByCategory?.approach ?? 0;
  APPROACH_BUCKETS.forEach((bucket) => {
    const row = stats?.approachTarget?.buckets?.[bucket];
    if (!row || row.holes === 0 || row.avgSg == null || approachRounds === 0) return;
    const perRound = (row.avgSg * row.holes) / approachRounds;
    push({
      id: `approach-${bucket}`,
      area: 'Approach',
      title: `${bucket} m approaches`,
      metric: `${formatSignedFixed(perRound)} SG/rnd`,
      detail: `${row.greenRate ?? row.girRate}% green · ${sampleText(row.holes, 'shots')}`,
      score: perRound,
    });
  });

  good.sort((a, b) => b.score - a.score);
  bad.sort((a, b) => a.score - b.score);
  return { good, bad };
}

// Static (theme-independent) pieces of the board rows.
const styles = {
  disc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
  },
  lockFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
};

function makeStyles(theme) {
  return StyleSheet.create({
    hero: {
      backgroundColor: theme.bg.secondary,
      borderRadius: 16,
      padding: theme.spacing.lg,
      gap: theme.spacing.xs,
    },
    heroKicker: {
      color: theme.info,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    heroValue: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 34,
      lineHeight: 40,
      color: theme.text.primary,
    },
    heroMeta: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary },
    heroGrid: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    heroFootnote: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted },
    board: { paddingTop: theme.spacing.sm },
    boardRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    boardBody: { flex: 1, gap: 3 },
    nameLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
    name: { fontSize: 12.5, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.primary },
    sample: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted },
    lockNote: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted },
    // The base track style is built for a row layout (flex: 1, maxWidth 200).
    // In the board's column layout flex-basis must be auto or the height
    // collapses to 0 on web, and maxWidth needs an explicit full-width value
    // (undefined in a style array does not override an earlier value).
    boardTrack: {
      flexGrow: 0, flexShrink: 0, flexBasis: 'auto',
      height: 10, maxWidth: '100%',
    },
    footnote: { fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted },
    boardRight: { alignItems: 'flex-end', gap: 4, minWidth: 46 },
    value: {
      fontSize: 12.5,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
    },
    deltaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    deltaChipText: { fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', fontVariant: ['tabular-nums'] },
    extraLine: {
      fontSize: 10.5,
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.muted,
      paddingTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
  });
}

export { buildShotSignals };
