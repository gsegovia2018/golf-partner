import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import CountUpText from './CountUpText';
import PressableScale from '../ui/PressableScale';
import Reveal from '../ui/Reveal';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;
const COL_H = 90;
// Selection frame around a column: always present (transparent when
// unselected) so toggling never shifts layout. The stack is taller by the
// frame so the inner content area stays exactly COL_H.
const SELECT_BORDER = 2;

// ~10% wash of a 6-digit hex theme color, for the delta pill and the soft
// double-bogey band (same helper as ShotDashboard/SparklineRow).
function withAlpha(hex, alpha) {
  const m = /^#([a-f\d]{6})$/i.exec(hex ?? '');
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Each column grows up from its baseline (scaleY 0→1, origin bottom),
// staggered left-to-right. Reduced motion ⇒ static full-height column.
// Mirrors GrowRow in ScoreMixBar.js.
function GrowColumn({ delay, style, testID, accessibilityLabel, children }) {
  const reduced = useReducedMotion();
  const scaleY = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleY.value = withDelay(delay, withTiming(1, { duration: 300, easing: EASE_OUT }));
    }
  }, [reduced, scaleY, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[style, animatedStyle]}
    >
      {children}
    </Animated.View>
  );
}

// Damage headline: latest round's strokes-lost-past-bogey vs the average of
// the other selected rounds. Accessible tinted-pill delta chip — green ▼
// when the latest round leaked less than average, red ▲ when more, muted
// "level" pill inside half a stroke.
function damageDelta(damage) {
  const values = damage.map((d) => d.value).filter((v) => v != null);
  if (values.length === 0) return { latest: null, delta: null };
  const latest = values[values.length - 1];
  const others = values.slice(0, -1);
  if (others.length === 0) return { latest, delta: null };
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  return { latest, delta: latest - avg };
}

