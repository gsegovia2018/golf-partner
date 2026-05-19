import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { scalePoints, toSegments } from './chartGeometry';

// series: [{ label, value }]  — value may be null for a gap.
// variant: 'full' (default) | 'compact'.
// formatValue: (number) => string  — used for the on-dot labels.
export default function TrendLineChart({
  series = [],
  color,
  labelColor,
  variant = 'full',
  formatValue = (v) => `${v}`,
  caption,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const stroke = color || theme.accent.primary;
  const labelFill = labelColor || theme.text.primary;

  const compact = variant === 'compact';
  const width = 300;
  const height = compact ? 56 : 104;
  const padX = 18;
  const padTop = compact ? 14 : 20;
  const padBottom = compact ? 14 : 16;
  const dotR = compact ? 3.2 : 3.6;
  const fontSize = compact ? 9 : 9.5;

  const points = useMemo(
    () => scalePoints(series.map((p) => p.value), { width, height, padX, padTop, padBottom }),
    [series],
  );
  const drawn = points.filter((p) => p.y != null);
  const segments = useMemo(() => toSegments(points), [points]);

  if (drawn.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>Not enough rounds yet.</Text>
      </View>
    );
  }

  return (
    <View>
      {caption ? <Text style={s.caption}>{caption}</Text> : null}
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
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
            strokeWidth={compact ? 2.6 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {drawn.map((p, i) => {
          const labelAbove = p.y > height * 0.32;
          const ly = labelAbove ? p.y - dotR - 4 : p.y + dotR + fontSize + 1;
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
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: 2 },
    empty: { paddingVertical: theme.spacing.md, alignItems: 'center' },
    emptyText: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
  });
}
