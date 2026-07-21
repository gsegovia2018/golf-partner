import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import PressableScale from '../ui/PressableScale';
import Reveal from '../ui/Reveal';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export const HOLES_PER_ROW = 9;
// Grid-wave entrance: (rowIndex * 9 + colIndex) * 25ms, capped so a back
// nine never waits half a second to appear.
const WAVE_STEP_MS = 25;
const WAVE_CAP_MS = 450;

// Fixed scorecard tones (shared with ScoreMixArea's band colors).
const MID_GREEN = '#7fb59f';
const SAND = '#e7d7b4';
// Ink for the light sand cell — sand is a fixed color, so its ink is too.
const SAND_INK = '#3f3a28';

// Linear blend of two #rrggbb colors: t = 0 ⇒ a, t = 1 ⇒ b.
export function mixHex(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  const mixed = pa.map((va, i) => Math.round(va + (pb[i] - va) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Cell fill by avg-vs-par bucket, deep green (scoring hole) → destructive red
// (blow-up hole). Foreground stays theme-aware for contrast: theme.text.inverse
// is white on the light theme's saturated fills and dark ink on the dark
// theme's lighter accent/destructive tints; the fixed sand cell always takes
// fixed ink.
export function holeCellColors(theme, avgVsPar) {
  if (avgVsPar < 0) return { bg: theme.accent.primary, fg: theme.text.inverse };
  if (avgVsPar <= 0.75) return { bg: MID_GREEN, fg: theme.isDark ? theme.text.inverse : '#ffffff' };
  if (avgVsPar <= 1.5) return { bg: SAND, fg: SAND_INK };
  // "Mixed" bucket between sand and full destructive: destructive blended
  // ~0.6 over sand reads as a clear warning without shouting.
  if (avgVsPar <= 2.25) return { bg: mixHex(SAND, theme.destructive, 0.6), fg: theme.text.inverse };
  return { bg: theme.destructive, fg: theme.text.inverse };
}

export function holeA11yLabel(hole, { isNemesis, isBest } = {}) {
  const v = hole.avgVsPar;
  const vsPhrase = v > 0 ? `${v} over par` : v < 0 ? `${Math.abs(v)} under par` : 'level par';
  return `Hole ${hole.holeNumber}, par ${hole.par}, average ${hole.avgStrokes}, ${vsPhrase}`
    + (isNemesis ? ', nemesis hole' : '')
    + (isBest ? ', best hole' : '');
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

function HoleCell({
  hole, index, selected, isNemesis, isBest, onPress, theme, s,
}) {
  const reduced = useReducedMotion();
  const { bg, fg } = holeCellColors(theme, hole.avgVsPar);
  const gold = theme.isDark ? semantic.winner.dark : semantic.winner.light;

  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    progress.value = 0;
    progress.value = withDelay(
      Math.min(index * WAVE_STEP_MS, WAVE_CAP_MS),
      withTiming(1, { duration: 260, easing: EASE_OUT }),
    );
  }, [reduced, index, progress]);
  const entrance = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + 0.1 * progress.value }],
  }));

  const Wrap = reduced ? View : Animated.View;

  return (
    <Wrap style={[s.cellWrap, !reduced && entrance]}>
      <PressableScale
        activeScale={0.95}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={holeA11yLabel(hole, { isNemesis, isBest })}
        testID={`hole-cell-${hole.holeNumber}`}
        style={[
          s.cell,
          { backgroundColor: bg },
          // Constant borderWidth (transparent when unselected) so selecting
          // a cell never shifts layout.
          { borderColor: selected ? theme.text.primary : 'transparent' },
        ]}
      >
        <Text style={[s.cellNum, { color: fg }]}>{hole.holeNumber}</Text>
        <Text style={[s.cellVs, { color: fg }]}>{signed(hole.avgVsPar)}</Text>
        {isNemesis ? (
          <View testID="hole-dot-nemesis" style={[s.cellDot, { backgroundColor: theme.destructive }]} />
        ) : null}
        {isBest ? (
          <View testID="hole-dot-best" style={[s.cellDot, { backgroundColor: gold }]} />
        ) : null}
      </PressableScale>
    </Wrap>
  );
}