// Compact damage headline for the Score mix SectionCard HEADER (its `right`
// slot): red serif number + (i), with the vs-average delta chip stacked
// underneath. The explainer sheet carries the "strokes lost past bogey"
// copy — no overline here.
export function DamageHeader({ damage = [], onInfo }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const s = useMemo(() => makeHeaderStyles(theme), [theme]);
  const { latest, delta } = damageDelta(damage);
  const level = delta != null && Math.abs(delta) < 0.5;
  const lower = delta != null && delta <= -0.5;
  const chipColor = level ? theme.text.muted : lower ? theme.accent.primary : theme.destructive;
  const chipText = level
    ? 'level with your average'
    : `${lower ? '▼' : '▲'} ${Math.round(Math.abs(delta))} vs your average`;
  const chipA11y = level
    ? 'Level with your average of the other rounds'
    : `${Math.round(Math.abs(delta))} strokes ${lower ? 'below' : 'above'} your average of the other rounds`;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Text
          style={s.value}
          testID="scoremix-damage-value"
          accessibilityLabel={latest == null
            ? 'Damage: no data'
            : `Damage: ${latest} strokes lost past bogey in the latest round`}
        >
          {latest == null ? '—' : (
            <CountUpText value={latest} duration={500} disabled={reduced} />
          )}
        </Text>
        {onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo('damage')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="What is Damage"
          >
            <Feather name="info" size={12} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {delta != null ? (
        <View
          accessible
          testID="scoremix-damage-chip"
          style={[s.deltaChip, { backgroundColor: withAlpha(chipColor, 0.12) }]}
          accessibilityLabel={chipA11y}
        >
          <Text style={[s.deltaChipText, { color: chipColor }]}>{chipText}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Column footer label: formSeries labels are "Course · 12 May" when the
// round's tournament carries a date (personalStats.shortDate) — show just
// the short date. Undated rounds fall back to a compact round ordinal.
const DATE_PART = /^\d{1,2} \S{3,5}$/;
export function columnDateLabel(label, index) {
  const parts = String(label ?? '').split(' · ');
  const last = parts[parts.length - 1];
  return parts.length > 1 && DATE_PART.test(last) ? last : `R${index + 1}`;
}

// Detail line for a selected column: full round label + that round's
// blow-up counts and damage figure.
function detailText(r, index, damageValue) {
  const name = r.label || `Round ${index + 1}`;
  return `${name} — ${r.double} double${r.double === 1 ? '' : 's'} · ${r.worse} worse`
    + ` · damage ${damageValue ?? '—'}`;
}

// "Score mix" card body: per-round stacked columns of the five-band GROSS
// score mix (birdie+ → worse) in ScoreMixBar's visual language — one column
// per round labelled with its short date, the latest at full opacity,
// earlier rounds stepped back — plus a compact legend. Tapping a column
// selects it (full opacity + a 2px frame) and reveals a per-round detail
// line; tapping again deselects. The damage headline lives in the card
// header (DamageHeader above), not here.
//   rounds: formSeries.scoreMix  [{ label, birdiePlus, par, bogey, double, worse }]
//   damage: formSeries.damage    [{ label, value }] — for the detail line
export default function ScoreMixColumns({ rounds = [], damage = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [selected, setSelected] = useState(null);
  const C = {
    birdiePlus: theme.accent.primary,
    par: '#7fb59f',
    bogey: '#e7d7b4',
    double: withAlpha(theme.destructive, 0.45),
    worse: theme.destructive,
  };

  if (rounds.length < 2) {
    return <Text style={s.empty}>Select two or more rounds to see the score mix.</Text>;
  }

  return (
    <View style={s.wrap}>
      <View style={s.columnsRow}>
        {rounds.map((r, i) => {
          const total = r.birdiePlus + r.par + r.bogey + r.double + r.worse || 1;
          const isLatest = i === rounds.length - 1;
          const isSelected = selected === i;
          const segs = [
            { key: 'birdiePlus', count: r.birdiePlus, color: C.birdiePlus },
            { key: 'par', count: r.par, color: C.par },
            { key: 'bogey', count: r.bogey, color: C.bogey },
            { key: 'double', count: r.double, color: C.double },
            { key: 'worse', count: r.worse, color: C.worse },
          ].filter((seg) => seg.count > 0);
          return (
            <PressableScale
              key={r.label ?? i}
              style={s.col}
              activeScale={0.97}
              onPress={() => setSelected((cur) => (cur === i ? null : i))}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID={`scoremix-col-press-${i}`}
            >
              <GrowColumn
                delay={i * STAGGER_MS}
                style={[
                  s.stack,
                  !isLatest && !isSelected && s.stackPast,
                  isSelected && s.stackSelected,
                ]}
                testID={`scoremix-col-${i}`}
                accessibilityLabel={
                  `${r.label || `Round ${i + 1}`}: ${r.birdiePlus} birdie or better, ${r.par} par, `
                  + `${r.bogey} bogey, ${r.double} double bogey, ${r.worse} worse`
                }
              >
                {segs.map((seg, j) => (
                  <View
                    key={seg.key}
                    testID={`scoremix-col-${i}-${seg.key}`}
                    style={[
                      s.segment,
                      { height: (seg.count / total) * COL_H, backgroundColor: seg.color },
                      j === 0 && s.segmentTop,
                    ]}
                  />
                ))}
              </GrowColumn>
              <Text style={s.colLabel} numberOfLines={1}>{columnDateLabel(r.label, i)}</Text>
            </PressableScale>
          );
        })}
      </View>

      {selected != null && rounds[selected] ? (
        <Reveal key={selected} duration={150} dy={4}>
          <Text style={s.detail} testID="scoremix-detail">
            {detailText(rounds[selected], selected, damage[selected]?.value)}
          </Text>
        </Reveal>
      ) : null}

      <View style={s.legend}>
        {[
          ['Birdie+', C.birdiePlus], ['Par', C.par], ['Bogey', C.bogey],
          ['Double', C.double], ['Worse', C.worse],
        ].map(([label, color]) => (
          <View key={label} style={s.lg}>
            <View style={[s.sw, { backgroundColor: color }]} />
            <Text style={s.lgText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeHeaderStyles(theme) {
  return StyleSheet.create({
    wrap: { alignItems: 'flex-end', gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    value: {
      fontFamily: 'PlayfairDisplay-Bold',
      fontSize: 22,
      color: theme.destructive,
      fontVariant: ['tabular-nums'],
    },
    deltaChip: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    deltaChipText: {
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
  });
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.sm },
    empty: {
      ...theme.typography.caption,
      color: theme.text.muted,
      fontStyle: 'italic',
      paddingVertical: theme.spacing.md,
      textAlign: 'center',
    },
    columnsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 6,
    },
    col: { flex: 1, minWidth: 0, gap: 4, alignItems: 'stretch' },
    stack: {
      height: COL_H + SELECT_BORDER * 2,
      transformOrigin: 'bottom',
      borderWidth: SELECT_BORDER,
      borderColor: 'transparent',
      borderTopLeftRadius: 6,
      borderTopRightRadius: 6,
      overflow: 'hidden',
    },
    stackPast: { opacity: 0.8 },
    stackSelected: { borderColor: theme.text.primary },
    segment: { width: '100%' },
    segmentTop: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    colLabel: {
      ...theme.typography.tiny,
      fontSize: 9,
      color: theme.text.muted,
      fontWeight: '700',
      textAlign: 'center',
    },
    detail: {
      ...theme.typography.tiny,
      color: theme.text.secondary,
      fontWeight: '600',
    },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, rowGap: 4 },
    lg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sw: { width: 10, height: 10, borderRadius: 3 },
    lgText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
