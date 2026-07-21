import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line, Path, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { scalePoints, toSegments, dropGaps as dropGapEntries } from './chartGeometry';

// SVG gradient ids are document-global on web; several charts render on one
// screen, so each instance mints its own id to avoid cross-contamination.
let gradientSeq = 0;

// series: [{ label, value }]  — value may be null for a gap.
// variant: 'full' (default) | 'compact'.
// formatValue: (number) => string  — used for the on-dot labels.
// dropGaps: remove null points entirely so the line connects — for
// round-total metrics where a skipped round isn't meaningful. Leave off for
// shot metrics, where a gap means "not tracked that round".
//
// The chart measures its own width (onLayout) and draws at a 1:1 viewBox, so
// it fills the card edge-to-edge with no letterboxing and the dots stay
// perfectly round. Heights are generous so the value labels never crowd.
export default function TrendLineChart({
  series = [],
  color,
  labelColor,
  variant = 'full',
  formatValue = (v) => `${v}`,
  caption,
  dropGaps = false,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const stroke = color || theme.accent.primary;
  const labelFill = labelColor || theme.text.primary;
  const [width, setWidth] = useState(0);
  const [gradId] = useState(() => `trend-area-grad-${gradientSeq++}`);

  const compact = variant === 'compact';
  const height = compact ? 92 : 150;
  const padX = 22;
  const padTop = compact ? 22 : 30;
  const padBottom = compact ? 22 : 26;
  const dotR = compact ? 2.8 : 3;
  const fontSize = compact ? 10 : 11;
  const baseY = height - padBottom;

  const data = dropGaps ? dropGapEntries(series) : series;
  const points = useMemo(
    () => (width > 0
      ? scalePoints(data.map((p) => p.value), { width, height, padX, padTop, padBottom })
      : []),
    [data, width, height, padTop, padBottom],
  );
  const drawn = points.filter((p) => p.y != null);
  const segments = useMemo(() => toSegments(points), [points]);

  // Empty state is decided from the data, not the (async) measured width.
  const hasData = series.some((p) => p.value != null);
  if (!hasData) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>Not enough rounds yet.</Text>
      </View>
    );
  }

  return (
    <View>
      {caption ? <Text style={s.caption}>{caption}</Text> : null}
      <View testID="trend-chart-canvas" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity="0.14" />
                <Stop offset="1" stopColor={stroke} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            {!compact && (
              <>
                <Line x1={padX / 2} y1={padTop} x2={width - padX / 2} y2={padTop} stroke={theme.border.default} strokeWidth="1" />
                <Line x1={padX / 2} y1={baseY} x2={width - padX / 2} y2={baseY} stroke={theme.border.default} strokeWidth="1" />
              </>
            )}
            {segments.map((seg, i) => (
              <Path
                key={`area-${i}`}
                d={`M${seg.map((p) => `${p.x},${p.y}`).join(' L')} L${seg[seg.length - 1].x},${baseY} L${seg[0].x},${baseY} Z`}
                fill={`url(#${gradId})`}
              />
            ))}
            {segments.map((seg, i) => (
              <Polyline
                key={`seg-${i}`}
                points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={stroke}
                strokeWidth={compact ? 2.4 : 2.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {drawn.map((p, i) => {
              const isLast = i === drawn.length - 1;
              const labelAbove = p.y > height * 0.32;
              const ly = labelAbove ? p.y - dotR - 5 : p.y + dotR + fontSize + 2;
              return (
                <React.Fragment key={`pt-${i}`}>
                  {isLast ? (
                    <Circle cx={p.x} cy={p.y} r={dotR + 1.5} fill={stroke} stroke={theme.bg.card} strokeWidth={2} />
                  ) : (
                    <Circle cx={p.x} cy={p.y} r={dotR} fill={stroke} />
                  )}
                  <SvgText
                    x={p.x}
                    y={ly}
                    fontSize={fontSize}
                    fontWeight="800"
                    fill={labelFill}
                    textAnchor="middle"
                  >
                    {formatValue(p.value)}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: 4 },
    empty: { paddingVertical: theme.spacing.md, alignItems: 'center' },
    emptyText: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
  });
}
