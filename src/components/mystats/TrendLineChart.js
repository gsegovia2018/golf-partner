import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { scalePoints, toSegments, dropGaps as dropGapEntries } from './chartGeometry';

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

  const compact = variant === 'compact';
  const height = compact ? 92 : 150;
  const padX = 22;
  const padTop = compact ? 22 : 30;
  const padBottom = compact ? 22 : 26;
  const dotR = compact ? 3.6 : 4.2;
  const fontSize = compact ? 10 : 11;

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
            {!compact && (
              <>
                <Line x1={padX / 2} y1={padTop} x2={width - padX / 2} y2={padTop} stroke={theme.border.default} strokeWidth="1" />
                <Line x1={padX / 2} y1={height - padBottom} x2={width - padX / 2} y2={height - padBottom} stroke={theme.border.default} strokeWidth="1" />
              </>
            )}
            {segments.map((seg, i) => (
              <Polyline
                key={`seg-${i}`}
                points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={stroke}
                strokeWidth={compact ? 2.8 : 3.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {drawn.map((p, i) => {
              const labelAbove = p.y > height * 0.32;
              const ly = labelAbove ? p.y - dotR - 5 : p.y + dotR + fontSize + 2;
              return (
                <React.Fragment key={`pt-${i}`}>
                  <Circle cx={p.x} cy={p.y} r={dotR} fill={stroke} />
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