// Detail columns under the grid for the selected hole.
const PANEL_COLS = [
  { key: 'avg', label: 'Avg', get: (h) => h.avgStrokes },
  { key: 'best', label: 'Best', get: (h) => h.bestStrokes },
  { key: 'pts', label: 'Pts', get: (h) => h.avgPoints },
  { key: 'putts', label: 'Putts avg', get: (h) => h.avgPutts },
  { key: 'pen', label: 'Pen', get: (h) => h.penalties },
];

// Scorecard grid for the "Hole by hole" card: 9 cells per row colored by
// avg-vs-par, nemesis/best corner dots, and a tap-to-inspect detail panel
// below (defaults to the nemesis hole, else the first). Renders nothing
// without holes.
export default function HoleGrid({ holes, highlights }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const nemesisHole = highlights?.nemesis?.holeNumber ?? null;
  const bestHole = highlights?.best?.holeNumber ?? null;

  const [selected, setSelected] = useState(
    () => nemesisHole ?? holes?.[0]?.holeNumber ?? null,
  );

  if (!holes || holes.length === 0) return null;

  const selectedHole = holes.find((h) => h.holeNumber === selected) ?? holes[0];
  const rows = chunk(holes, HOLES_PER_ROW);

  return (
    <View style={s.wrap}>
      <View style={s.grid}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={s.row}>
            {row.map((hole, colIndex) => (
              <HoleCell
                key={hole.holeNumber}
                hole={hole}
                index={rowIndex * HOLES_PER_ROW + colIndex}
                selected={hole.holeNumber === selectedHole.holeNumber}
                isNemesis={hole.holeNumber === nemesisHole}
                isBest={hole.holeNumber === bestHole}
                onPress={() => setSelected(hole.holeNumber)}
                theme={theme}
                s={s}
              />
            ))}
            {/* Pad remainder rows with spacers so their cells keep the same
                size as full rows. */}
            {row.length < HOLES_PER_ROW
              ? Array.from({ length: HOLES_PER_ROW - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={s.cellWrap} />
              ))
              : null}
          </View>
        ))}
      </View>
      <Reveal key={selectedHole.holeNumber} duration={150} dy={4}>
        <View style={s.panel} testID={`hole-panel-${selectedHole.holeNumber}`}>
          <View style={s.panelHead}>
            <Text style={s.panelNum}>{selectedHole.holeNumber}</Text>
            <Text style={s.panelMeta}>
              {`Par ${selectedHole.par}`
                + (selectedHole.strokeIndex != null ? ` · SI ${selectedHole.strokeIndex}` : '')
                + ` · ${selectedHole.timesPlayed}x`}
            </Text>
          </View>
          <View style={s.panelCols}>
            {PANEL_COLS.map((col) => {
              const value = col.get(selectedHole);
              return (
                <View key={col.key} style={s.panelCol}>
                  <Text style={s.panelValue} testID={`hole-panel-${col.key}`}>
                    {value == null ? '—' : `${value}`}
                  </Text>
                  <Text style={s.panelLabel}>{col.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </Reveal>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.md },
    grid: { gap: 5 },
    row: { flexDirection: 'row', gap: 5 },
    cellWrap: { flex: 1, aspectRatio: 0.95 },
    cell: {
      flex: 1,
      borderRadius: 8,
      borderWidth: 2.5,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
    },
    cellNum: {
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
    },
    cellVs: {
      fontSize: 8,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
    cellDot: {
      position: 'absolute',
      top: 3,
      right: 3,
      width: 5,
      height: 5,
      borderRadius: 2.5,
    },
    panel: {
      backgroundColor: theme.bg.primary,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    panelHead: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm },
    panelNum: {
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 26,
      lineHeight: 32,
      color: theme.text.primary,
      fontVariant: ['tabular-nums'],
    },
    panelMeta: {
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.muted,
    },
    panelCols: { flexDirection: 'row' },
    panelCol: { flex: 1, gap: 2 },
    panelValue: {
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
      color: theme.text.primary,
    },
    panelLabel: {
      fontSize: 8.5,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: theme.text.muted,
    },
  });
}
