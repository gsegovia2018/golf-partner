// Small charts for the Game Stats Players tab (spec: the approved
// stats-viz mockup). Render only: every number arrives computed.
//   Ring          a share of a whole round, fraction in the centre
//   DotRow        k of n as dots (small denominators you can count)
//   PuttHistogram holes by putts: 1 / 2 / 3+ (0 only when it happened)
//   DivergingBars points per hole around 2 (playing to handicap)
//   ComparePlot   players on one axis, the selected one filled and labelled above
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { withAlpha } from '../../theme/alpha';
import { firstName } from './ui';

export function Ring({ ratio, center, size = 58, testID, accessibilityLabel }) {
  const { theme } = useTheme();
  const stroke = 6;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, ratio || 0));
  return (
    <View style={{ width: size, height: size }} testID={testID} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.bg.secondary} strokeWidth={stroke} />
        {f > 0 && (
          <Circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={theme.accent.primary} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        <Text
          style={{ fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.text.primary, fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >{center}</Text>
      </View>
    </View>
  );
}

export function DotRow({ k, n, testID, accessibilityLabel }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }} testID={testID} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {Array.from({ length: n }, (_, i) => (
        <View
          key={i}
          style={{
            width: 12, height: 12, borderRadius: 6, borderWidth: 1.5,
            backgroundColor: i < k ? theme.accent.primary : theme.bg.secondary,
            borderColor: i < k ? theme.accent.primary : theme.border.default,
          }}
        />
      ))}
    </View>
  );
}

// bars: [{ key, label, count, tone }] with tone 'good' | 'neutral' | 'poor'.
export function PuttHistogram({ bars, accessibilityLabel }) {
  const { theme } = useTheme();
  const max = Math.max(1, ...bars.map((b) => b.count));
  // The tone rule: a two-putt is mid, so its bar is ink-grey, not pale green.
  const fill = { good: theme.accent.primary, neutral: theme.text.secondary, poor: theme.destructive };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }} testID="putt-histogram" accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {bars.map((b) => (
        <View key={b.key} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
          <Text style={{ fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.text.primary, fontVariant: ['tabular-nums'] }}>{b.count}</Text>
          <View style={{ alignSelf: 'stretch', height: 8 + (b.count / max) * 56, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: fill[b.tone] }} />
          <Text style={{ fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary }}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const HALF = 58; // px for 0.6 pts/hole either side of 2
const PX_PER_PT = 100;

// groups: [{ key, label, items: [{ key, label, value, text }] }]
export function DivergingBars({ groups, caption, accessibilityLabel }) {
  const { theme } = useTheme();
  const s = useMemo(() => divStyles(theme), [theme]);
  return (
    <View testID="where-you-score" accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {groups.map((g) => (
        <View key={g.key}>
          <Text style={s.group}>{g.label}</Text>
          {g.items.map((it) => {
            const d = it.value - 2;
            const w = Math.max(2, Math.min(Math.abs(d) * PX_PER_PT, HALF));
            return (
              <View key={it.key} style={s.row} testID={`where-${it.key}`}>
                <Text style={s.label}>{it.label}</Text>
                <View style={s.track}>
                  <View style={s.half}>{d < 0 && <View style={[s.bar, { width: w, alignSelf: 'flex-end', backgroundColor: theme.destructive }]} />}</View>
                  <View style={s.mid} />
                  <View style={s.half}>{d >= 0 && <View style={[s.bar, { width: w, backgroundColor: d > 0 ? theme.accent.primary : theme.text.primary }]} />}</View>
                </View>
                <Text style={s.value}>{it.text}</Text>
              </View>
            );
          })}
        </View>
      ))}
      <View style={s.row}>
        <View style={{ flex: 1 }} />
        <Text style={[s.caption, { width: HALF * 2 + 1 }]} numberOfLines={2}>{caption}</Text>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );
}

const divStyles = (theme) => StyleSheet.create({
  group: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
    color: theme.text.secondary, marginTop: 6, marginBottom: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 22, gap: 8 },
  label: { flex: 1, minWidth: 0, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.primary },
  track: { flexDirection: 'row', alignItems: 'stretch', height: 22 },
  half: { width: HALF, justifyContent: 'center' },
  mid: { width: 1, backgroundColor: theme.border.default },
  bar: { height: 14, borderRadius: 3 },
  value: {
    width: 40, textAlign: 'right', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12,
    color: theme.text.primary, fontVariant: ['tabular-nums'],
  },
  caption: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 10, color: theme.text.secondary, textAlign: 'center', marginTop: 2 },
});

// values: [{ player, value, text }]; `selectedId` is drawn filled with its
// label above the axis, everyone else hollow with the label below.
export function ComparePlot({ values, max, selectedId, accessibilityLabel, testID }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const H = 48;
  const pad = 8;
  const x = (v) => pad + (Math.max(0, Math.min(max, v)) / max) * (width - pad * 2);
  const anchor = (px) => (px < 50 ? 'start' : px > width - 50 ? 'end' : 'middle');
  // Selected last so it sits on top.
  const ordered = [...values].sort((a, b) => Number(a.player.id === selectedId) - Number(b.player.id === selectedId));
  return (
    <View
      testID={testID}
      style={{ height: H }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {width > 0 && (
        <Svg width={width} height={H}>
          <Line x1={pad} x2={width - pad} y1={24} y2={24} stroke={theme.border.default} strokeWidth={3} strokeLinecap="round" />
          {ordered.map((v) => {
            const on = v.player.id === selectedId;
            const px = x(v.value);
            return (
              <React.Fragment key={v.player.id}>
                <Circle
                  cx={px} cy={24} r={on ? 7 : 5}
                  fill={on ? theme.accent.primary : theme.bg.card}
                  stroke={on ? theme.accent.primary : theme.text.muted} strokeWidth={2}
                />
                <SvgText
                  x={px} y={on ? 11 : 45} textAnchor={anchor(px)} fontSize={10}
                  fontFamily={on ? 'PlusJakartaSans-ExtraBold' : 'PlusJakartaSans-Medium'}
                  fontWeight={on ? '800' : '500'}
                  fill={on ? theme.accent.primary : theme.text.secondary}
                >{`${firstName(v.player)} ${v.text}`}</SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      )}
    </View>
  );
}
