// Multi-series line chart with direct end labels (no legend), drawn with
// react-native-svg at the measured width. Shared by ProgressionChart and
// RaceChart. series: [{ key, label, values: (number|null)[], color, bold }];
// xLabels: one per value index ('' to skip a tick label).
import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Circle, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { formatNumber } from '../../i18n';
import { yAxis, nudgeLabels, linePath, lastIndex } from './lineChartGeometry';

const LEFT = 28;
const RIGHT = 70;
const TOP = 10;
const BOTTOM = 22;
const LABEL_GAP = 13;

const clip = (s, n = 11) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function LineChart({ series, xLabels, height = 170, accessibilityLabel, testID }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const n = xLabels.length;
  const maxValue = Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v != null)));
  const { max, ticks } = yAxis(maxValue);
  const iw = Math.max(1, width - LEFT - RIGHT);
  const ih = height - TOP - BOTTOM;
  const x = (i) => LEFT + (n <= 1 ? 0 : (i * iw) / (n - 1));
  const y = (v) => TOP + ih - (v * ih) / max;

  const ends = series.map((s) => {
    const li = lastIndex(s.values);
    return li < 0 ? null : { li, y: y(s.values[li]) };
  });
  const placed = nudgeLabels(ends.map((e) => (e ? e.y : TOP)), LABEL_GAP, TOP + 4, TOP + ih);
  // Draw the bold (leader) line last so it sits on top.
  const drawOrder = series.map((s, i) => i).sort((a, b) => Number(!!series[a].bold) - Number(!!series[b].bold));

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((tk) => (
            <React.Fragment key={`t${tk}`}>
              <Line x1={LEFT} x2={LEFT + iw} y1={y(tk)} y2={y(tk)} stroke={theme.border.default} strokeWidth={1} />
              <SvgText
                x={LEFT - 6} y={y(tk) + 3.5} fontSize={10} textAnchor="end"
                fill={theme.text.secondary} fontFamily="PlusJakartaSans-Medium"
              >{formatNumber(tk)}</SvgText>
            </React.Fragment>
          ))}
          {xLabels.map((lab, i) => (lab ? (
            <SvgText
              key={`x${i}`} x={x(i)} y={height - 6} fontSize={10} textAnchor="middle"
              fill={theme.text.secondary} fontFamily="PlusJakartaSans-Medium"
            >{lab}</SvgText>
          ) : null))}
          {drawOrder.map((i) => {
            const s = series[i];
            const end = ends[i];
            return (
              <React.Fragment key={s.key}>
                <Path
                  d={linePath(s.values, x, y)} fill="none" stroke={s.color}
                  strokeWidth={s.bold ? 3 : 2} strokeLinejoin="round" strokeLinecap="round"
                />
                {end && <Circle cx={x(end.li)} cy={end.y} r={3.5} fill={s.color} />}
              </React.Fragment>
            );
          })}
          {series.map((s, i) => (ends[i] ? (
            <SvgText
              key={`l${s.key}`} x={LEFT + iw + 8} y={placed[i] + 4} fontSize={11} fontWeight="700"
              fill={s.color} fontFamily="PlusJakartaSans-Bold"
            >{clip(s.label)}</SvgText>
          ) : null))}
        </Svg>
      )}
    </View>
  );
}
